import assert from 'node:assert/strict';
import test from 'node:test';

import {
  KIMI_K3_BASE_URL,
  KIMI_K3_REASONING_EFFORT,
  buildKimiK3ChatCompletionPayload,
  getKimiK3ApiKey,
  hasKimiK3ApiKey,
} from './KimiK3.js';

test('Kimi K3 uses the dedicated credential and international endpoint', () => {
  assert.equal(KIMI_K3_BASE_URL, 'https://api.moonshot.ai/v1');
  assert.equal(getKimiK3ApiKey({ KIMI_K3_API_KEY: ' test-key ' }), 'test-key');
  assert.equal(hasKimiK3ApiKey({ KIMI_K3_API_KEY: 'test-key' }), true);
  assert.equal(hasKimiK3ApiKey({ MOONSHOT_API_KEY: 'other-key' }), false);
});

test('Kimi K3 preserves chat contracts while enforcing high reasoning and strict JSON', async () => {
  const payload = await buildKimiK3ChatCompletionPayload({
    model: 'KIMIK3',
    effort: 'xhigh',
    reasoningEffort: 'xhigh',
    messages: [
      { role: 'developer', content: 'Return structured data.' },
      { role: 'user', content: ['Hello'] },
    ],
    temperature: 0,
    top_p: 0.5,
    n: 2,
    presence_penalty: 1,
    frequency_penalty: 1,
    reasoning: { effort: 'low' },
    reasoning_effort: 'low',
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
  });

  assert.equal(payload.model, 'kimi-k3');
  assert.equal(payload.reasoning_effort, KIMI_K3_REASONING_EFFORT);
  assert.equal(payload.messages[0].role, 'system');
  assert.deepEqual(payload.messages[1].content, [{ type: 'text', text: 'Hello' }]);
  assert.equal(payload.max_completion_tokens, 321);
  assert.equal(payload.response_format.json_schema.strict, true);
  for (const unsupported of [
    'temperature',
    'top_p',
    'n',
    'presence_penalty',
    'frequency_penalty',
    'effort',
    'reasoningEffort',
    'reasoning',
  ]) {
    assert.equal(Object.hasOwn(payload, unsupported), false);
  }
});

test('Kimi K3 inlines public vision URLs and removes unsupported detail', async () => {
  const payload = await buildKimiK3ChatCompletionPayload({
    messages: [{
      role: 'user',
      content: [{
        type: 'image_url',
        image_url: {
          url: 'https://media.example/frame.webp',
          detail: 'high',
        },
      }, {
        type: 'image_url',
        image_url: 'https://media.example/frame.webp',
        detail: 'high',
      }],
    }],
  }, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'image/webp' },
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    }),
  });

  const [objectImage, stringImage] = payload.messages[0].content;
  for (const image of [objectImage, stringImage]) {
    assert.equal(image.type, 'image_url');
    assert.match(image.image_url.url, /^data:image\/webp;base64,/);
    assert.equal(Object.hasOwn(image, 'detail'), false);
    assert.equal(Object.hasOwn(image.image_url, 'detail'), false);
  }
});
