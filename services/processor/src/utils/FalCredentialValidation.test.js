import assert from 'node:assert/strict';
import test from 'node:test';
import { validateFalCredential } from './FalCredentialValidation.js';

const reply = (status, body = {}) => new Response(JSON.stringify(body), { status });

test('verifies Fal authentication using only status GETs and a negative control', async () => {
  const calls = [];
  const result = await validateFalCredential('  valid-test-key  ', { fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return options.headers.Authorization === 'Key valid-test-key'
      ? reply(404, { status: 'NOT_FOUND' }) : reply(401);
  } });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'valid');
  assert.equal(result.validationMode, 'remote_queue_auth');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, calls[1].url);
  assert.match(calls[0].url, /^https:\/\/queue\.fal\.run\/fal-ai\/elevenlabs\/requests\/[a-f0-9-]{36}\/status\?logs=0$/);
  for (const { options } of calls) {
    assert.equal(options.method, 'GET');
    assert.equal(options.body, undefined);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
  }
});

for (const status of [401, 403]) {
  test(`rejects Fal HTTP ${status} without calling a model`, async () => {
    let calls = 0;
    const result = await validateFalCredential('invalid-key', { fetchImpl: async () => { calls++; return reply(status); } });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'invalid');
    assert.equal(result.statusCode, status);
    assert.equal(calls, 1);
  });
}

for (const [status, body] of [[404, {}], [404, { message: 'Not Found' }], [200, { models: [] }], [429, {}], [503, {}]]) {
  test(`does not verify unexpected response ${status} ${JSON.stringify(body)}`, async () => {
    const result = await validateFalCredential('key', { fetchImpl: async () => reply(status, body) });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'error');
  });
}

test('does not accept a public endpoint returning NOT_FOUND for every key', async () => {
  const result = await validateFalCredential('key', { fetchImpl: async () => reply(404, { status: 'NOT_FOUND' }) });
  assert.equal(result.ok, false);
});

test('network errors and timeouts remain unverified and never expose a credential', async () => {
  const result = await validateFalCredential('secret-test-key', { fetchImpl: async () => { throw new Error('request failed with secret-test-key'); } });
  assert.equal(result.status, 'error');
  assert.equal(result.ok, false);
  assert.doesNotMatch(JSON.stringify(result), /secret-test-key/);
});

test('a blank key is rejected without making a request', async () => {
  const result = await validateFalCredential('   ', { fetchImpl: async () => assert.fail('must not send an empty credential') });
  assert.equal(result.status, 'invalid');
});
