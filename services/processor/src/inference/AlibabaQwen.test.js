import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAlibabaQwenChatRequest,
  getAlibabaQwenApiKey,
  getAlibabaQwenBaseURL,
  hasQwenVisionInput,
} from './AlibabaQwen.js';

test('builds text-only Qwen requests with qwen3.7-max and thinking disabled', () => {
  const { payload } = buildAlibabaQwenChatRequest({
    model: 'QWEN3.7',
    messages: [
      { role: 'developer', content: 'Follow the instructions.' },
      { role: 'user', content: 'Write a short scene.' },
      { role: 'assistant', content: [{ type: 'output_text', text: 'Previous scene.' }] },
    ],
  });

  assert.equal(payload.model, 'qwen3.7-max');
  assert.equal(payload.enable_thinking, false);
  assert.equal(payload.messages[0].role, 'system');
  assert.deepEqual(payload.messages[2].content[0], { type: 'text', text: 'Previous scene.' });
  assert.equal(hasQwenVisionInput(payload.messages), false);
});

test('uses qwen3.7-plus only when a request includes vision content', () => {
  const { payload } = buildAlibabaQwenChatRequest({
    model: 'QWEN3.7',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Describe this frame.' },
          { type: 'input_image', image_url: 'data:image/png;base64,abc' },
        ],
      },
    ],
  });

  assert.equal(payload.model, 'qwen3.7-plus');
  assert.deepEqual(payload.messages[0].content[0], {
    type: 'text',
    text: 'Describe this frame.',
  });
  assert.deepEqual(payload.messages[0].content[1], {
    type: 'image_url',
    image_url: { url: 'data:image/png;base64,abc' },
  });

  const emptyVisionPart = buildAlibabaQwenChatRequest({
    model: 'QWEN3.7',
    messages: [{ role: 'user', content: [{ type: 'input_image', image_url: '' }] }],
  });
  assert.equal(emptyVisionPart.payload.model, 'qwen3.7-max');

  const alternateMediaShapes = buildAlibabaQwenChatRequest({
    model: 'QWEN3.7',
    messages: [{
      role: 'user',
      content: [
        { type: 'image', image: 'https://example.test/frame.png' },
        { type: 'input_image', source: { data: 'abc', mime_type: 'image/jpeg' } },
        {
          type: 'video_url',
          video_url: { url: ['https://example.test/one.png', 'https://example.test/two.png'] },
        },
      ],
    }],
  });
  assert.equal(alternateMediaShapes.payload.model, 'qwen3.7-plus');
  assert.equal(
    alternateMediaShapes.payload.messages[0].content[1].image_url.url,
    'data:image/jpeg;base64,abc',
  );
  assert.deepEqual(
    alternateMediaShapes.payload.messages[0].content[2].video_url.url,
    ['https://example.test/one.png', 'https://example.test/two.png'],
  );
});

test('converts JSON Schema response formats to Qwen JSON mode without changing the schema contract', () => {
  const schema = {
    type: 'object',
    properties: { narrative: { type: 'string' } },
    required: ['narrative'],
    additionalProperties: false,
  };
  const { payload } = buildAlibabaQwenChatRequest({
    model: 'QWEN3.7',
    messages: [{ role: 'user', content: 'Create the requested JSON narrative.' }],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'narrative_response', strict: true, schema },
    },
  });

  assert.deepEqual(payload.response_format, { type: 'json_object' });
  assert.equal(payload.messages[0].role, 'system');
  assert.match(payload.messages[0].content, /valid JSON only/);
  assert.match(payload.messages[0].content, /"narrative"/);
});

test('resolves standard and deployment-friendly Alibaba credential aliases', () => {
  assert.equal(getAlibabaQwenApiKey({ ALIBABA_API_KEY: ' primary-key ' }), 'primary-key');
  assert.equal(getAlibabaQwenApiKey({ DASHSCOPE_API_KEY: ' dashscope-key ' }), 'dashscope-key');
  assert.equal(getAlibabaQwenApiKey({ ALIBABA_CLOUD_API_KEY: 'alibaba-key' }), 'alibaba-key');
  assert.equal(getAlibabaQwenApiKey({ QWEN_API_KEY: 'qwen-key' }), 'qwen-key');
  assert.equal(
    getAlibabaQwenBaseURL({}),
    'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  );
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
      DASHSCOPE_BASE_URL: 'https://custom.example.com/v1/',
      ALIBABA_API_HOST: 'ignored.example.com',
    }),
    'https://custom.example.com/v1',
  );
});
