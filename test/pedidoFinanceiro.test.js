const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Run the actual route with an in-memory filesystem, leaving business data untouched.
function fixture(asaas = { createPix: async () => ({ paymentId: 'pay_test', qrCode: 'png', copyPaste: 'pix' }) }) {
  const files = new Map(Object.entries({
    'pedidos.json': [{ id: '1', numero_pedido: 1, status: 'Pendente', total: 125, cliente_nome: 'Cliente', cliente_email: 'cliente@example.com' }],
    'financeiro.json': [{ id: 'manual', valor_liquido: 10 }],
    'pedidos_itens.json': [], 'produtos.json': [], 'entregas.json': []
  }).map(([key, value]) => [key, JSON.stringify(value)]));
  const routes = {};
  const notifications = [];
  const router = Object.fromEntries(['post', 'get', 'put', 'delete'].map(method => [method, (url, handler) => { routes[`${method} ${url}`] = handler; }]));
  const filename = path.resolve(__dirname, '../src/routes/pedidos.js');
  const fakeFs = {
    existsSync: file => files.has(path.basename(file)), mkdirSync() {},
    readFileSync: file => files.get(path.basename(file)),
    writeFileSync: (file, value) => files.set(path.basename(file), value)
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: name => name === 'express' ? { Router: () => router } : name === 'fs' ? fakeFs : name.includes('salesIntegrationService') ? {} : name.includes('asaasService') ? asaas : name.includes('orderNotification') ? { sendOrderEmail: async data => { notifications.push(data); return { status: 'enviado' }; } } : require(name),
    __dirname: path.dirname(filename), module: { exports: {} }, console
  });
  return {
    notifications,
    read: name => JSON.parse(files.get(name)),
    reverse: id => { const result = {}; router.estornarFinanceiro({ params: { id } }, { status(code) { result.code = code; return this; }, json(data) { result.data = data; } }); return result; },
    create: async (body, route = '/pdv') => {
      const result = { code: 200 };
      await routes[`post ${route}`]({ path: route, body, params: { id: '1' } }, { status(code) { result.code = code; return this; }, json(data) { result.data = data; } });
      return result;
    },
    linkPix: () => { const orders = JSON.parse(files.get('pedidos.json')); orders[0].asaas_payment_id = 'pay_test'; files.set('pedidos.json', JSON.stringify(orders)); },
    setStatus: status => { const orders = JSON.parse(files.get('pedidos.json')); orders[0].status = status; files.set('pedidos.json', JSON.stringify(orders)); },
    update: status => routes['put /:id/status']({ params: { id: '1' }, body: { status } }, { json() {}, status() { return this; } })
  };
}

test('paying creates one received entry with order link and amount; repeated payment is idempotent', () => {
  const f = fixture(); f.update('Pago'); f.update('Pago');
  const entries = f.read('financeiro.json').filter(entry => entry.id_pedido === '1');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].situacao, 'Recebido');
  assert.equal(entries[0].valor_liquido, 125);
});

test('payment confirmation sends paid email to customer once and persists delivery status', async () => {
  const f = fixture();
  await f.update('Pago');
  await f.update('Pago');
  assert.equal(f.notifications.length, 1);
  assert.equal(f.notifications[0].cliente.email, 'cliente@example.com');
  assert.equal(f.notifications[0].status, 'Pago');
  assert.equal(f.read('pedidos.json')[0].email_confirmacao.status, 'enviado');
});

test('legacy paid order requires explicit confirmation to create Pix and preserves financial entry', async () => {
  let calls = 0;
  const f = fixture({ createPix: async () => { calls++; return { paymentId: 'pay_new', qrCode: 'image', copyPaste: 'pix' }; } });
  f.update('Pago');
  const blocked = await f.create({}, '/:id/pix');
  assert.equal(blocked.data.requiresConfirmation, true);
  assert.equal(calls, 0);
  const allowed = await f.create({ allowPaid: true }, '/:id/pix');
  assert.equal(allowed.data.success, true);
  assert.equal(calls, 1);
  assert.equal(f.read('financeiro.json').filter(i => i.id_pedido === '1').length, 1);
});

test('Pix consultation reuses charge; regeneration cancels pending charge before replacing it', async () => {
  const calls = [];
  const f = fixture({
    payment: async () => ({ status: 'PENDING' }),
    pix: async () => ({ qrCode: 'image', copyPaste: 'old-pix' }),
    client: () => ({ delete: async id => { calls.push(`delete:${id}`) } }),
    createPix: async () => { calls.push('create'); return { paymentId: 'pay_new', qrCode: 'new-image', copyPaste: 'new-pix' } }
  });
  f.linkPix();
  const existing = await f.create({}, '/:id/pix');
  assert.equal(existing.data.copyPaste, 'old-pix');
  assert.equal(calls.length, 0);
  const renewed = await f.create({ regenerate: true }, '/:id/pix');
  assert.deepEqual(calls, ['delete:/payments/pay_test', 'create']);
  assert.equal(renewed.data.paymentId, 'pay_new');
  assert.equal(f.read('pedidos.json')[0].asaas_payment_id, 'pay_new');
});

