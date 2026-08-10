import assert from 'node:assert/strict';
import test from 'node:test';

import {
  KIMI_K3_BASE_URL,
  KIMI_K3_MAX_REQUEST_BODY_BYTES,
  KIMI_K3_REASONING_EFFORT,
  assertKimiK3RequestBodySize,
  buildKimiK3ChatCompletionPayload,
  createKimiK3ChatCompletion,
  hasKimiK3ApiKey,
} from './KimiK3.js';

test('Kimi K3 uses its dedicated credential and international API endpoint', () => {
  assert.equal(KIMI_K3_BASE_URL, 'https://api.moonshot.ai/v1');
  assert.equal(hasKimiK3ApiKey({ KIMI_K3_API_KEY: 'key' }), true);
  assert.equal(hasKimiK3ApiKey({ MOONSHOT_API_KEY: 'other-key' }), false);
});

test('Kimi K3 preserves chat contracts while enforcing high reasoning and strict JSON', async () => {
  const payload = await buildKimiK3ChatCompletionPayload({
    model: 'KIMIK3',
    effort: 'xhigh',
    reasoningEffort: 'xhigh',
    messages: [
      { role: 'developer', content: 'Return JSON.' },
      { role: 'user', content: 'Hello' },
    ],
    temperature: 0.2,
    top_p: 0.8,
    presence_penalty: 1,
    frequency_penalty: 1,
    max_tokens: 321,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'result',
        strict: false,
        schema: {
          type: 'object',
          properties: { ok: { type: 'boolean' } },
          required: ['ok'],
          additionalProperties: false,
        },
      },
    },
  }, {
    resolveMediaUrl: async (value) => value,
  });

  assert.equal(payload.model, 'kimi-k3');
  assert.equal(payload.reasoning_effort, KIMI_K3_REASONING_EFFORT);
  assert.equal(payload.messages[0].role, 'system');
  assert.equal(payload.max_completion_tokens, 321);
  assert.equal(payload.response_format.json_schema.strict, true);
  assert.equal('temperature' in payload, false);
  assert.equal('top_p' in payload, false);
  assert.equal('presence_penalty' in payload, false);
  assert.equal('frequency_penalty' in payload, false);
  assert.equal('effort' in payload, false);
  assert.equal('reasoningEffort' in payload, false);
});

test('Kimi K3 inlines HTTP images, removes detail, and disables SDK retries', async () => {
  let receivedPayload;
  let receivedOptions;
  const client = {
    chat: {
      completions: {
        create: async (payload, options) => {
          receivedPayload = payload;
          receivedOptions = options;
          return { choices: [{ message: { content: 'described' } }] };
        },
      },
    },
  };

  await createKimiK3ChatCompletion({
    model: 'kimi-k3',
    timeout: 2500,
    messages: [{
      role: 'user',
      content: [{
        type: 'image_url',
        image_url: { url: 'https://media.example/frame.webp', detail: 'high' },
      }],
    }],
  }, {
    client,
    resolveMediaUrl: async (value) => value,
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => 'image/webp' },
      arrayBuffer: async () => Buffer.from('image'),
    }),
  });

  assert.deepEqual(receivedPayload.messages[0].content[0], {
    type: 'image_url',
    image_url: {
      url: `data:image/webp;base64,${Buffer.from('image').toString('base64')}`,
    },
  });
  assert.equal(receivedPayload.reasoning_effort, 'high');
  assert.deepEqual(receivedOptions, { timeout: 2500, maxRetries: 0 });
});

test('Kimi K3 enforces the 100 MB limit on the final base64-inflated request body', async () => {
  const rawImage = Buffer.alloc(80, 1);
  const payload = await buildKimiK3ChatCompletionPayload({
    messages: [{
      role: 'user',
      content: [{
        type: 'image_url',
        image_url: { url: 'https://media.example/frame.png' },
      }],
    }],
  }, {
    resolveMediaUrl: async (value) => value,
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => rawImage,
    }),
  });

  const serializedBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  assert.equal(KIMI_K3_MAX_REQUEST_BODY_BYTES, 100 * 1024 * 1024);
  assert.ok(serializedBytes > rawImage.byteLength);
  assert.throws(
    () => assertKimiK3RequestBodySize(payload, serializedBytes),
    /request body must be smaller than 100 MB/,
  );
  assert.equal(
    assertKimiK3RequestBodySize(payload, serializedBytes + 1),
    serializedBytes,
  );
});
