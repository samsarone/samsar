import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildQwenChatCompletionPayload,
  getAlibabaCloudApiKey,
  getAlibabaCloudBaseUrl,
  hasQwenMultimodalInput,
  resolveQwenProviderModel,
} from './Qwen.js';

test('uses Qwen 3.8 Max for text and multimodal content', () => {
  const textRequest = {
    model: 'QWEN3.8',
    messages: [{ role: 'user', content: 'Write a scene.' }],
  };
  assert.equal(hasQwenMultimodalInput(textRequest), false);
  assert.equal(resolveQwenProviderModel(textRequest, {}), 'qwen3.8-max');
  assert.equal(
    resolveQwenProviderModel(textRequest, { ALIBABA_QWEN_TEXT_MODEL: 'qwen3.8-max-custom' }),
    'qwen3.8-max-custom',
  );
  assert.equal(
    resolveQwenProviderModel(textRequest, { QWEN_38_MAX_MODEL: 'qwen3.8-max-regional' }),
    'qwen3.8-max-regional',
  );

  const imageRequest = {
    model: 'QWEN3.8',
    messages: [{
      role: 'user',
      content: [
        { type: 'input_text', text: 'Describe this image.' },
        { type: 'input_image', image_url: 'data:image/png;base64,AA==' },
      ],
    }],
  };
  assert.equal(hasQwenMultimodalInput(imageRequest), true);
  assert.equal(resolveQwenProviderModel(imageRequest, {}), 'qwen3.8-max');
  assert.equal(
    resolveQwenProviderModel(imageRequest, {
      ALIBABA_QWEN_38_MAX_MODEL: 'qwen3.8-max-vision-regional',
    }),
    'qwen3.8-max-vision-regional',
  );
  const sharedOverride = {
    ALIBABA_QWEN_MODEL: 'qwen3.8-max-shared',
    ALIBABA_QWEN_TEXT_MODEL: 'ignored-text-model',
  };
  assert.equal(resolveQwenProviderModel(textRequest, sharedOverride), 'qwen3.8-max-shared');
  assert.equal(resolveQwenProviderModel(imageRequest, sharedOverride), 'qwen3.8-max-shared');

  const compatibleVisionPayload = buildQwenChatCompletionPayload({
    model: 'QWEN3.8',
    effort: 'xhigh',
    reasoningEffort: 'xhigh',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Describe this generated frame.' },
        { type: 'image_url', image_url: { url: 'https://example.test/frame.png' } },
      ],
    }],
  }, {});
  assert.equal(compatibleVisionPayload.model, 'qwen3.8-max');
  assert.equal(Object.hasOwn(compatibleVisionPayload, 'effort'), false);
  assert.equal(Object.hasOwn(compatibleVisionPayload, 'reasoningEffort'), false);
  assert.deepEqual(compatibleVisionPayload.messages[0].content[1], {
    type: 'image_url',
    image_url: { url: 'https://example.test/frame.png' },
  });

  const emptyImagePart = {
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: '' },
        { type: 'image_url', image_url: { url: '' } },
      ],
    }],
  };
  assert.equal(hasQwenMultimodalInput(emptyImagePart), false);

  const alternateMediaShapes = buildQwenChatCompletionPayload({
    model: 'QWEN3.8',
    messages: [{
      role: 'user',
      content: [
        { type: 'input_image', source: { data: 'abc', mime_type: 'image/jpeg' } },
        {
          type: 'video_url',
          video_url: { url: ['https://example.test/frame-1.png', 'https://example.test/frame-2.png'] },
        },
      ],
    }],
  }, {});
  assert.equal(alternateMediaShapes.model, 'qwen3.8-max');
  assert.equal(
    alternateMediaShapes.messages[0].content[0].image_url.url,
    'data:image/jpeg;base64,abc',
  );
  assert.deepEqual(alternateMediaShapes.messages[0].content.slice(1), [
    {
      type: 'video_url',
      video_url: { url: 'https://example.test/frame-1.png' },
    },
    {
      type: 'video_url',
      video_url: { url: 'https://example.test/frame-2.png' },
    },
  ]);

  const nestedListShape = buildQwenChatCompletionPayload({
    model: 'QWEN3.8',
    messages: [{
      role: 'user',
      content: [{
        type: 'input_image',
        source: { urls: ['https://example.test/frame-3.png'] },
      }],
    }],
  }, {});
  assert.equal(nestedListShape.model, 'qwen3.8-max');
  assert.equal(
    nestedListShape.messages[0].content[0].image_url.url,
    'https://example.test/frame-3.png',
  );
});

