const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function service(get, provider = 'alpha') {
  const config = { enabled: true, provider, credentials: {}, resources: {
    produtos: { get: 'https://example.invalid/produtos?Ativo=true&Pagina=5&TamanhoPagina=10000', responsePath: 'itens' }
  } };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/services/integrationService.js'), 'utf8'), {
    module, __dirname, URL, process: { env: {} },
    require: name => name === 'axios' ? { get } : name === 'fs' ? { readFileSync: () => JSON.stringify(config) } : require(name)
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
    return { data: { itens: page <= 3 ? Array.from({ length: page === 3 ? 7 : 100 }, (_, i) => ({ codigo: (page - 1) * 100 + i })) : [] } };
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
  assert.equal(calls, 2);
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
