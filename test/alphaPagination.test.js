const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function service(get, provider = 'alpha', stockGet, store) {
  const config = { enabled: true, provider, credentials: {}, resources: {
    produtos: { get: 'https://example.invalid/produtos?Ativo=true&Pagina=5&TamanhoPagina=10000', responsePath: 'itens' }
  } };
  if (store) config.resources.vendas = { defaults: { codigoLoja: store } };
  const productFixtures = new Map();
  const transport = async url => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/estoques')) {
      if (stockGet) return stockGet(url);
      const fixtures = [...productFixtures.values()].filter(p => Number(p.estoqueGeral) > 0).map(p => ({
        referencia: String(p.referencia ?? p.codigo), loja: 1,
        grades: [{ sku: `${p.referencia ?? p.codigo}-7-M`, codigoCor: '7', tamanho: 'M', estoque: String(p.estoqueGeral) }]
      }));
      const start = (Number(parsed.searchParams.get('Pagina')) - 1) * 100;
      return { data: { itens: fixtures.slice(start, start + 100) } };
    }
    const result = await get(url);
    for (const product of result.data.itens || []) productFixtures.set(String(product.referencia ?? product.codigo), product);
    return result;
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/services/integrationService.js'), 'utf8'), {
    module, __dirname, URL, process: { env: {} },
    require: name => name === './alphaStock' ? require('../src/services/alphaStock') : name === './catalogCache' ? require('../src/services/catalogCache') : name === 'axios' ? { get: transport } : name === 'fs' ? { readFileSync: () => JSON.stringify(config) } : require(name)
  });
  return module.exports;
}

test('Alpha loads every page, preserves filters and includes the last partial page', async () => {
  const calls = [];
  const api = service(async url => {
    const query = new URL(url).searchParams;
    calls.push(Number(query.get('Pagina')));
    assert.equal(query.get('Ativo'), 'true');
    assert.equal(query.get('TamanhoPagina'), '100');
    const page = Number(query.get('Pagina'));
    return { data: { itens: page <= 3 ? Array.from({ length: page === 3 ? 7 : 100 }, (_, i) => ({ codigo: (page - 1) * 100 + i, estoqueGeral: 1 })) : [] } };
  });
  const products = await api.list('produtos');
  assert.equal(products.length, 207);
  assert.equal(products[206].referencia, '206');
  assert.equal(calls.join(','), '1,2,3,4');
});

test('Alpha rejects repeated pages instead of looping or returning a partial catalog', async () => {
  let calls = 0;
  const api = service(async () => { calls++; return { data: { itens: [{ codigo: 1 }] } }; });
  await assert.rejects(api.list('produtos'), /repetiu uma página/);
  assert.equal(calls, 4);
});

test('Alpha propagates failure on a later page', async () => {
  let calls = 0;
  const api = service(async () => {
    if (++calls === 2) throw new Error('timeout');
    return { data: { itens: [{ codigo: 1 }] } };
  });
  await assert.rejects(api.list('produtos'), /timeout/);
});

test('other providers keep their existing single request', async () => {
  let calls = 0;
  const api = service(async () => { calls++; return { data: { itens: [{ codigo: 1 }] } }; }, 'custom');
  assert.equal((await api.list('produtos')).length, 1);
  assert.equal(calls, 1);
});

