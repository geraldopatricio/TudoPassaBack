const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(seed = [], remote = null) {
  let db = JSON.stringify(seed);
  const routes = {};
  const deleted = [];
  const router = {};
  for (const method of ['get', 'post', 'put', 'delete']) router[method] = (url, ...handlers) => { routes[`${method} ${url}`] = handlers.at(-1); };
  const multer = () => ({ fields: () => (_req, _res, next) => next() });
  multer.diskStorage = config => config;
  const integration = { list: async () => remote, readConfig: () => ({ enabled: !!remote, provider: remote ? 'alpha' : 'local' }) };
  const mockFs = { existsSync: () => true, readFileSync: () => db, mkdirSync: () => {}, writeFileSync: (_name, data) => { db = data; }, unlinkSync: name => deleted.push(name) };
  const sandbox = { require: name => ({ express: { Router: () => router }, fs: mockFs, path, multer, '../services/integrationService': integration, crypto: require('node:crypto') })[name], __dirname: path.join(__dirname, '../src/routes'), module: { exports: {} }, console: { error: () => {} } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/routes/produtos.js'), 'utf8'), sandbox);
  return { deleted, db: () => JSON.parse(db), call: async (method, body = {}, files = {}, query = {}) => {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = JSON.parse(JSON.stringify(data)); return this; } };
    await routes[method]({ body, files, query, params: { ref: 'TEST' } }, res);
    return res;
  } };
}
const uploads = count => ({ imagens: Array.from({ length: count }, (_, i) => ({ filename: `photo${i}.jpg`, path: `/uploads/photo${i}.jpg` })) });

test('creates six photos with chosen main photo and boolean external sale', async () => {
  const app = fixture();
  const res = await app.call('post /', { referencia: 'TEST', venda_externa: 'true', ordem_imagens: '[5,0,1,2,3,4]' }, uploads(6));
  assert.equal(res.code, 201);
  assert.equal(res.data.imagens.length, 6);
  assert.equal(res.data.imagem, 'photo5.jpg');
  assert.equal(res.data.venda_externa, true);
});
test('rejects seventh photo and cleans uploaded files without changing product', async () => {
  const app = fixture([{ referencia: 'TEST', imagem: 'old.jpg' }]);
  const res = await app.call('put /:ref', {}, uploads(6));
  assert.equal(res.code, 400);
  assert.equal(app.db()[0].imagem, 'old.jpg');
  assert.equal(app.deleted.length, 6);
});
test('edits legacy image, reorders photos and removes obsolete files', async () => {
  const app = fixture([{ referencia: 'TEST', imagem: 'old.jpg', venda_externa: true }]);
  let res = await app.call('put /:ref', { ordem_imagens: '[0,"old.jpg"]' }, uploads(1));
  assert.equal(res.data.imagem, 'photo0.jpg');
  assert.equal(res.data.venda_externa, true);
  res = await app.call('put /:ref', { imagens_existentes: '[]', venda_externa: 'false' });
  assert.deepEqual(res.data.imagens, []);
  assert.equal(res.data.venda_externa, false);
  assert.equal(app.deleted.length, 2);
});
test('ecommerce filters unpublished products while PDV retains all products', async () => {
  const app = fixture([{ referencia: 'A', venda_externa: true }, { referencia: 'B', venda_externa: false }, { referencia: 'C' }]);
  assert.equal((await app.call('get /')).data.length, 3);
  assert.deepEqual((await app.call('get /', {}, {}, { canal: 'ecommerce' })).data.map(p => p.referencia), ['A']);
});
test('integration keeps local photos and publishing flag with remote prices', async () => {
  const app = fixture([{ referencia: 'TEST', venda_externa: true, imagens: ['a.jpg'], imagem: 'a.jpg', variantes: [{ quantidade_total: 2 }] }], [{ referencia: 'TEST', preco_alpha: 25 }, { referencia: 'PRIVATE' }]);
  const res = await app.call('get /', {}, {}, { canal: 'ecommerce' });
  assert.equal(res.data.length, 1);
  assert.deepEqual(res.data[0].imagens, ['a.jpg']);
  assert.equal(res.data[0].variantes[0].valor_unitario, 25);
});
test('rejects malformed photo order and invalid publication flag', async () => {
  const app = fixture([{ referencia: 'TEST', imagens: ['a.jpg', 'b.jpg'] }]);
  assert.equal((await app.call('put /:ref', { ordem_imagens: '["a.jpg","a.jpg"]' })).code, 400);
  assert.equal((await app.call('put /:ref', { venda_externa: 'yes' })).code, 400);
});
