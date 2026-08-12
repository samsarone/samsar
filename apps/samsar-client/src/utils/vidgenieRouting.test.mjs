import assert from 'node:assert/strict';
import test from 'node:test';

import { createBlankVidgenieSession } from './vidgenieSessionApi.js';

test('Vidgenie creation uses its zero-layer blank-session endpoint only', async () => {
  const calls = [];
  const headers = { headers: { Authorization: 'Bearer test' } };
  const httpClient = {
    async post(...args) {
      calls.push(args);
      return { data: { sessionId: 'vidgenie-1' } };
    },
  };

  const sessionId = await createBlankVidgenieSession(
    'http://processor',
    headers,
    httpClient,
  );

  assert.equal(sessionId, 'vidgenie-1');
  assert.deepEqual(calls, [[
    'http://processor/vidgenie/create_blank',
    {},
    headers,
  ]]);
});
