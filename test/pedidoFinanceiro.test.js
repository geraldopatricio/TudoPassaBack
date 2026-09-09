const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Run the actual route with an in-memory filesystem, leaving business data untouched.
function fixture() {
  const files = new Map(Object.entries({
    'pedidos.json': [{ id: '1', numero_pedido: 1, status: 'Pendente', total: 125, cliente_nome: 'Cliente' }],
    'financeiro.json': [{ id: 'manual', valor_liquido: 10 }],
    'pedidos_itens.json': [], 'produtos.json': [], 'entregas.json': []
  }).map(([key, value]) => [key, JSON.stringify(value)]));
  const routes = {};
  const router = Object.fromEntries(['post', 'get', 'put', 'delete'].map(method => [method, (url, handler) => { routes[`${method} ${url}`] = handler; }]));
  const filename = path.resolve(__dirname, '../src/routes/pedidos.js');
  const fakeFs = {
    existsSync: file => files.has(path.basename(file)), mkdirSync() {},
    readFileSync: file => files.get(path.basename(file)),
    writeFileSync: (file, value) => files.set(path.basename(file), value)
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: name => name === 'express' ? { Router: () => router } : name === 'fs' ? fakeFs : name.includes('salesIntegrationService') ? {} : require(name),
    __dirname: path.dirname(filename), module: { exports: {} }, console
  });
  return {
    read: name => JSON.parse(files.get(name)),
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