test('preserves the structured JSON contract and normalizes Responses content', () => {
  const responseFormat = {
    type: 'json_schema',
    json_schema: {
      name: 'narrative',
      strict: true,
      schema: { type: 'object', properties: { title: { type: 'string' } } },
    },
  };
  const payload = buildQwenChatCompletionPayload({
    model: 'QWEN3.8',
    input: [{
      role: 'developer',
      content: [{ type: 'input_text', text: 'Return JSON.' }],
    }],
    max_output_tokens: 321,
    reasoning: { effort: 'xhigh' },
    response_format: responseFormat,
  }, {});

  assert.equal(payload.model, 'qwen3.8-max');
  assert.equal(payload.messages[0].role, 'system');
  assert.equal(payload.messages[0].content[0].text, 'Return JSON.');
  assert.match(payload.messages[0].content[1].text, /JSON Schema exactly/);
  assert.match(payload.messages[0].content[1].text, /"title"/);
  assert.equal(payload.max_tokens, 321);
  assert.deepEqual(payload.response_format, { type: 'json_object' });
  assert.equal(payload.enable_thinking, true);
  assert.equal('reasoning' in payload, false);
});

test('accepts Alibaba Cloud, Alibaba, DashScope, and Qwen API key aliases', () => {
  assert.equal(getAlibabaCloudApiKey({ ALIBABA_CLOUD_API_KEY: ' ali-key ' }), 'ali-key');
  assert.equal(getAlibabaCloudApiKey({ ALIBABA_API_KEY: 'alibaba-key' }), 'alibaba-key');
  assert.equal(getAlibabaCloudApiKey({ DASHSCOPE_API_KEY: 'dash-key' }), 'dash-key');
  assert.equal(getAlibabaCloudApiKey({ QWEN_API_KEY: 'qwen-key' }), 'qwen-key');
});

test('normalizes ALIBABA_API_HOST without duplicating the compatible-mode path', () => {
  assert.equal(
    getAlibabaCloudBaseUrl({ ALIBABA_API_HOST: 'workspace.example.com' }),
    'https://workspace.example.com/compatible-mode/v1',
  );
  assert.equal(
    getAlibabaCloudBaseUrl({ ALIBABA_API_HOST: 'http://workspace.example.com' }),
    'http://workspace.example.com/compatible-mode/v1',
  );
  assert.equal(
    getAlibabaCloudBaseUrl({
      ALIBABA_API_HOST: 'https://workspace.example.com/compatible-mode/v1/',
    }),
    'https://workspace.example.com/compatible-mode/v1',
  );
  assert.equal(
    getAlibabaCloudBaseUrl({ ALIBABA_API_HOST: 'workspace.example.com/compatible-mode' }),
    'https://workspace.example.com/compatible-mode/v1',
  );
});

test('keeps existing Alibaba base URL aliases ahead of ALIBABA_API_HOST and preserves the default', () => {
  assert.equal(
    getAlibabaCloudBaseUrl({
      ALIBABA_CLOUD_BASE_URL: 'https://custom.example.com/alibaba/',
      ALIBABA_API_HOST: 'ignored.example.com',
    }),
    'https://custom.example.com/alibaba',
  );
  assert.equal(
    getAlibabaCloudBaseUrl({
      DASHSCOPE_BASE_URL: 'https://custom.example.com/dashscope/',
      ALIBABA_API_HOST: 'ignored.example.com',
    }),
    'https://custom.example.com/dashscope',
  );
  assert.equal(
    getAlibabaCloudBaseUrl({
      QWEN_BASE_URL: 'https://custom.example.com/qwen/',
      ALIBABA_API_HOST: 'ignored.example.com',
    }),
    'https://custom.example.com/qwen',
  );
  assert.equal(
    getAlibabaCloudBaseUrl({}),
    'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  );
});
