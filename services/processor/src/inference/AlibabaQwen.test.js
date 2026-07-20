import assert from 'node:assert/strict';
import test from 'node:test';
import OpenAI from 'openai';

import {
  buildAlibabaQwenChatRequest,
  createAlibabaQwenChatCompletion,
  getAlibabaQwenApiKey,
  getAlibabaQwenBaseURL,
  hasQwenVisionInput,
} from './AlibabaQwen.js';

test('builds text-only Qwen requests with qwen3.7-max and thinking enabled', () => {
  const { payload } = buildAlibabaQwenChatRequest({
    model: 'QWEN3.7',
    messages: [
      { role: 'developer', content: 'Follow the instructions.' },
      { role: 'user', content: 'Write a short scene.' },
      { role: 'assistant', content: [{ type: 'output_text', text: 'Previous scene.' }] },
    ],
  });

  assert.equal(payload.model, 'qwen3.7-max');
  assert.equal(payload.enable_thinking, true);
  assert.equal(payload.messages[0].role, 'system');
  assert.deepEqual(payload.messages[2].content[0], { type: 'text', text: 'Previous scene.' });
  assert.equal(hasQwenVisionInput(payload.messages), false);
});

test('uses qwen3.7-plus when a request includes vision content', () => {
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
  assert.deepEqual(alternateMediaShapes.payload.messages[0].content.slice(2), [
    {
      type: 'video_url',
      video_url: { url: 'https://example.test/one.png' },
    },
    {
      type: 'video_url',
      video_url: { url: 'https://example.test/two.png' },
    },
  ]);

  const typedListShape = buildAlibabaQwenChatRequest({
    model: 'QWEN3.7',
    messages: [{
      role: 'user',
      content: [{
        type: 'input_image',
        source: { urls: ['https://example.test/three.png'] },
      }],
    }],
  });
  assert.equal(typedListShape.payload.model, 'qwen3.7-plus');
  assert.equal(
    typedListShape.payload.messages[0].content[0].image_url.url,
    'https://example.test/three.png',
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

test('native Alibaba Qwen resolves typed media at its provider boundary', async (t) => {
  const previousApiKey = process.env.DASHSCOPE_API_KEY;
  process.env.DASHSCOPE_API_KEY = 'alibaba-media-test-key';
  let capturedPayload;
  let capturedOptions;
  t.mock.method(OpenAI.Chat.Completions.prototype, 'create', async (payload, options) => {
    capturedPayload = payload;
    capturedOptions = options;
    return { choices: [{ message: { role: 'assistant', content: 'seen' } }] };
  });

  try {
    const response = await createAlibabaQwenChatCompletion({
      model: 'QWEN3.7',
      messages: [{
        role: 'user',
        content: [{
          type: 'input_image',
          source: 'http://localhost:3002/assets_v2/generations/session/qwen.png',
        }],
      }],
    }, {
      resolveMediaUrl: async (_source, options) => {
        assert.deepEqual(options, {
          mediaKind: 'image',
          serviceName: 'samsar_processor_alibaba_qwen',
        });
        return 'https://fresh.example/assets_v2/generations/session/qwen.png';
      },
    });

    assert.equal(response.choices[0].message.content, 'seen');
    assert.equal(
      capturedPayload.messages[0].content[0].image_url.url,
      'https://fresh.example/assets_v2/generations/session/qwen.png',
    );
    assert.equal(capturedOptions.maxRetries, 0);
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.DASHSCOPE_API_KEY;
    } else {
      process.env.DASHSCOPE_API_KEY = previousApiKey;
    }
  }
});
