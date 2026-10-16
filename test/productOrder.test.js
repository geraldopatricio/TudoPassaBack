const { test } = require('node:test');
const assert = require('node:assert/strict');
const newestProducts = require('../src/services/productOrder');

test('creation date takes priority over reference and sorting does not mutate input', () => {
  const products = [
    { referencia: '999', data_cadastro: '2025-01-01T12:00:00Z' },
    { referencia: '1', dataCadastro: '2026-10-16T12:00:00Z' },
    { referencia: '5', created_at: '2026-01-01T12:00:00Z' }
  ];
  assert.deepEqual(newestProducts(products).map(p => p.referencia), ['1', '5', '999']);
  assert.equal(products[0].referencia, '999');
});

test('missing or invalid dates fall back to descending natural references', () => {
  const products = [{ referencia: '9' }, { referencia: '100' }, { referencia: '020', data_cadastro: 'invalid' }];
  assert.deepEqual(newestProducts(products).map(p => p.referencia), ['100', '020', '9']);
});

test('dated products come first and equal dates have deterministic reference order', () => {
  const products = [{ referencia: '999' }, { referencia: '2', createdAt: '2026-01-01' }, { referencia: '10', createdAt: '2026-01-01' }];
  assert.deepEqual(newestProducts(products).map(p => p.referencia), ['10', '2', '999']);
  assert.deepEqual(newestProducts([]), []);
});
