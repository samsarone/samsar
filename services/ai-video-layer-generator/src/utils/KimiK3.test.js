import assert from 'node:assert/strict';
import test from 'node:test';

import {
  KIMI_K3_PROVIDER_MODEL,
  KIMI_K3_REASONING_EFFORT,
  buildKimiK3ChatRequest,
  createKimiK3ChatCompletion,
  getKimiK3BaseURL,
  hasKimiK3NativeCredential,
} from './KimiK3.js';
import {
  isKimiInferenceModel,
  normalizeInferenceModel,
} from './GoogleGemini.js';

test('normalizes Kimi K3 aliases to the canonical inference model', () => {
  for (const alias of ['kimi-k3', 'KIMIK3', 'Kimi K3', 'Moonshot K3']) {
    assert.equal(normalizeInferenceModel(alias), 'kimi-k3');
    assert.equal(isKimiInferenceModel(alias), true);
  }
});

test('uses the international endpoint and only the dedicated Kimi credential', () => {
  assert.equal(getKimiK3BaseURL({}), 'https://api.moonshot.ai/v1');
  assert.equal(hasKimiK3NativeCredential({ KIMI_K3_API_KEY: 'test-key' }), true);
  assert.equal(hasKimiK3NativeCredential({ MOONSHOT_API_KEY: 'other-key' }), false);
});

test('preserves chat contracts while enforcing Kimi high reasoning and strict JSON', async () => {
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
    externalMaxRetries: 7,
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
  }, {
    client,
    resolveMediaUrl: async (value) => value,
  });

  assert.equal(payload.model, KIMI_K3_PROVIDER_MODEL);
  assert.equal(payload.reasoning_effort, KIMI_K3_REASONING_EFFORT);
  assert.equal(payload.messages[0].role, 'system');
  assert.equal(payload.max_completion_tokens, 321);
  assert.equal(payload.response_format.json_schema.strict, true);
  assert.equal(Object.hasOwn(payload, 'externalMaxRetries'), false);
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

test('converts public image URLs to inline data and removes OpenAI detail', async () => {
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

test('uploads video inputs once and removes the temporary Kimi file', async () => {
  const deletedFileIds = [];
  let capturedPayload;
  const client = {
    chat: {
      completions: {
        create: async (payload) => {
          capturedPayload = payload;
          return { choices: [{ message: { role: 'assistant', content: 'ok' } }] };
        },
      },
    },
    files: {
      create: async ({ purpose }) => {
        assert.equal(purpose, 'video');
        return { id: 'file-video-1' };
      },
      delete: async (fileId) => deletedFileIds.push(fileId),
    },
  };

  await createKimiK3ChatCompletion({
    messages: [{
      role: 'user',
      content: [{
        type: 'video_url',
        video_url: { url: 'https://media.example/clip.mp4' },
      }],
    }],
  }, {
    client,
    resolveMediaUrl: async (value) => value,
    fetch: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'video/mp4' },
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    }),
  });

  assert.equal(
    capturedPayload.messages[0].content[0].video_url.url,
    'ms://file-video-1',
  );
  assert.deepEqual(deletedFileIds, ['file-video-1']);
});
