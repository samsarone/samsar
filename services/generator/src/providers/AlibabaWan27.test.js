import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractAlibabaWan27ImageUrl,
  getAlibabaWan27ApiKey,
  getAlibabaWan27GenerationUrl,
  requestAlibabaWan27Image,
} from './AlibabaWan27.js';

test('resolves Alibaba credentials in deployment priority order', () => {
  assert.equal(getAlibabaWan27ApiKey({
    QWEN_API_KEY: 'qwen',
    DASHSCOPE_API_KEY: 'dashscope',
    ALIBABA_API_KEY: 'alibaba',
  }), 'alibaba');
  assert.equal(getAlibabaWan27ApiKey({ DASHSCOPE_API_KEY: ' dashscope ' }), 'dashscope');
});

test('builds the Alibaba Wan image URL for shared and workspace hosts', () => {
  assert.equal(
    getAlibabaWan27GenerationUrl({}),
    'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
  );
  assert.equal(
    getAlibabaWan27GenerationUrl({
      ALIBABA_API_HOST: 'workspace.ap-southeast-1.maas.aliyuncs.com',
    }),
    'https://workspace.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
  );
  assert.equal(
    getAlibabaWan27GenerationUrl({
      DASHSCOPE_BASE_URL: 'https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/',
    }),
    'https://workspace.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
  );
  assert.equal(
    getAlibabaWan27GenerationUrl({
      ALIBABA_CLOUD_BASE_URL: 'https://proxy.example.com/alibaba/v1',
    }),
    'https://proxy.example.com/alibaba/api/v1/services/aigc/multimodal-generation/generation',
  );
});

test('extracts the native Wan image URL from Alibaba response choices', () => {
  assert.equal(extractAlibabaWan27ImageUrl({
    output: {
      choices: [{
        message: {
          content: [{ type: 'image', image: 'https://example.com/generated.png' }],
        },
      }],
    },
  }), 'https://example.com/generated.png');
});

test('calls the synchronous Alibaba endpoint with the normalized payload', async () => {
  let request;
  const result = await requestAlibabaWan27Image(
    { prompt: 'A wide desert landscape', aspectRatio: '16:9' },
    {
      env: { DASHSCOPE_API_KEY: 'test-key' },
      fetchImpl: async (...args) => {
        request = args;
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            output: {
              choices: [{ message: { content: [{ image: 'https://example.com/wan.png' }] } }],
              finished: true,
            },
            request_id: 'request-123',
          }),
        };
      },
    },
  );

  assert.equal(request[0],
    'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
  assert.equal(request[1].headers.Authorization, 'Bearer test-key');
  assert.deepEqual(JSON.parse(request[1].body), {
    model: 'wan2.7-image-pro',
    input: {
      messages: [{ role: 'user', content: [{ text: 'A wide desert landscape' }] }],
    },
    parameters: {
      size: '1792*1024',
      n: 1,
      watermark: false,
      thinking_mode: true,
    },
  });
  assert.deepEqual(result, {
    imageUrl: 'https://example.com/wan.png',
    requestId: 'request-123',
    usage: null,
  });
});

test('does not expose an Alibaba API key in provider errors', async () => {
  await assert.rejects(
    requestAlibabaWan27Image(
      { prompt: 'test' },
      {
        env: { ALIBABA_API_KEY: 'secret-test-key' },
        fetchImpl: async () => ({
          ok: false,
          status: 401,
          text: async () => JSON.stringify({ code: 'InvalidApiKey', message: 'Rejected' }),
        }),
      },
    ),
    (error) => {
      assert.equal(error.message, 'Rejected');
      assert.equal(JSON.stringify(error).includes('secret-test-key'), false);
      return true;
    },
  );
});