test('PDV persists pending Pix order, items and open financial entry once for every receipt option', async () => {
  for (const tipoCupom of ['sem-cupom', 'fiscal', 'non-fiscal']) {
    const f = fixture();
    const body = { requestId: `pdv-${tipoCupom}`, cliente: { nome: 'Cliente', codigo: '10' }, itens: [{ referencia: 'A', chosenSize: 'M', chosenColor: 'Azul', chosenQty: 2, unitPrice: 50 }], subtotal: 100, frete: 0, desconto: 10, taxas: 5, total: 95, pagamentos: [{ method: 'Dinheiro', value: 100, installments: 1 }], tipoCupom };
    const first = await f.create(body);
    assert.equal(first.code, 201);
    assert.equal(first.data.pedido.status, 'Pendente');
    assert.equal(first.data.pedido.email.status, 'enviado');
    const second = await f.create(body);
    assert.equal(second.data.pedido.id, first.data.pedido.id);
    assert.equal(f.read('pedidos.json').length, 2);
    assert.equal(f.read('pedidos_itens.json').length, 1);
    const finance = f.read('financeiro.json').filter(i => i.id_pedido === first.data.pedido.id);
    assert.equal(finance.length, tipoCupom === 'sem-cupom' ? 1 : 0);
    if (tipoCupom === 'sem-cupom') {
      assert.equal(finance[0].valor_liquido, 95);
      assert.equal(finance[0].forma_pagamento, 'PIX');
      assert.equal(finance[0].situacao, 'Em aberto');
    }
    assert.equal(f.read('entregas.json').length, 0);
  }
});

test('PDV rejects incomplete payment and invalid totals without writing data', async () => {
  const f = fixture();
  const body = { requestId: 'pdv-invalid', cliente: { nome: 'Cliente' }, itens: [{ referencia: 'A', chosenQty: 1, unitPrice: 50 }], subtotal: 50, frete: 0, total: 50, pagamentos: [{ method: 'PIX', value: 20, installments: 1 }] };
  assert.equal((await f.create(body)).code, 400);
  body.pagamentos[0].value = 50; body.total = 40;
  assert.equal((await f.create(body)).code, 400);
  assert.equal(f.read('pedidos.json').length, 1);
  assert.equal(f.read('financeiro.json').length, 1);
});

test('Asaas pending blocks settlement; received payment settles once', async () => {
  let status = 'PENDING';
  const f = fixture({ payment: async () => ({ status, value: 125, billingType: 'PIX' }), received: data => data.status === 'RECEIVED' });
  f.linkPix();
  await f.update('Pago');
  assert.equal(f.read('pedidos.json')[0].status, 'Pendente');
  assert.equal(f.read('financeiro.json').length, 1);
  status = 'RECEIVED';
  await f.update('Pago'); await f.update('Pago');
  assert.equal(f.read('pedidos.json')[0].status, 'Pago');
  assert.equal(f.read('financeiro.json').filter(i => i.id_pedido === '1').length, 1);
  assert.equal(f.read('entregas.json').length, 1);
});

test('cancellation removes financial data even after shipping and preserves unrelated entries', () => {
  const f = fixture(); f.update('Pago'); f.setStatus('Enviado'); f.update('Cancelado'); f.update('Cancelado');
  assert.deepEqual(f.read('financeiro.json'), [{ id: 'manual', valor_liquido: 10 }]);
  assert.equal(f.read('pedidos.json')[0].status, 'Cancelado');
  f.update('Pago');
  assert.equal(f.read('financeiro.json').filter(entry => entry.id_pedido === '1').length, 1);
});

test('cancelling an unpaid order leaves unrelated finances intact', () => {
  const f = fixture(); f.update('Cancelado');
  assert.deepEqual(f.read('financeiro.json'), [{ id: 'manual', valor_liquido: 10 }]);
});

test('shipping and unknown statuses are rejected without changing order or finances', () => {
  const f = fixture();
  f.update('Enviado');
  f.update('Invalido');
  assert.equal(f.read('pedidos.json')[0].status, 'Pendente');
  assert.deepEqual(f.read('financeiro.json'), [{ id: 'manual', valor_liquido: 10 }]);
  assert.deepEqual(f.read('entregas.json'), []);
});

 test('internal reversal removes finance, returns pending order and detaches old Pix', () => {
  const f = fixture();
  f.update('Pago'); f.linkPix();
  const entry = f.read('financeiro.json').find(i => i.id_pedido === '1');
  const result = f.reverse(entry.id);
  assert.equal(result.data.success, true);
  const order = f.read('pedidos.json')[0];
  assert.equal(order.status, 'Pendente');
  assert.equal(order.asaas_payment_id, undefined);
  assert.equal(order.estornos[0].asaas_payment_id, 'pay_test');
  assert.equal(f.read('financeiro.json').length, 1);
  assert.equal(f.read('entregas.json').length, 0);
});
