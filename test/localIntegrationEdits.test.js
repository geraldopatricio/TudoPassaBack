const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

for (const resource of ['produtos', 'clientes', 'profissionais']) {
  test(`${resource}: integrated edits persist locally, normalize fields and override remote reads`, async () => {
    const key = resource === 'produtos' ? 'referencia' : 'codigo';
    const files = new Map();
    const routes = {};
    const router = Object.fromEntries(['get', 'post', 'put', 'delete'].map(method => [method, (url, ...handlers) => { routes[`${method} ${url}`] = handlers.at(-1); }]));
    const remote = { [key]: '123', nome: 'Original', descricao: 'Original', ativo: true };
    const integration = {
      readConfig: () => ({ enabled: true, provider: 'alpha', resources: { [resource]: { put: 'https://example.invalid' } } }),
      writeRemote: () => { throw new Error('Editing must persist locally, not invoke remote PUT'); },
      list: async () => [remote], getOne: async () => remote
    };
    const fakeFs = {
      existsSync: file => files.has(file), mkdirSync() {}, unlinkSync() {},
      readFileSync: file => files.get(file), writeFileSync: (file, data) => files.set(file, data)
    };
    const multer = Object.assign(() => ({ single: () => () => {} }), { diskStorage: () => ({}) });
    const filename = path.resolve(__dirname, `../src/routes/${resource}.js`);
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      require: name => name === 'express' ? { Router: () => router } : name === 'fs' ? fakeFs : name === 'multer' ? multer : name.includes('integrationService') ? integration : require(name),
      __dirname: path.dirname(filename), module: { exports: {} }, console
    });
    let response;
    const res = { status() { return this; }, json(value) { response = value; } };
    const body = { nome: 'Editado', descricao: 'Editado', ativo: false, variantes: '[{"valor_unitario":"35.50"}]', ref_usuarios: '["usuario"]', credito_limite: '100', bloqueado: 'false' };
    routes[`put /:${key === 'referencia' ? 'ref' : 'codigo'}`]({ params: { ref: '123', codigo: '123' }, body, file: { filename: 'nova.png' } }, res);
    const db = path.resolve(path.dirname(filename), `../database/${resource}/${resource}.json`);
    const stored = JSON.parse(files.get(db));
    assert.equal(stored.length, 1);
    assert.equal(stored[0][key], '123');
    if (resource === 'produtos') { assert.equal(stored[0].variantes[0].valor_unitario, 35.5); assert.equal(stored[0].imagem, 'nova.png'); }
    else { assert.deepEqual(stored[0].ref_usuarios, ['usuario']); assert.equal(stored[0][resource === 'clientes' ? 'foto' : 'logomarca'], 'nova.png'); }
    if (resource === 'clientes') { assert.equal(stored[0].credito_limite, 100); assert.equal(stored[0].bloqueado, false); }
    await routes['get /']({}, res);
    assert.equal(response[0].nome, 'Editado');
    assert.equal(response[0].ativo, false);
    if (resource !== 'produtos') {
      await routes['get /:codigo']({ params: { codigo: '123' } }, res);
      assert.equal(response.nome, 'Editado');
    }
    routes[`put /:${key === 'referencia' ? 'ref' : 'codigo'}`]({ params: { ref: '123', codigo: '123' }, body: { nome: 'Segunda edição' } }, res);
    const updated = JSON.parse(files.get(db));
    assert.equal(updated.length, 1);
    if (resource === 'produtos') assert.equal(updated[0].variantes[0].valor_unitario, 35.5);
    if (resource === 'clientes') assert.equal(updated[0].credito_limite, 100);
  });
}