test('3000 products use bounded parallel requests and subsequent screens share the catalog', async () => {
  let calls = 0, active = 0, peak = 0;
  const api = service(async url => {
    calls++; active++; peak = Math.max(peak, active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    const page = Number(new URL(url).searchParams.get('Pagina'));
    return { data: { itens: page <= 30 ? Array.from({ length: 100 }, (_, i) => ({ codigo: (page - 1) * 100 + i, estoqueGeral: 1 })) : [] } };
  });
  const [products, pdv, ecommerce] = await Promise.all([api.list('produtos'), api.list('produtos'), api.list('produtos')]);
  assert.equal(products.length, 3000);
  assert.equal(products, pdv);
  assert.equal(products, ecommerce);
  assert.equal(peak, 4);
  assert.equal(calls, 32);
  assert.equal(await api.list('produtos'), products);
  assert.equal(calls, 32);
  await api.list('produtos', { forceRefresh: true });
  assert.equal(calls, 64);
});

test('Alpha includes only positive ERP stock, even after a page entirely without stock', async () => {
  const api = service(async url => {
    const page = Number(new URL(url).searchParams.get('Pagina'));
    const pages = {
      1: [{ codigo: 'zero', estoqueGeral: 0 }, { codigo: 'negative', estoqueGeral: -3 }],
      2: [
        { codigo: 'available', estoqueGeral: 5 },
        { codigo: 'numeric-string', estoqueGeral: '2.5' },
        { codigo: 'missing' },
        { codigo: 'invalid', estoqueGeral: 'invalid' },
        { codigo: 'null', estoqueGeral: null },
        { codigo: 'local-only', estoqueGeral: 0, variantes: [{ quantidade_total: 10 }] }
      ]
    };
    return { data: { itens: pages[page] || [] } };
  });
  const products = await api.list('produtos');
  assert.equal(products.map(p => p.referencia).join(','), 'available,numeric-string');
  assert.equal(products[0].estoqueGeral, 5);
});
test('history can request sold-out references without changing available-product catalog caching', async () => {
  let calls = 0;
  const api = service(async url => {
    calls++;
    return { data: { itens: Number(new URL(url).searchParams.get('Pagina')) === 1 ? [{ referencia: 'ZERO', estoqueGeral: 0 }, { referencia: 'LIVE', estoqueGeral: 5 }] : [] } };
  });
  const visible = await api.list('produtos');
  const afterFirstLoad = calls;
  const complete = await api.list('produtos', { includeOutOfStock: true });
  assert.equal(visible.length, 1);
  assert.equal(complete.length, 2);
  assert.equal(complete.find(p => p.referencia === 'ZERO').estoqueGeral, 0);
  assert.equal(await api.list('produtos'), visible);
  assert.equal(calls, afterFirstLoad);
});

test('bulk stock fills real color/size balances, scopes store and survives cached reads', async () => {
  let stockCalls = 0;
  const api = service(async url => ({ data: { itens: Number(new URL(url).searchParams.get('Pagina')) === 1
    ? [{ referencia: 'A', estoqueGeral: 999, grades: [{ sku: 'A-7-P', codigoCor: '7', tamanho: 'P' }], tabelaPreco: { preco1: 39 } }] : [] } }), 'alpha', async url => {
    stockCalls++;
    const params = new URL(url).searchParams;
    assert.equal(params.get('Lojas'), '2');
    assert.equal(params.get('EmEstoque'), 'true');
    return { data: { itens: Number(params.get('Pagina')) === 1 ? [{ referencia: 'A', loja: 2, grades: [
      { sku: 'A-7-P', codigoCor: '7', descricaoCor: 'PRETO', tamanho: 'P', estoque: '11' },
      { sku: 'A-7-M', codigoCor: '7', descricaoCor: 'PRETO', tamanho: 'M', estoque: '26' }
    ] }] : [] } };
  }, 2);
  const products = await api.list('produtos');
  assert.equal(products[0].estoqueGeral, 37);
  assert.equal(products[0].variantes[0].grade.P, 11);
  assert.equal(products[0].variantes[0].grade.M, 26);
  assert.equal(products[0].variantes[0].quantidade_total, 37);
  assert.equal(products[0].variantes[0].valor_total, 37 * 39);
  await api.list('produtos');
  assert.equal(stockCalls, 4);
});

test('stock endpoint failure rejects catalog instead of publishing invented balances', async () => {
  const api = service(async () => ({ data: { itens: [] } }), 'alpha', async () => { throw new Error('stock unavailable'); });
  await assert.rejects(api.list('produtos'), /stock unavailable/);
});
