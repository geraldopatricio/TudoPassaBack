const { test } = require('node:test');
const assert = require('node:assert/strict');
const createCache = require('../src/services/catalogCache');

test('concurrent callers share one load and fresh reads reuse it', async () => {
  const load = createCache();
  let calls = 0;
  const fetch = async () => { calls++; return [{ referencia: '1' }]; };
  const [first, second] = await Promise.all([load('a', fetch), load('a', fetch)]);
  assert.equal(calls, 1);
  assert.equal(first, second);
  assert.equal(await load('a', fetch), first);
  assert.equal(calls, 1);
});

test('stale catalog returns immediately while a shared refresh runs', async () => {
  let time = 0;
  const load = createCache({ now: () => time, freshMs: 10, maxAgeMs: 100 });
  const first = await load('a', async () => ['old']);
  time = 20;
  let complete;
  const background = () => new Promise(resolve => { complete = resolve; });
  assert.equal(await load('a', background), first);
  const forced = load('a', background, true);
  complete(['new']);
  assert.deepEqual(await forced, ['new']);
  assert.deepEqual(await load('a', background), ['new']);
});

test('expired catalog waits for refresh and failures are retried', async () => {
  let time = 0;
  const load = createCache({ now: () => time, freshMs: 10, maxAgeMs: 100 });
  await load('a', async () => ['old']);
  time = 101;
  await assert.rejects(load('a', async () => { throw new Error('offline'); }), /offline/);
  assert.deepEqual(await load('a', async () => ['new']), ['new']);
});

test('credentials or endpoint changes isolate cached data and pending requests', async () => {
  const load = createCache();
  let complete;
  const old = load('old-config', () => new Promise(resolve => { complete = resolve; }));
  await Promise.resolve();
  assert.deepEqual(await load('new-config', async () => ['new']), ['new']);
  complete(['old']);
  await old;
  assert.deepEqual(await load('new-config', async () => ['wrong']), ['new']);
});

test('forced connection test bypasses fresh cache', async () => {
  const load = createCache();
  await load('a', async () => ['old']);
  assert.deepEqual(await load('a', async () => ['updated'], true), ['updated']);
});
