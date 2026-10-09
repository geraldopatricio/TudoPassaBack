const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeProduto } = require('../src/services/integrationService');
const product = tabelaPreco => ({ referencia: '1', tabelaPreco, grades: [{ codigoCor: '7', tamanho: 'M' }, { codigoCor: '8', tamanho: 'G' }] });
test('Alpha uses preco1 before later prices for every color and size', () => {
 const p = normalizeProduto(product({preco1:39,preco2:70}), 'alpha');
 assert.equal(p.preco_alpha,39); assert.ok(p.variantes.every(v=>v.valor_unitario===39));
});
test('Alpha skips empty, zero, invalid and negative prices in order', () => {
 const p=normalizeProduto(product({preco1:0,preco2:null,preco3:-1,preco4:'invalid',preco5:'35.50',preco6:99}), 'alpha');
 assert.equal(p.preco_alpha,35.5);
 assert.equal(normalizeProduto(product({preco15:20}), 'alpha').preco_alpha,20);
 assert.equal(normalizeProduto(product({}), 'alpha').preco_alpha,0);
});
test('other integrations preserve existing variant price', () => {
 const p=normalizeProduto({variantes:[{valor_unitario:17}],tabelaPreco:{preco1:39}}, 'bling');
 assert.equal(p.variantes[0].valor_unitario,17);assert.equal(p.preco_alpha,undefined);
});
