const { test } = require('node:test');
const assert = require('node:assert/strict');
const axiosPath = require.resolve('axios');
let calls = [], failure;
require.cache[axiosPath] = { id: axiosPath, filename: axiosPath, loaded: true, exports: async options => {
  calls.push(options); if (failure) throw failure; return { data: { codigo: 99 } };
} };
const { alphaPayload, send } = require('../src/services/salesIntegrationService');
const spec = { post: 'https://example.invalid/vendas', defaults: { codigoVendedor: 2, codigoLoja: 3, tabelaPreco: 4, codigoFormaPagamento: 5, codigoCondicaoPagamento: 6, codigoContaCorrente: 7 }, sizePositions: { M: 3, G: 4 } };
const pedido = { id: 'sale-1', cliente_codigo: 12, frete: 5, total: 65 };
const itens = [{ referencia: 'ABC', codigo_cor: 8, tamanho: 'M', quantidade: 2, valor_unitario: 10 }, { referencia: 'ABC', codigo_cor: 8, tamanho: 'G', quantidade: 4, valor_unitario: 10 }];
test('Alpha groups sizes by reference/color and sends PIX rather than cash', () => {
  const payload = alphaPayload(pedido, itens, spec);
  assert.equal(payload.produtos.length, 1);
  assert.equal(payload.produtos[0].grades[0].pos3, 2);
  assert.equal(payload.produtos[0].grades[0].pos4, 4);
  assert.equal(payload.produtos[0].grades[0].pos1, 0);
  assert.equal(payload.codigoPedidoEcommerce, pedido.id);
  assert.equal(payload.dinheiro, 0);
  assert.equal(payload.outrosPagamentos[0].valor, 65);
});
test('missing mapping or customer code prevents sending fictional defaults', () => {
  assert.throws(() => alphaPayload(pedido, itens, { ...spec, sizePositions: {} }), /posição/);
  assert.throws(() => alphaPayload({ ...pedido, cliente_codigo: '' }, itens, spec), /cliente/);
});
test('transport: local, config error, success, rejection and uncertain outcome', async () => {
  const config = { provider: 'alpha', credentials: {}, resources: { vendas: spec } };
  assert.equal((await send(pedido, itens, null)).status, 'local');
  assert.equal(calls.length, 0);
  assert.equal((await send(pedido, itens, { ...config, resources: {} })).status, 'erro_configuracao');
  assert.equal(calls.length, 0);
  assert.equal((await send(pedido, itens, config)).status, 'enviado');
  assert.equal(calls[0].method, 'post');
  assert.equal(calls[0].url, spec.post);
  failure = { response: { status: 422 } };
  assert.equal((await send(pedido, itens, config)).status, 'rejeitado');
  failure = { code: 'ECONNABORTED' };
  assert.equal((await send(pedido, itens, config)).status, 'verificar');
  assert.equal(calls.length, 3);
  failure = undefined;
  await send(pedido, itens, { ...config, provider: 'custom' });
  assert.deepEqual(calls[3].data.itens, itens);
});
