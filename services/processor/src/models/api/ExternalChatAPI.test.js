import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getExternalChatTimeoutMs,
  isExternalChatPollingRequested,
  stripExternalChatAsyncControlFields,
} from './ExternalChatAPI.js';

test('external chat defaults to a ten-minute execution timeout', () => {
  assert.equal(getExternalChatTimeoutMs({}), 10 * 60 * 1000);
  assert.equal(getExternalChatTimeoutMs({ timeoutMs: 1234 }), 1234);
});

test('external chat recognizes supported async polling controls', () => {
  assert.equal(isExternalChatPollingRequested({ async: true }), true);
  assert.equal(isExternalChatPollingRequested({ poll: true }), true);
  assert.equal(isExternalChatPollingRequested({ response_mode: 'polling' }), true);
  assert.equal(isExternalChatPollingRequested({ responseMode: 'ASYNC' }), true);
  assert.equal(isExternalChatPollingRequested({ async: false }), false);
});

test('async polling controls are not forwarded to the model provider', () => {
  assert.deepEqual(
    stripExternalChatAsyncControlFields({
      messages: [{ role: 'user', content: 'hello' }],
      async: true,
      poll: true,
      response_mode: 'polling',
      model: 'gpt-5.6-sol',
    }),
    {
      messages: [{ role: 'user', content: 'hello' }],
      model: 'gpt-5.6-sol',
    },
  );
});
