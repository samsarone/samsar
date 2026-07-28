import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAlibabaQwenChatRequest,
  getAlibabaQwenApiKey,
  getAlibabaQwenBaseURL,
} from './AlibabaQwen.js';
import {
  isQwenInferenceModel,
  normalizeInferenceModel,
} from './GoogleGemini.js';

test('normalizes Qwen aliases to the canonical application setting', () => {
  assert.equal(normalizeInferenceModel('Qwen 3.7'), 'QWEN3.7');
  assert.equal(normalizeInferenceModel('qwen3.7-max'), 'QWEN3.7');
  assert.equal(isQwenInferenceModel('qwen3.7-plus'), true);
  assert.equal(normalizeInferenceModel('qwen3.8-max-preview'), 'QWEN3.7');
  assert.equal(normalizeInferenceModel('gpt-5.6-sol'), 'gpt-5.6-sol');
  assert.equal(normalizeInferenceModel('gemini-3.1-pro'), 'gemini-3.1-pro');
});

test('accepts all supported Alibaba Cloud API key aliases', () => {
  assert.equal(getAlibabaQwenApiKey({ DASHSCOPE_API_KEY: ' dash-key ' }), 'dash-key');
  assert.equal(getAlibabaQwenApiKey({ ALIBABA_CLOUD_API_KEY: 'cloud-key' }), 'cloud-key');
  assert.equal(getAlibabaQwenApiKey({ ALIBABA_API_KEY: 'alibaba-key' }), 'alibaba-key');
  assert.equal(getAlibabaQwenApiKey({ QWEN_API_KEY: 'qwen-key' }), 'qwen-key');
});

test('builds the workspace-compatible endpoint from ALIBABA_API_HOST', () => {
  assert.equal(
    getAlibabaQwenBaseURL({
      ALIBABA_API_HOST: 'ws-sj16tbvm14xuk9x1.ap-southeast-1.maas.aliyuncs.com',
    }),
    'https://ws-sj16tbvm14xuk9x1.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
  );
  assert.equal(
    getAlibabaQwenBaseURL({
      ALIBABA_API_HOST: 'https://ws-sj16tbvm14xuk9x1.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/',
    }),
    'https://ws-sj16tbvm14xuk9x1.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
  );
  assert.equal(
    getAlibabaQwenBaseURL({ ALIBABA_API_HOST: 'workspace.example.com/compatible-mode' }),
    'https://workspace.example.com/compatible-mode/v1',
  );
  assert.equal(
    getAlibabaQwenBaseURL({
      QWEN_BASE_URL: 'https://custom.example.com/v1/',
      ALIBABA_API_HOST: 'ignored.example.com',
    }),
    'https://custom.example.com/v1',
  );
});

test('selects Qwen 3.7 Plus for text and multimodal vision input', () => {
  const textRequest = buildAlibabaQwenChatRequest({
    model: 'QWEN3.7',
    messages: [{ role: 'user', content: 'Create a transition.' }],
  });
  const visionRequest = buildAlibabaQwenChatRequest({
    model: 'QWEN3.7',
    messages: [{
      role: 'user',
      content: [
        { type: 'input_text', text: 'Describe the frame.' },
        { type: 'input_image', image_url: 'data:image/png;base64,abc' },
      ],
    }],
  });
  const tokenPlanTextRequest = buildAlibabaQwenChatRequest({
    messages: [{ role: 'user', content: 'Create a transition.' }],
  }, { ALIBABA_QWEN_TEXT_MODEL: 'qwen3.8-max-preview' });

  assert.equal(textRequest.payload.model, 'qwen3.7-plus');
  assert.equal(tokenPlanTextRequest.payload.model, 'qwen3.8-max-preview');
  assert.equal(visionRequest.payload.model, 'qwen3.7-plus');
  assert.equal(textRequest.payload.enable_thinking, true);
});

test('disables hidden SDK retries so provider media is never reused after tunnel expiry', () => {
  const { payload, requestOptions } = buildAlibabaQwenChatRequest({
    model: 'QWEN3.7',
    externalMaxRetries: 7,
    maxRetries: 4,
    messages: [{ role: 'user', content: 'hello' }],
  });
  assert.equal(requestOptions.maxRetries, 0);
  assert.equal(Object.hasOwn(payload, 'externalMaxRetries'), false);
});

test('normalizes image, base64, video, and string Responses input forms', () => {
  const mediaRequest = buildAlibabaQwenChatRequest({
    model: 'QWEN3.7',
    messages: [{
      role: 'user',
      content: [
        { type: 'image', image: 'https://example.com/frame.png' },
        { type: 'input_image', source: { base64: 'abc', mime_type: 'image/jpeg' } },
        { type: 'video_url', video_url: 'https://example.com/clip.mp4' },
      ],
    }],
  });
  const stringInput = buildAlibabaQwenChatRequest({
    model: 'QWEN3.7',
    input: 'Create a transition.',
  });

  assert.deepEqual(mediaRequest.payload.messages[0].content[0], {
    type: 'image_url',
    image_url: { url: 'https://example.com/frame.png' },
  });
  assert.deepEqual(mediaRequest.payload.messages[0].content[1], {
    type: 'image_url',
    image_url: { url: 'data:image/jpeg;base64,abc' },
  });
  assert.deepEqual(mediaRequest.payload.messages[0].content[2], {
    type: 'video_url',
    video_url: { url: 'https://example.com/clip.mp4' },
  });
  assert.deepEqual(stringInput.payload.messages, [
    { role: 'user', content: 'Create a transition.' },
  ]);
});

test('expands media arrays into valid Qwen content parts instead of placing an array in url', () => {
  const request = buildAlibabaQwenChatRequest({
    messages: [{
      role: 'user',
      content: [{
        type: 'input_image',
        source: { urls: ['https://example.com/one.png', 'https://example.com/two.png'] },
      }],
    }],
  });

  assert.deepEqual(request.payload.messages[0].content, [
    { type: 'image_url', image_url: { url: 'https://example.com/one.png' } },
    { type: 'image_url', image_url: { url: 'https://example.com/two.png' } },
  ]);
});
