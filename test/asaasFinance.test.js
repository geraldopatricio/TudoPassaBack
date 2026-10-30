const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const finance = require('../src/services/asaasFinance');

test('forecast dates follow Brasilia and include seven calendar days across a month boundary', () => {
  assert.deepEqual(finance.ranges(new Date('2026-11-01T01:00:00Z')), { today: '2026-10-31', weekEnd: '2026-11-06', monthStart: '2026-10-01', monthEnd: '2026-10-31' });
});
test('overview separates forecasts, balance and cash movements and reads every transaction page', async () => {
  const calls = [];
  const api = { get: async (endpoint, { params = {} } = {}) => {
    calls.push([endpoint, params]);
    if (endpoint === '/finance/balance') return { data: { balance: 50 } };
    if (endpoint === '/finance/payment/statistics') return { data: { quantity: 1, value: 100, netValue: 98 } };
    return { data: params.offset === 0 ? { hasMore: true, data: [{ type: 'PAYMENT_RECEIVED', value: 100.01 }, { type: 'PAYMENT_FEE', value: -1.01 }] } : { hasMore: false, data: [{ type: 'TRANSFER', value: -20 }, { type: 'CREDIT', value: 5 }] } };
  } };
  const r = await finance.overview(api, new Date('2026-10-30T12:00:00Z'));
  assert.equal(r.balance.balance, 50);
  assert.deepEqual(r.cashFlow, { inflow: 105.01, outflow: 21.01, net: 84, paymentsReceived: 100.01 });
  assert.equal(calls.filter(([p]) => p === '/financialTransactions').length, 2);
  assert.ok(calls.some(([p, q]) => q.status === 'PENDING' && q['dueDate[ge]'] === '2026-10-30' && q['dueDate[le]'] === '2026-11-05'));
  assert.deepEqual(r.warnings, []);
});
test('a failed statistic stays unavailable rather than becoming zero', async () => {
  const r = await finance.overview({ get: async p => { if (p === '/finance/balance') throw Error('unavailable'); return { data: p === '/financialTransactions' ? { data: [], hasMore: false } : { value: 0 } }; } });
  assert.equal(r.balance, null);
  assert.equal(r.warnings[0].section, 'balance');
});
function fixture(options = {}) {
  const routes = {}, files = new Map(), writes = [], remote = [];
  let auth;
  const router = { use(fn) { auth = fn; } };
  for (const method of ['get', 'post', 'put', 'delete']) router[method] = (url, fn) => { routes[method + ' ' + url] = fn; };
  const api = {
    get: async (url, config) => {
      remote.push({ method: 'get', url, config });
      return { data: url.startsWith('/customers/') ? { id: url.split('/').pop(), name: 'Cliente' } : { data: [{ id: 'pay_test', customer: 'cus_test', value: 10 }], totalCount: 21, hasMore: true } };
    },
    request: async config => { writes.push(config); if (options.failure) throw options.failure; return { data: { id: 'pay_created', ...config.data } }; }
  };
  const mockFs = {
    existsSync: file => files.has(file),
    readFileSync: file => file.endsWith('usuarios.json') ? JSON.stringify([{ login: 'admin', tipo: 'Admin' }, { login: 'client', tipo: 'Cliente' }]) : files.get(file),
    mkdirSync() {}, writeFileSync: (file, data) => files.set(file, data), renameSync: (from, to) => { files.set(to, files.get(from)); files.delete(from); }
  };
  const filename = path.join(__dirname, '../src/routes/asaas.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { require: name => ({ express: { Router: () => router }, fs: mockFs, path, crypto, '../services/asaasService': { client: () => api }, '../services/asaasFinance': finance, '../services/asaasGrid': require('../src/services/asaasGrid') })[name], module: { exports: {} }, __dirname: path.dirname(filename), process, Buffer, console });
  const token = login => { const payload = Buffer.from(JSON.stringify({ login })).toString('base64url'); return payload + '.' + crypto.createHmac('sha256', process.env.AUTH_SECRET || 'tudo-passa-local-auth-secret').update(payload).digest('base64url'); };
  return { writes, remote, async call(route, { body = {}, query = {}, params = {}, login = 'admin', requestId = 'request_1234567890', authorization } = {}) {
    const req = { body, query, params, headers: { authorization: authorization === undefined ? 'Bearer ' + token(login) : authorization, 'x-request-id': requestId } };
    const res = { code: 200, status(n) { this.code = n; return this; }, json(value) { this.data = JSON.parse(JSON.stringify(value)); return this; } };
    let passed = false; auth(req, res, () => { passed = true; });
    if (passed) await routes[route](req, res);
    return res;
  } };
}
test('financial endpoints reject unauthenticated, tampered and non-management sessions', async () => {
  const app = fixture();
  assert.equal((await app.call('get /payments', { authorization: '' })).code, 401);
  assert.equal((await app.call('get /payments', { authorization: 'Bearer invalid.fake' })).code, 401);
  assert.equal((await app.call('get /payments', { login: 'client' })).code, 403);
  assert.equal(app.remote.length, 0);
});
test('payment datagrid paginates remotely by ten and enriches customer identity', async () => {
  const app = fixture();
  const r = await app.call('get /payments', { query: { page: '3', status: 'OVERDUE', limit: '1000', secret: 'ignored' } });
  assert.equal(r.data.data[0].customerData.name, 'Cliente');
  assert.deepEqual(JSON.parse(JSON.stringify(app.remote[0].config.params)), { status: 'OVERDUE', limit: 10, offset: 20 });
});
test('charge creation validates input and repeated request IDs create only one charge', async () => {
  const app = fixture(), body = { customer: 'cus_test', billingType: 'PIX', value: 15, dueDate: '2026-11-10' };
  assert.equal((await app.call('post /payments', { body: { ...body, value: -1 } })).code, 400);
  assert.equal((await app.call('post /payments', { body: { ...body, dueDate: '2026-02-30' } })).code, 400);
  const first = await app.call('post /payments', { body });
  assert.equal(first.data.id, 'pay_created');
  assert.deepEqual((await app.call('post /payments', { body })).data, first.data);
  assert.equal(app.writes.length, 1);
  assert.equal((await app.call('post /payments', { body: { ...body, value: 20 } })).code, 409);
  assert.equal(app.writes.length, 1);
});
test('subscription creation requires a real recurrence and does not send raw card information', async () => {
  const app = fixture();
  const body = { customer: 'cus_test', billingType: 'CREDIT_CARD', value: 20, nextDueDate: '2026-11-10', cycle: 'MONTHLY', creditCard: { number: 'ignored' } };
  assert.equal((await app.call('post /subscriptions', { body: { ...body, cycle: 'UNKNOWN' } })).code, 400);
  assert.equal((await app.call('post /subscriptions', { body })).code, 200);
  assert.equal(app.writes[0].data.creditCard, undefined);
});
test('invoice scheduling requires fiscal classification and never invents taxes', async () => {
  const app = fixture();
  const body = { customer: 'cus_test', value: 10, effectiveDate: '2026-11-10', serviceDescription: 'Servico', municipalServiceName: 'Servico municipal', municipalServiceCode: '1.01' };
  assert.equal((await app.call('post /invoices', { body })).code, 400);
  assert.equal((await app.call('post /invoices', { body: { ...body, taxes: { iss: 2, retainIss: false } } })).code, 200);
  assert.equal(app.writes[0].url, '/invoices');
  assert.equal(app.writes[0].data.taxes.iss, 2);
});


test('uncertain mutations are not repeated and independent operation records survive concurrent completions', async () => {
  const body = { customer: 'cus_test', billingType: 'PIX', value: 15, dueDate: '2026-11-10' };
  const failed = fixture({ failure: Error('ECONNRESET') });
  assert.equal((await failed.call('post /payments', { body })).code, 502);
  assert.equal((await failed.call('post /payments', { body })).code, 409);
  assert.equal(failed.writes.length, 1);
  const app = fixture();
  await Promise.all(['request_aaaaaaaaaaa', 'request_bbbbbbbbbbb'].map(requestId => app.call('post /payments', { body, requestId })));
  await app.call('post /payments', { body, requestId: 'request_aaaaaaaaaaa' });
  await app.call('post /payments', { body, requestId: 'request_bbbbbbbbbbb' });
  assert.equal(app.writes.length, 2);
});
