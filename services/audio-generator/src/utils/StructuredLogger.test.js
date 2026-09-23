import assert from 'node:assert/strict';
import test from 'node:test';
import { installStructuredLogger } from './StructuredLogger.js';

function captureLogs(callback) {
  const key = Symbol.for('samsar.structured_logger');
  const previousState = globalThis[key];
  const methods = ['error', 'warn', 'info', 'debug'];
  const previous = Object.fromEntries(methods.map((name) => [name, console[name]]));
  const logs = [];
  globalThis[key] = { installed: false, originalConsole: Object.fromEntries(
    [...methods, 'log'].map((name) => [name, (entry) => logs.push(JSON.parse(entry))]),
  ) };
  try {
    installStructuredLogger({ serviceName: 'security-test' });
    callback();
    return logs;
  } finally {
    Object.assign(console, previous);
    if (previousState === undefined) delete globalThis[key];
    else globalThis[key] = previousState;
  }
}

test('redacts credential fields in both formatted messages and structured error context', () => {
  const error = new Error('Request failed for /verify?authToken=secret-query&mode=read');
  error.response = { status: 403, data: { error: 'Denied', api_key: 'secret-api', nested: { password: 'secret-password' } } };
  const logs = captureLogs(() => console.error('provider failed', {
    authorization: 'Bearer secret-auth', headers: { cookie: 'secret-cookie' },
    custom: [{ header_value: 'secret-header', requestId: 'keep-id' }],
  }, error));
  const serialized = JSON.stringify(logs);
  for (const secret of ['secret-query', 'secret-api', 'secret-password', 'secret-auth', 'secret-cookie', 'secret-header']) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  assert.equal(logs[0].error.response.status, 403);
  assert.match(serialized, /keep-id/);
  assert.match(serialized, /mode=read/);
});

test('redacts preformatted structured JSON without discarding log metadata', () => {
  const logs = captureLogs(() => console.error(JSON.stringify({
    level: 'error', service: 'worker', timestamp: '2026-09-22', message: 'Failure',
    context: { refresh_token: 'secret-refresh', operation: 'generate' },
  })));
  assert.equal(logs[0].service, 'worker');
  assert.equal(logs[0].context.operation, 'generate');
  assert.equal(logs[0].context.refresh_token, '[REDACTED]');
});

test('redacts bearer credentials and URL userinfo in string errors', () => {
  const logs = captureLogs(() => console.error(
    'Bearer private-token https://username:private-password@example.com/path?code=private-code&ok=1',
  ));
  assert.equal(JSON.stringify(logs).includes('private-'), false);
  assert.match(logs[0].message, /ok=1/);
});

test('bounded logging tolerates circular objects and deeply nested error causes', () => {
  const context = { requestId: 'visible' }; context.self = context;
  let error = new Error('root');
  for (let i = 0; i < 100; i += 1) error = new Error(`layer-${i}`, { cause: error });
  const logs = captureLogs(() => console.error('failed', context, error));
  assert.equal(logs.length, 1);
  assert.match(JSON.stringify(logs), /Circular/);
  assert.equal(logs[0].context.requestId, 'visible');
});


test('redacts JSON-encoded provider response bodies and oversized structured logs', () => {
  const error = new Error('Provider rejected request');
  error.response = { status: 400, data: JSON.stringify({ api_key: 'secret-json', error: 'Bad request' }) };
  const logs = captureLogs(() => {
    console.error('Provider failed', error);
    console.error(JSON.stringify({ password: 'secret-large', details: 'x'.repeat(9000) }));
    console.error(JSON.stringify([{ refresh_token: 'secret-array' }]));
  });
  const serialized = JSON.stringify(logs);
  assert.equal(serialized.includes('secret-'), false);
  assert.equal(logs[0].error.response.data.error, 'Bad request');
});
