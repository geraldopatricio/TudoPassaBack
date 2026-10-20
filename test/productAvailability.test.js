const { test } = require('node:test');
const assert = require('node:assert/strict');
const { saleProducts } = require('../src/services/productAvailability');
const { mergeStock } = require('../src/services/alphaStock');

test('sales hide disabled colors, empty colors, empty products and sizes without positive stock', () => {
  const products = [{ referencia: 'A', variantes: [
    { cor_codigo_nome: 'BRANCO', disponivel: false, grade: { P: 10 } },
    { cor_codigo_nome: 'AZUL', grade: { P: 0, M: -1 } },
    { cor_codigo_nome: 'PRETO', grade: { P: 0, M: '3', G: -2 } }
  ] }, { referencia: 'B', variantes: [{ grade: { P: 0 } }] }];
  const result = saleProducts(products);
  assert.equal(result.length, 1);
  assert.equal(result[0].variantes.length, 1);
  assert.deepEqual(result[0].variantes[0].grade, { M: '3' });
  assert.equal(result[0].variantes[0].quantidade_total, 3);
  assert.equal(products[0].variantes.length, 3);
  assert.equal(products[0].variantes[2].grade.P, 0);
});

test('ERP refresh preserves availability by color code while updating stock', () => {
  const merged = mergeStock({ referencia: 'A', estoque_alpha: true, estoqueGeral: 5, variantes: [
    { codigo_cor: '2', cor_codigo_nome: 'Novo nome', grade: { M: 5 } },
    { codigo_cor: '3', grade: { P: 1 } }
  ] }, { variantes: [{ codigo_cor: 2, disponivel: false, grade: { M: 99 } }] });
  assert.equal(merged.variantes[0].disponivel, false);
  assert.equal(merged.variantes[0].grade.M, 5);
  assert.equal(merged.variantes[1].disponivel, true);
  assert.equal(saleProducts([merged])[0].variantes[0].codigo_cor, '3');
});
