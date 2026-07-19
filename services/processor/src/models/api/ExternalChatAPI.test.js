import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildExternalChatRequestObjectId,
  createExternalChatCompletion,
  getExternalChatTimeoutMs,
  isExternalChatPollingRequested,
  normalizeExternalChatRequestCorrelation,
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
      client_request_id: 'docker-session:theme',
      client_session_id: 'docker-session',
      client_request_key: 'theme',
      model: 'gpt-5.6-sol',
    }),
    {
      messages: [{ role: 'user', content: 'hello' }],
      model: 'gpt-5.6-sol',
    },
  );
});

test('external chat normalizes persisted Docker request correlation fields', () => {
  assert.deepEqual(
    normalizeExternalChatRequestCorrelation({
      client_request_id: 'local-request-123',
      internal_session_id: 'video-session-456',
      client_request_key: 'text_to_video:theme:attempt-1',
    }),
    {
      clientRequestId: 'local-request-123',
      clientSessionId: 'video-session-456',
      clientRequestKey: 'text_to_video:theme:attempt-1',
    },
  );
});

test('hosted request ids are deterministic for a Docker client request id', () => {
  const first = buildExternalChatRequestObjectId('user-1', 'docker-request-1').toString();
  const second = buildExternalChatRequestObjectId('user-1', 'docker-request-1').toString();
  const otherUser = buildExternalChatRequestObjectId('user-2', 'docker-request-1').toString();

  assert.equal(first, second);
  assert.notEqual(first, otherUser);
});

test('external chat preserves raw multimodal aliases for adapter-boundary dispatch', async () => {
  const payload = {
    model: 'gpt-5.6-sol',
    messages: [{
      role: 'user',
      content: [{
        type: 'image_url',
        image_url: {
          url: 'http://localhost:3002/assets_v2/generations/session/external.png',
        },
      }],
    }],
  };
  const originalPayload = JSON.parse(JSON.stringify(payload));
  let capturedPayload;
  let chargedMetadata;

  const result = await createExternalChatCompletion({
    userId: 'external-chat-user',
    payload,
  }, {
    resolveMediaUrl: async () => {
      throw new Error('API orchestration must not create provider media URLs.');
    },
    createCompletion: async (_client, providerPayload) => {
      capturedPayload = providerPayload;
      return {
        id: 'external-chat-media',
        model: 'gpt-5.6-sol',
        choices: [{ message: { role: 'assistant', content: 'described' } }],
        usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
      };
    },
    deductCredits: async (_userId, _credits, options) => {
      chargedMetadata = options.metadata;
      return { remainingCredits: 123 };
    },
  });

  assert.deepEqual(payload, originalPayload);
  assert.equal(
    capturedPayload.messages[0].content[0].image_url.url,
    payload.messages[0].content[0].image_url.url,
  );
  assert.equal(capturedPayload.bypassSamsarExternalInference, true);
  assert.equal(chargedMetadata.category, 'external_chat');
  assert.equal(result.response.choices[0].message.content, 'described');
  assert.equal(result.remainingCredits, 123);
});
