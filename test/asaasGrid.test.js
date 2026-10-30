const { test } = require('node:test');
const assert = require('node:assert/strict');
const { join, queryRows, createGrid } = require('../src/services/asaasGrid');
const customer = (id, dateCreated = '2026-10-21') => ({ id, name: 'Cliente ' + id, cpfCnpj: '12345678901', email: 'contato@example.com', dateCreated });
const payment = (id, customer = 'cus_A') => ({ id, customer, dateCreated: '2026-10-28', dueDate: '2026-11-10', status: 'CONFIRMED', value: 95.76, billingType: 'PIX', description: 'Plano anual' });
test('unified grid has one row per charge and preserves customers without charges', () => {
  const data = join([customer('cus_A'), customer('cus_B')], [payment('pay_1'), payment('pay_2')], [{ id: 'inv_1', payment: 'pay_1', status: 'AUTHORIZED', number: '123' }]);
  assert.equal(data.length, 3);
  assert.equal(data.find(r => r.id === 'pay_1').invoices[0].number, '123');
  assert.equal(data.find(r => r.id === 'pay_2').invoices.length, 0);
  assert.equal(data.find(r => r.customerData.id === 'cus_B').paymentData, null);
  assert.equal(queryRows(data, { purchased: 'no' }).totalCount, 1);
  assert.equal(queryRows(data, { purchased: 'yes' }).totalCount, 2);
});
test('period filters customer registration independently from charge creation and due date', () => {
  const rows = join([customer('cus_A', '2026-09-01'), customer('cus_B')], [payment('pay_1'), payment('pay_2', 'cus_B')], []);
  const r = queryRows(rows, { customerStart: '2026-09-01', customerEnd: '2026-09-30' });
  assert.equal(r.totalCount, 1);
  assert.equal(r.data[0].chargeCreated, '2026-10-28');
  assert.equal(queryRows(rows, { dueStart: '2026-11-01', dueEnd: '2026-11-30' }).totalCount, 2);
  assert.throws(() => queryRows(rows, { customerStart: '2026-02-30' }), /invalido/);
});
test('search, invoice and column filters run over all rows before ten-record pagination', () => {
  const payments = Array.from({ length: 23 }, (_, i) => ({ ...payment('pay_' + i), value: i + 1, description: i === 22 ? 'Plano premium' : 'Plano anual' }));
  const rows = join([customer('cus_A')], payments, [{ id: 'inv_22', payment: 'pay_22', status: 'AUTHORIZED' }]);
  assert.equal(queryRows(rows, { page: 2 }).data.length, 10);
  assert.equal(queryRows(rows, { page: 3 }).data.length, 3);
  assert.equal(queryRows(rows, { search: 'premium' }).data[0].id, 'pay_22');
  assert.equal(queryRows(rows, { invoiceStatus: 'AUTHORIZED' }).totalCount, 1);
  assert.equal(queryRows(rows, { invoiceStatus: 'none' }).totalCount, 22);
  assert.equal(queryRows(rows, { 'column.payment': 'confirmado' }).totalCount, 23);
  assert.equal(queryRows(rows, { 'column.customerCreated': '21/10/2026' }).totalCount, 23);
  assert.equal(queryRows(rows, { sortBy: 'charge', sortDirection: 'desc' }).data[0].paymentData.value, 23);
});
test('failed fiscal query is unknown, never a claim that the customer has no fiscal note', () => {
  const rows = join([customer('cus_A')], [payment('pay_1')], [], false);
  assert.equal(rows[0].invoicesAvailable, false);
  assert.equal(queryRows(rows, { invoiceStatus: 'none' }).totalCount, 0);
});
test('snapshot reuses complete remote lists for column filters and invalidates after writes', async () => {
  const calls = [];
  const api = { get: async (path, { params }) => {
    calls.push(path);
    return { data: { hasMore: false, data: path === '/customers' ? [customer('cus_A')] : path === '/payments' ? [payment('pay_1')] : [] } };
  } };
  const grid = createGrid();
  await Promise.all([grid.load(api), grid.load(api)]);
  assert.equal(calls.length, 3);
  await grid.load(api, { search: 'plano' });
  assert.equal(calls.length, 3);
  grid.invalidate(); await grid.load(api);
  assert.equal(calls.length, 6);
  await grid.load(api, { refresh: 'true' });
  assert.equal(calls.length, 9);
});
