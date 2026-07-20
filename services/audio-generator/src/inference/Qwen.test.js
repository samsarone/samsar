import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildQwenChatCompletionPayload,
  getAlibabaCloudApiKey,
  getAlibabaCloudBaseUrl,
  hasQwenMultimodalInput,
  resolveQwenProviderModel,
} from './Qwen.js';

test('uses Qwen 3.7 Max for text and Qwen 3.7 Plus for multimodal content', () => {
  const textRequest = {
    model: 'QWEN3.7',
    messages: [{ role: 'user', content: 'Rewrite a music prompt.' }],
  };
  assert.equal(hasQwenMultimodalInput(textRequest), false);
  assert.equal(resolveQwenProviderModel(textRequest, {}), 'qwen3.7-max');

  const videoRequest = {
    model: 'QWEN3.7',
    messages: [{
      role: 'user',
      content: [{ type: 'video_url', video_url: { url: 'https://example.test/clip.mp4' } }],
    }],
  };
  assert.equal(hasQwenMultimodalInput(videoRequest), true);
  assert.equal(resolveQwenProviderModel(videoRequest, {}), 'qwen3.7-plus');

  const alternateMediaShapes = buildQwenChatCompletionPayload({
    model: 'QWEN3.7',
    messages: [{
      role: 'user',
      content: [
        { type: 'input_image', source: { data: 'abc', mime_type: 'image/jpeg' } },
        { type: 'input_image', source: { urls: ['https://example.test/still-0.png'] } },
        { imageUrls: ['https://example.test/still-1.png', 'https://example.test/still-2.png'] },
        {
          type: 'video_url',
          video_url: { url: ['https://example.test/frame-1.png', 'https://example.test/frame-2.png'] },
        },
      ],
    }],
  }, {});
  assert.equal(alternateMediaShapes.model, 'qwen3.7-plus');
  assert.equal(
    alternateMediaShapes.messages[0].content[0].image_url.url,
    'data:image/jpeg;base64,abc',
  );
  assert.deepEqual(
    alternateMediaShapes.messages[0].content.slice(1, 4).map((item) => item.image_url.url),
    [
      'https://example.test/still-0.png',
      'https://example.test/still-1.png',
      'https://example.test/still-2.png',
    ],
  );
  assert.deepEqual(
    alternateMediaShapes.messages[0].content.slice(4).map((item) => item.video_url.url),
    ['https://example.test/frame-1.png', 'https://example.test/frame-2.png'],
  );
});

test('preserves the structured response contract in the compatible request', () => {
  const responseFormat = {
    type: 'json_schema',
    json_schema: {
      name: 'music_prompt',
      schema: { type: 'object', properties: { content: { type: 'string' } } },
    },
  };
  const payload = buildQwenChatCompletionPayload({
    model: 'QWEN3.7',
    messages: [{ role: 'developer', content: 'Return JSON.' }],
    response_format: responseFormat,
    reasoning_effort: 'xhigh',
  }, {});

  assert.equal(payload.model, 'qwen3.7-max');
  assert.equal(payload.messages[0].role, 'system');
  assert.match(payload.messages[0].content, /JSON Schema exactly/);
  assert.match(payload.messages[0].content, /"content"/);
  assert.deepEqual(payload.response_format, { type: 'json_object' });
  assert.equal(payload.enable_thinking, true);
  assert.equal('reasoning_effort' in payload, false);
});

test('accepts Alibaba Cloud, Alibaba, DashScope, and Qwen API key aliases', () => {
  assert.equal(getAlibabaCloudApiKey({ ALIBABA_CLOUD_API_KEY: 'ali-key' }), 'ali-key');
  assert.equal(getAlibabaCloudApiKey({ ALIBABA_API_KEY: 'alibaba-key' }), 'alibaba-key');
  assert.equal(getAlibabaCloudApiKey({ DASHSCOPE_API_KEY: 'dash-key' }), 'dash-key');
  assert.equal(getAlibabaCloudApiKey({ QWEN_API_KEY: 'qwen-key' }), 'qwen-key');
});

test('normalizes ALIBABA_API_HOST as a compatible-mode base URL', () => {
  const expectedBaseUrl = 'https://dashscope.example.test/compatible-mode/v1';

  assert.equal(
    getAlibabaCloudBaseUrl({ ALIBABA_API_HOST: 'dashscope.example.test' }),
    expectedBaseUrl,
  );
  assert.equal(
    getAlibabaCloudBaseUrl({ ALIBABA_API_HOST: 'https://dashscope.example.test' }),
    expectedBaseUrl,
  );
  assert.equal(
    getAlibabaCloudBaseUrl({ ALIBABA_API_HOST: 'dashscope.example.test/compatible-mode' }),
    expectedBaseUrl,
  );
  assert.equal(
    getAlibabaCloudBaseUrl({
      ALIBABA_API_HOST: 'https://dashscope.example.test/compatible-mode/v1/',
    }),
    expectedBaseUrl,
  );
});

test('preserves existing Alibaba base URL aliases and the default endpoint', () => {
  assert.equal(
    getAlibabaCloudBaseUrl({
      ALIBABA_CLOUD_BASE_URL: 'https://cloud.example.test/custom/v1/',
      ALIBABA_API_HOST: 'ignored.example.test',
    }),
    'https://cloud.example.test/custom/v1',
  );
  assert.equal(
    getAlibabaCloudBaseUrl({ DASHSCOPE_BASE_URL: 'https://dash.example.test/api/' }),
    'https://dash.example.test/api',
  );
  assert.equal(
    getAlibabaCloudBaseUrl({ QWEN_BASE_URL: 'https://qwen.example.test/v1/' }),
    'https://qwen.example.test/v1',
  );
  assert.equal(
    getAlibabaCloudBaseUrl({}),
    'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  );
});
