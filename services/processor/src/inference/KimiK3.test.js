import assert from 'node:assert/strict';
import test from 'node:test';

import {
  KIMI_K3_MAX_REQUEST_BODY_BYTES,
  KIMI_K3_PROVIDER_MODEL,
  KIMI_K3_REASONING_EFFORT,
  buildKimiK3ChatRequest,
  createKimiK3ChatCompletion,
  getKimiK3BaseURL,
  getKimiK3SerializedRequestBodyBytes,
  hasKimiK3NativeCredential,
} from './KimiK3.js';

test('Kimi K3 uses the international endpoint and the dedicated credential', () => {
  assert.equal(getKimiK3BaseURL({}), 'https://api.moonshot.ai/v1');
  assert.equal(hasKimiK3NativeCredential({ KIMI_K3_API_KEY: 'test-key' }), true);
  assert.equal(hasKimiK3NativeCredential({ MOONSHOT_API_KEY: 'other-key' }), false);
});

test('Kimi K3 request keeps contracts while enforcing high reasoning and strict JSON', async () => {
  const client = {
    files: { create: async () => assert.fail('unexpected upload') },
  };
  const { payload } = await buildKimiK3ChatRequest({
    model: 'KIMIK3',
    messages: [
      { role: 'developer', content: 'Return structured data.' },
      { role: 'user', content: 'Hello' },
    ],
    temperature: 0,
    top_p: 0.5,
    n: 2,
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
          properties: { answer: { type: 'string' } },
          required: ['answer'],
          additionalProperties: false,
        },
      },
    },
  }, { client });

  assert.equal(payload.model, KIMI_K3_PROVIDER_MODEL);
  assert.equal(payload.reasoning_effort, KIMI_K3_REASONING_EFFORT);
  assert.equal(payload.messages[0].role, 'system');
  assert.equal(payload.max_completion_tokens, 321);
  assert.equal(payload.response_format.json_schema.strict, true);
  for (const unsupported of [
    'temperature',
    'top_p',
    'n',
    'presence_penalty',
    'frequency_penalty',
  ]) {
    assert.equal(Object.hasOwn(payload, unsupported), false);
  }
});

test('Kimi K3 converts public image URLs to inline data and removes detail', async () => {
  let capturedPayload;
  const client = {
    chat: {
      completions: {
        create: async (payload) => {
          capturedPayload = payload;
          return { choices: [{ message: { role: 'assistant', content: '{}' } }] };
        },
      },
    },
    files: {
      create: async () => assert.fail('unexpected upload'),
      delete: async () => {},
    },
  };

  await createKimiK3ChatCompletion({
    model: 'kimi-k3',
    messages: [{
      role: 'user',
      content: [{
        type: 'image_url',
        image_url: {
          url: 'https://media.example/frame.png',
          detail: 'high',
        },
      }],
    }],
  }, {
    client,
    resolveMediaUrl: async (value) => value,
    fetch: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    }),
  });

  const imageUrl = capturedPayload.messages[0].content[0].image_url;
  assert.match(imageUrl.url, /^data:image\/png;base64,/);
  assert.equal(Object.hasOwn(imageUrl, 'detail'), false);
});

test('Kimi K3 enforces the exclusive request-body boundary after base64 serialization', async () => {
  assert.equal(KIMI_K3_MAX_REQUEST_BODY_BYTES, 100 * 1024 * 1024);
  const client = {
    files: {
      create: async () => assert.fail('unexpected upload'),
      delete: async () => {},
    },
  };
  const request = {
    model: 'kimi-k3',
    messages: [{
      role: 'user',
      content: [{
        type: 'image_url',
        image_url: {
          url: 'data:image/png;base64,AQID',
          detail: 'high',
        },
      }],
    }],
  };

  const { payload } = await buildKimiK3ChatRequest(request, {
    client,
    maxRequestBodyBytes: 4096,
  });
  const serializedBytes = getKimiK3SerializedRequestBodyBytes(payload);
  assert.ok(serializedBytes > 3, 'serialized size must include base64 and JSON overhead');

  await assert.rejects(
    buildKimiK3ChatRequest(request, {
      client,
      maxRequestBodyBytes: serializedBytes,
    }),
    /request body must be smaller than the 100 MB request limit/,
  );
  await assert.doesNotReject(
    buildKimiK3ChatRequest(request, {
      client,
      maxRequestBodyBytes: serializedBytes + 1,
    }),
  );
});
