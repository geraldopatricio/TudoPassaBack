const { test } = require('node:test');
const assert = require('node:assert/strict');
const { headers } = require('../src/services/integrationService');

test('Alpha API key is sent without competing saved authentication', () => {
  const oldKey = process.env.ALPHA_API_KEY;
  try {
    process.env.ALPHA_API_KEY = ' test-alpha-key ';
    assert.deepEqual(headers({ provider: 'alpha', credentials: {
      apiKey: 'saved-key', token: 'stale-token', clientId: 'old-id', clientSecret: 'old-secret'
    } }), { Accept: 'application/json', 'X-Api-Key': 'test-alpha-key' });
  } finally {
    if (oldKey === undefined) delete process.env.ALPHA_API_KEY;
    else process.env.ALPHA_API_KEY = oldKey;
  }
});

test('other providers retain bearer and client authentication', () => {
  const result = headers({ provider: 'auth_test', credentials: {
    apiKey: 'key', token: 'token', clientId: 'id', clientSecret: 'secret'
  } });
  assert.equal(result.Authorization, 'Bearer token');
  assert.equal(result['X-Api-Key'], 'key');
  assert.equal(result['X-Client-Id'], 'id');
  assert.equal(result['X-Client-Secret'], 'secret');
});
