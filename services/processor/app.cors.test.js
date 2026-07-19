import assert from 'node:assert/strict';
import test from 'node:test';

import app from './app.js';

test('CORS exposes status usage headers to browser clients', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/v2/health`, {
    headers: { Origin: 'https://client.example.com' },
  });
  const exposedHeaders = (response.headers.get('access-control-expose-headers') || '')
    .split(',')
    .map((value) => value.trim().toLowerCase());

  assert.equal(response.status, 200);
  assert.ok(exposedHeaders.includes('x-credits-charged'));
  assert.ok(exposedHeaders.includes('x-credits-remaining'));
});
