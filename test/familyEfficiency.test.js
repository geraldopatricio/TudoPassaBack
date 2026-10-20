const { test } = require('node:test');
const assert = require('node:assert/strict');
const { empty, observe, summarize, family, record, read, adjustLocal } = require('../src/services/familyEfficiency');
const { createCatalog } = require('../src/services/productCatalog');
const product = (ref, stock, familia = 'Camisas', published = true) => ({ referencia: ref, familia, venda_externa: published, estoque_alpha: true, estoqueGeral: stock });
const observeAt = (state, products, at, extra) => observe(state, products, { now: at, ...extra });
const sale = (id, at, ref, units, extra = {}) => ({ order: { id, status: 'Pago', origem: 'ecommerce', pago_em: at, ...extra }, item: { pedido_id: id, referencia: ref, quantidade: units } });
function report(state, sales, now = '2026-10-20T12:00:00Z', start = '2026-10-01', end = '2026-10-20') {
  return summarize(state, sales.map(s => s.order), sales.map(s => s.item), start, end, Date.parse(now));
}
test('existing stock establishes a baseline, real publication triggers a cohort, repeat reads and republish do not duplicate', () => {
  const s = empty();
  observeAt(s, [product('OLD', 10), product('NEW', 20, 'Camisas', false)], '2026-10-01T12:00:00Z');
  assert.equal(s.entries.length, 1);
  assert.equal(s.entries[0].baseline, true);
  observeAt(s, [product('NEW', 20)], '2026-10-02T12:00:00Z', { publication: 'NEW' });
  observeAt(s, [product('NEW', 20)], '2026-10-02T13:00:00Z');
  observeAt(s, [product('NEW', 20, 'Camisas', false)], '2026-10-03T12:00:00Z');
  observeAt(s, [product('NEW', 20)], '2026-10-04T12:00:00Z', { publication: 'NEW' });
  const result = report(s, []);
  assert.equal(s.entries.length, 2);
  assert.equal(result.cohorts.length, 1);
  assert.equal(result.families[0].entered, 30);
});
test('the first newly published product can start tracking immediately without becoming historical stock', () => {
  const s = empty();
  observeAt(s, [product('NEW', 25)], '2026-10-02T12:00:00Z', { publication: 'NEW' });
  assert.equal(report(s, []).cohorts.length, 1);
});
test('seven days are exact and payment time controls attribution; follow-up extends beyond selected entry dates', () => {
  const s = empty();
  observeAt(s, [], '2026-10-01T12:00:00Z');
  observeAt(s, [product('A', 10)], '2026-10-02T12:00:00Z');
  const sales = [
    sale('before', '2026-10-02T11:59:59Z', 'A', 1),
    sale('inside', '2026-10-09T11:59:59Z', 'A', 4, { data: '2026-10-01T12:00:00Z' }),
    sale('boundary', '2026-10-09T12:00:00Z', 'A', 2),
    sale('pending', '2026-10-03T12:00:00Z', 'A', 3, { status: 'Pendente' }),
    sale('cancelled', '2026-10-03T12:00:00Z', 'A', 3, { status: 'Cancelado' }),
    sale('pdv', '2026-10-03T12:00:00Z', 'A', 3, { origem: 'pdv' }),
    sale('future', '2026-11-03T12:00:00Z', 'A', 3),
    sale('legacy', null, 'A', 3)
  ];
  const result = report(s, sales, '2026-10-10T12:00:00Z', '2026-10-02', '2026-10-02');
  assert.equal(result.cohorts[0].sold, 7);
  assert.equal(result.cohorts[0].efficiency, 70);
  assert.equal(result.families[0].sold, 9);
  assert.equal(result.families[0].efficiency, 90);
  assert.equal(result.families[0].difference, -20);
  assert.equal(result.cohorts[0].completed, true);
  assert.equal(result.legacyPaidOrders, 1);
  assert.equal(result.unmatchedUnits, 1);
});
test('overlapping replenishments use FIFO once, and grouped cohort rates use units as weights', () => {
  const s = empty();
  observeAt(s, [], '2026-10-01T12:00:00Z');
  observeAt(s, [product('A', 10)], '2026-10-02T12:00:00Z');
  observeAt(s, [product('A', 4)], '2026-10-03T12:00:00Z');
  observeAt(s, [product('A', 24)], '2026-10-04T12:00:00Z');
  const result = report(s, [sale('one', '2026-10-02T14:00:00Z', 'A', 6), sale('two', '2026-10-04T14:00:00Z', 'A', 10)], '2026-10-05T12:00:00Z');
  assert.equal(result.families[0].cohortEntered, 30);
  assert.equal(result.families[0].cohortSold, 16);
  assert.equal(result.families[0].cohortEfficiency, 16 / 30 * 100);
  assert.equal(result.families[0].active, 2);
  assert.equal(result.cohorts.find(c => c.entered === 10).sold, 10);
  assert.equal(result.cohorts.find(c => c.entered === 20).sold, 6);
});
test('missing family is explicit, later ERP data fills it, later reassignment does not rewrite known history', () => {
  const s = empty();
  observeAt(s, [product('A', 10, null)], '2026-10-01T12:00:00Z');
  assert.equal(report(s, []).families[0].name, 'Sem família');
  observeAt(s, [product('A', 10, { codigo: 7, descricao: 'Camisas' })], '2026-10-02T12:00:00Z');
  assert.equal(report(s, []).families[0].key, '7');
  observeAt(s, [product('A', 12, 'Vestidos')], '2026-10-03T12:00:00Z');
  assert.deepEqual(report(s, []).families.map(f => f.name).sort(), ['Camisas', 'Vestidos']);
  assert.deepEqual(family({}), { key: '', name: 'Sem família' });
});
test('zero stock and empty data never produce NaN, missing catalog references never imply receipts', () => {
  const s = empty();
  observeAt(s, [product('A', 0)], '2026-10-01T12:00:00Z');
  assert.deepEqual(report(s, []).families, []);
  observeAt(s, [product('A', 10)], '2026-10-02T12:00:00Z');
  observeAt(s, [], '2026-10-03T12:00:00Z');
  observeAt(s, [product('A', 10)], '2026-10-04T12:00:00Z');
  assert.equal(s.entries.length, 1);
  const result = report(s, [sale('excess', '2026-10-05T12:00:00Z', 'A', 15)]);
  assert.equal(result.families[0].efficiency, 100);
  assert.equal(result.unmatchedUnits, 5);
});
test('the complete catalog observes sold-out references before filtering, authoritative ERP family wins', async () => {
  let observed;
  const catalog = createCatalog({
    integration: { list: async (_resource, options) => {
      assert.equal(options.includeOutOfStock, true);
      return [product('A', 0, 'Atual'), product('B', 10, 'Outra')];
    } },
    readLocal: () => [{ referencia: 'A', familia: 'Antiga', venda_externa: true, imagem: 'foto.jpg' }],
    record: products => { observed = products; }
  });
  const result = await catalog();
  assert.equal(observed.length, 2);
  assert.equal(observed[0].familia, 'Atual');
  assert.equal(observed[0].imagem, 'foto.jpg');
  assert.equal(observed[0].estoqueGeral, 0);
  assert.equal(result.length, 1);
});
test('catalog failure does not mutate the receipt history', async () => {
  const catalog = createCatalog({ integration: { list: async () => { throw Error('ERP indisponível'); } }, readLocal: () => [], record: () => assert.fail('must not observe failed catalogs') });
  await assert.rejects(catalog, /ERP indisponível/);
});
test('persistent history survives reload; local payment and cancellation stock changes do not create receipts', () => {
  const fs = require('fs'), path = require('path');
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'family-efficiency-'));
  const file = path.join(dir, 'history.json');
  const local = stock => [{ referencia: 'LOCAL', familia: 'Camisas', venda_externa: true, variantes: [{ grade: { M: stock } }] }];
  try {
    record(local(10), { now: '2026-10-02T12:00:00Z', publication: 'LOCAL' }, file);
    const id = read(file).entries[0].id;
    adjustLocal([{ referencia: 'LOCAL', quantidade: 4 }], -1, file);
    record(local(6), { now: '2026-10-03T12:00:00Z' }, file);
    adjustLocal([{ referencia: 'LOCAL', quantidade: 4 }], 1, file);
    record(local(10), { now: '2026-10-04T12:00:00Z' }, file);
    assert.equal(read(file).entries.length, 1);
    assert.equal(read(file).entries[0].id, id);
    record(local(12), { now: '2026-10-05T12:00:00Z' }, file);
    assert.equal(read(file).entries[1].units, 2);
  } finally {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.rmdirSync(dir);
  }
});
