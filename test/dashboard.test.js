const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarize } = require('../src/services/dashboardService');
test('paid orders alone contribute revenue, rankings and ABC; dates use Brasilia', () => {
  const orders = [
    { id: '1', data: '2026-09-10T01:00:00Z', status: 'Pago', total: '110', cliente_codigo: 2, cliente_nome: 'Cliente' },
    { id: '2', data: '2026-09-09T15:00:00Z', status: 'Cancelado', total: 900 },
    { id: '3', data: '2026-09-09T15:00:00Z', status: 'Pendente', total: 200 },
    { id: '4', data: '2026-09-10T12:00:00Z', status: 'Pago', total: 500 }
  ];
  const items = [
    { pedido_id: '1', referencia: 'A', quantidade: 8, valor_total: 80 },
    { pedido_id: '1', referencia: 'B', quantidade: 1, valor_total: 15 },
    { pedido_id: '1', referencia: 'C', quantidade: 1, valor_total: 5 },
    { pedido_id: '2', referencia: 'X', quantidade: 90, valor_total: 900 }
  ];
  const data = summarize(orders, items, '2026-09-09', '2026-09-09');
  assert.equal(data.revenue, 110); assert.equal(data.orders, 3); assert.equal(data.paid, 1);
  assert.equal(data.units, 10); assert.equal(data.ticket, 110); assert.equal(data.buyers, 1);
  assert.deepEqual(data.abc.map(p => p.class), ['A', 'B', 'C']);
  assert.equal(data.abc.at(-1).accumulated, 100);
  assert.equal(data.topCustomers[0].revenue, 110);
  assert.equal(data.series[0].revenue, 110);
  assert.equal(data.payments[0].name, 'Não informado');
});
test('empty periods are zero-filled and zero-value products have no invalid ABC percentages', () => {
  const empty = summarize([], [], '2026-09-01', '2026-09-03');
  assert.equal(empty.series.length, 3); assert.equal(empty.ticket, 0); assert.deepEqual(empty.abc, []);
  const zero = summarize([{ id: 1, data: '2026-09-01T12:00:00Z', status: 'Pago' }], [{ pedido_id: 1, referencia: 'A', quantidade: 1, valor_total: 0 }], '2026-09-01', '2026-09-01');
  assert.equal(zero.abc[0].class, 'C'); assert.equal(zero.abc[0].accumulated, 0);
});


test('sales evolution splits paid item revenue by family and category using Brasilia dates and fills gaps', () => {
  const { salesEvolution } = require('../src/services/dashboardService');
  const orders = [
    { id: 1, data: '2026-10-03T01:00:00Z', status: 'Pago', total: 999 },
    { id: 2, data: '2026-10-02T12:00:00Z', status: 'Pendente' },
    { id: 3, data: '2026-10-04T12:00:00Z', status: 'Pago' }
  ];
  const products = [
    { referencia: 'A', familia: { codigo: 1, descricao: 'Camisas' }, categoria: 'CASUAL' },
    { referencia: 'B', familia: { codigo: 1, descricao: 'Camisas' }, categoria: 'SOCIAL' },
    { referencia: 'C', familia: 'Vestidos', categoria: 'CASUAL' },
    { referencia: 'D', familia: null, categoria: 'CASUAL' }
  ];
  const items = [
    { pedido_id: 1, referencia: 'A', quantidade: 2, valor_total: 10.01 },
    { pedido_id: 1, referencia: 'B', quantidade: 1, valor_unitario: 20 },
    { pedido_id: 1, referencia: 'C', quantidade: 3, valor_total: 30.02 },
    { pedido_id: 1, referencia: 'D', quantidade: 100, valor_total: 500 },
    { pedido_id: 1, referencia: 'UNKNOWN', quantidade: 100, valor_total: 500 },
    { pedido_id: 2, referencia: 'A', quantidade: 100, valor_total: 500 },
    { pedido_id: 3, referencia: 'A', quantidade: 100, valor_total: 500 }
  ];
  const result = salesEvolution(orders, items, products, '2026-10-01', '2026-10-03');
  assert.equal(result.family.length, 2);
  const shirts = result.family.find(g => g.key === '1');
  assert.deepEqual(shirts.points.map(p => p.revenue), [0, 30.01, 0]);
  assert.equal(shirts.points[1].units, 3);
  assert.equal(result.category.find(g => g.name === 'CASUAL').points[1].revenue, 40.03);
  assert.equal(result.category.find(g => g.name === 'SOCIAL').points[1].revenue, 20);
  assert.deepEqual(salesEvolution([], [], [], '2026-10-01', '2026-10-03'), { available: true, family: [], category: [] });
});
