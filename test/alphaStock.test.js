const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyStock, mergeStock } = require('../src/services/alphaStock');
const { normalizeProduto } = require('../src/services/integrationService');

const product = { referencia: 'A', estoqueGeral: 999, tabelaPreco: { preco1: 39 }, grades: [
  { sku: 'A-7-P', codigoCor: '7', descricaoCor: 'PRETO', tamanho: 'P' },
  { sku: 'A-7-M', codigoCor: '7', descricaoCor: 'PRETO', tamanho: 'M' },
  { sku: 'A-2-P', codigoCor: '2', descricaoCor: 'ROSA', tamanho: 'P' }
] };
const stock = (quantity, color = '7', size = 'P', loja = 1) => ({ referencia: 'A', loja, grades: [
  { sku: `A-${color}-${size}`, codigoCor: color, descricaoCor: color === '7' ? 'PRETO' : 'ROSA', tamanho: size, estoque: quantity }
] });

test('stock is linked to each color and size, absent combinations stay zero', () => {
  const [enriched] = applyStock([product], [stock('11'), stock('26', '7', 'M'), stock('3', '2')]);
  const normalized = normalizeProduto(enriched, 'alpha');
  const black = normalized.variantes.find(v => v.codigo_cor === '7');
  const pink = normalized.variantes.find(v => v.codigo_cor === '2');
  assert.equal(black.grade.P, 11);
  assert.equal(black.grade.M, 26);
  assert.equal(black.grade.G, 0);
  assert.equal(black.quantidade_total, 37);
  assert.equal(pink.grade.P, 3);
  assert.equal(normalized.estoqueGeral, 40);
  assert.equal(black.valor_total, 37 * 39);
  assert.equal(product.estoqueGeral, 999);
});

test('multiple returned stores sum availability per combination without mixing products', () => {
  const [result, other] = applyStock([product, { referencia: 'B', grades: [] }], [stock('2', '7', 'P', 1), stock('3', '7', 'P', 2)]);
  assert.equal(result.grades.find(g => g.sku === 'A-7-P').estoque, 5);
  assert.equal(other.estoqueGeral, 0);
});

test('zero, negative and missing stock never distribute parent quantity', () => {
  const [result] = applyStock([product], [stock('-3'), stock('0', '2')]);
  assert.equal(result.estoqueGeral, 0);
  assert.ok(result.grades.every(g => g.estoque === 0));
  assert.equal(applyStock([product], [])[0].estoqueGeral, 0);
  assert.throws(() => applyStock([product], [stock('invalid')]), /saldo inválido/);
  assert.throws(() => applyStock([product], [stock(undefined)]), /saldo inválido/);
  assert.throws(() => applyStock([product], [stock('1'), stock('1')]), /repetiu o estoque/);
});

test('local photos and descriptions survive but local stock cannot override ERP grades', () => {
  const remote = normalizeProduto(applyStock([product], [stock('11')])[0], 'alpha');
  const merged = mergeStock(remote, { descricao: 'Descrição local', imagem: 'foto.jpg', venda_externa: true,
    estoqueGeral: 999, variantes: [{ codigo_cor: '7', grade: { P: 999 } }] });
  assert.equal(merged.descricao, 'Descrição local');
  assert.equal(merged.imagem, 'foto.jpg');
  assert.equal(merged.venda_externa, true);
  assert.equal(merged.estoqueGeral, 11);
  assert.equal(merged.variantes[0].grade.P, 11);
  assert.equal(mergeStock({ referencia: 'B', variantes: [] }, { variantes: ['local'] }).variantes[0], 'local');
});
