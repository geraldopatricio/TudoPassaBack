const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const history = require('../src/services/familyEfficiency');
function fixture(failCatalog = false) {
  let route;
  const state = history.empty();
  history.observe(state, [{ referencia: 'A', familia: 'Camisas', venda_externa: true, estoque_alpha: true, estoqueGeral: 10 }], { now: '2026-10-01T12:00:00Z', publication: 'A' });
  const orders = [{ id: 1, data: '2026-10-02T12:00:00Z', pago_em: '2026-10-02T12:00:00Z', status: 'Pago', origem: 'ecommerce', total: 40 }];
  const items = [{ pedido_id: 1, referencia: 'A', quantidade: 4, valor_total: 40 }];
  const file = path.resolve(__dirname, '../src/routes/dashboard.js');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    __dirname: path.dirname(file), module: { exports: {} },
    require: name => ({
      express: { Router: () => ({ get: (_path, handler) => { route = handler; } }) }, path,
      fs: { existsSync: () => true, readFileSync: file => JSON.stringify(file.endsWith('pedidos_itens.json') ? items : orders) },
      '../services/dashboardService': require('../src/services/dashboardService'),
      '../services/familyEfficiency': { ...history, read: () => state },
      '../services/productCatalog': async () => { if (failCatalog) throw Error('ERP indisponível'); }
    })[name]
  });
  return async query => {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await route({ query }, res);
    return res;
  };
}
test('dashboard includes family analysis and preserves the original backup API payload', async () => {
  const res = await fixture()({ start: '2026-10-01', end: '2026-10-03' });
  assert.equal(res.code, 200);
  assert.equal(res.body.revenue, 40);
  assert.equal(res.body.abc.length, 1);
  assert.equal(res.body.familyEfficiency.available, true);
  assert.equal(res.body.familyEfficiency.families[0].efficiency, 40);
  assert.equal(res.body.familyEfficiency.cohorts.length, 1);
});
test('ERP failure marks family metrics unavailable without reporting invented zero rates or losing sales metrics', async () => {
  const res = await fixture(true)({ start: '2026-10-01', end: '2026-10-03' });
  assert.equal(res.code, 200);
  assert.equal(res.body.revenue, 40);
  assert.equal(res.body.familyEfficiency.available, false);
  assert.equal(res.body.familyEfficiency.families, undefined);
});
test('invalid dashboard dates remain rejected', async () => {
  const res = await fixture()({ start: '2026-02-30', end: '2026-10-03' });
  assert.equal(res.code, 400);
});
