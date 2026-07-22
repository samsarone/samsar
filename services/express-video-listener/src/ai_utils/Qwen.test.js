import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildQwenRequestOptions,
  buildQwenChatCompletionPayload,
  getAlibabaCloudApiKey,
  getAlibabaCloudBaseUrl,
  hasQwenMultimodalInput,
  resolveQwenProviderModel,
} from './Qwen.js';

test('Qwen dispatch disables hidden SDK retries after media normalization', () => {
  assert.deepEqual(
    buildQwenRequestOptions({ timeout: 1234, maxRetries: 8 }),
    { timeout: 1234, maxRetries: 0 },
  );
});

test('uses Qwen 3.7 Plus for text, image, and video content', () => {
  const textRequest = {
    model: 'QWEN3.7',
    messages: [{ role: 'user', content: 'Write an image-rich scene.' }],
  };
  assert.equal(hasQwenMultimodalInput(textRequest), false);
  assert.equal(resolveQwenProviderModel(textRequest, {}), 'qwen3.7-plus');
  assert.equal(
    resolveQwenProviderModel(textRequest, { ALIBABA_QWEN_TEXT_MODEL: 'qwen3.8-max-preview' }),
    'qwen3.8-max-preview',
  );

  const imageRequest = {
    model: 'QWEN3.7',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Describe this frame.' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } },
      ],
    }],
  };
  assert.equal(hasQwenMultimodalInput(imageRequest), true);
  assert.equal(resolveQwenProviderModel(imageRequest), 'qwen3.7-plus');

  const videoRequest = {
    messages: [{
      role: 'user',
      content: [{ type: 'input_video', video_url: 'https://media.example/clip.mp4' }],
    }],
  };
  assert.equal(hasQwenMultimodalInput(videoRequest), true);
  assert.equal(resolveQwenProviderModel(videoRequest), 'qwen3.7-plus');

  assert.equal(hasQwenMultimodalInput({
    messages: [{ role: 'user', content: [{ type: 'image_url', image_url: {} }] }],
  }), false);
  assert.equal(hasQwenMultimodalInput({
    messages: [{ role: 'user', content: [{ type: 'video_url', video_url: { url: '' } }] }],
  }), false);
});

test('preserves structured JSON contracts through DashScope JSON mode', () => {
  const responseFormat = {
    type: 'json_schema',
    json_schema: {
      name: 'narrative',
      strict: true,
      schema: {
        type: 'object',
        properties: { title: { type: 'string' } },
        required: ['title'],
        additionalProperties: false,
      },
    },
  };
  const payload = buildQwenChatCompletionPayload({
    model: 'QWEN3.7',
    input: [{
      role: 'developer',
      content: [{ type: 'input_text', text: 'Return the narrative JSON.' }],
    }],
    max_output_tokens: 321,
    reasoning: { effort: 'xhigh' },
    response_format: responseFormat,
  });

  assert.equal(payload.model, 'qwen3.7-plus');
  assert.equal(payload.enable_thinking, true);
  assert.equal(payload.messages[0].role, 'system');
  assert.equal(payload.messages[0].content[0].text, 'Return the narrative JSON.');
  assert.match(payload.messages[0].content[1].text, /Return valid JSON only/);
  assert.match(payload.messages[0].content[1].text, /"title"/);
  assert.equal(payload.max_tokens, 321);
  assert.deepEqual(payload.response_format, { type: 'json_object' });
  assert.deepEqual(responseFormat.json_schema.schema.required, ['title']);
  assert.equal('reasoning' in payload, false);
  assert.equal('reasoning_effort' in payload, false);
});

test('normalizes multimodal content for the DashScope chat-completions API', () => {
  const payload = buildQwenChatCompletionPayload({
    model: 'QWEN3.7',
    messages: [{
      role: 'developer',
      content: [
        { type: 'input_text', text: 'Describe the media.' },
        { type: 'input_image', image_url: 'https://media.example/frame.png', detail: 'low' },
        { type: 'input_video', video_url: { url: 'https://media.example/clip.mp4' } },
        {
          type: 'video_url',
          video_url: {
            url: [
              'https://media.example/frame-1.png',
              'https://media.example/frame-2.png',
            ],
          },
        },
        {
          type: 'input_image',
          source: { urls: ['https://media.example/frame-3.png'] },
        },
      ],
    }],
  });

  assert.equal(payload.model, 'qwen3.7-plus');
  assert.equal(payload.messages[0].role, 'system');
  assert.deepEqual(payload.messages[0].content, [
    { type: 'text', text: 'Describe the media.' },
    {
      type: 'image_url',
      image_url: { url: 'https://media.example/frame.png', detail: 'low' },
    },
    {
      type: 'video_url',
      video_url: { url: 'https://media.example/clip.mp4' },
    },
    {
      type: 'video_url',
      video_url: { url: 'https://media.example/frame-1.png' },
    },
    {
      type: 'video_url',
      video_url: { url: 'https://media.example/frame-2.png' },
    },
    {
      type: 'image_url',
      image_url: { url: 'https://media.example/frame-3.png' },
    },
  ]);
});

test('accepts deployment-friendly Alibaba credentials and defaults to the international endpoint', () => {
  assert.equal(getAlibabaCloudApiKey({ DASHSCOPE_API_KEY: ' dash-key ' }), 'dash-key');
  assert.equal(getAlibabaCloudApiKey({ ALIBABA_CLOUD_API_KEY: 'ali-key' }), 'ali-key');
  assert.equal(getAlibabaCloudApiKey({ ALIBABA_API_KEY: 'alibaba-key' }), 'alibaba-key');
  assert.equal(getAlibabaCloudApiKey({ QWEN_API_KEY: 'qwen-key' }), 'qwen-key');
  assert.equal(
    getAlibabaCloudBaseUrl({}),
    'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  );
  assert.equal(
    getAlibabaCloudBaseUrl({
      ALIBABA_API_HOST: 'ws-sj16tbvm14xuk9x1.ap-southeast-1.maas.aliyuncs.com',
    }),
    'https://ws-sj16tbvm14xuk9x1.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
  );
  assert.equal(
    getAlibabaCloudBaseUrl({
      ALIBABA_API_HOST: 'https://ws-sj16tbvm14xuk9x1.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/',
    }),
    'https://ws-sj16tbvm14xuk9x1.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
  );
  assert.equal(
    getAlibabaCloudBaseUrl({ ALIBABA_API_HOST: 'workspace.example.com/compatible-mode' }),
    'https://workspace.example.com/compatible-mode/v1',
  );
  assert.equal(
    getAlibabaCloudBaseUrl({
      ALIBABA_CLOUD_BASE_URL: 'https://custom.example.com/v1/',
      ALIBABA_API_HOST: 'ignored.example.com',
    }),
    'https://custom.example.com/v1',
  );
});
