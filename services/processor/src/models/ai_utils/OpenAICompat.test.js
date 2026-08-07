import assert from 'node:assert/strict';
import test from 'node:test';

import { INFERENCE_MODELS } from '../../consts/InferenceModels.js';
import { buildAlibabaQwenChatRequest } from '../../inference/AlibabaQwen.js';
import {
  buildProviderPinnedChatRequest,
  createCompatibleChatCompletion,
  isRetryableInferenceAdapterError,
  runInferenceAdapterFallback,
} from './OpenAICompat.js';

test('forces high reasoning for GPT 5.6 Sol Responses requests', async () => {
  let capturedPath;
  let capturedBody;
  const openaiClient = {
    async post(path, options) {
      capturedPath = path;
      capturedBody = options.body;
      return {
        id: 'resp-test',
        model: 'gpt-5.6-sol',
        output_text: 'ok',
      };
    },
  };

  const response = await createCompatibleChatCompletion(openaiClient, {
    model: 'gpt-5.6-sol',
    messages: [{ role: 'user', content: 'hello' }],
    reasoning: { effort: 'low' },
  });

  assert.equal(capturedPath, '/responses');
  assert.deepEqual(capturedBody.reasoning, { effort: 'high' });
  assert.equal(response.choices[0].message.content, 'ok');
});

test('preserves GPT 5.6 Luna and forces xhigh for publication metadata requests', async () => {
  let capturedBody;
  const openaiClient = {
    async post(_path, options) {
      capturedBody = options.body;
      return {
        id: 'resp-metadata-test',
        model: INFERENCE_MODELS.PublicationMetadata,
        output_text: 'metadata',
      };
    },
  };

  await createCompatibleChatCompletion(openaiClient, {
    model: INFERENCE_MODELS.PublicationMetadata,
    messages: [{ role: 'user', content: 'generate metadata' }],
    reasoning: { effort: 'low' },
  });

  assert.equal(capturedBody.model, 'gpt-5.6-luna');
  assert.deepEqual(capturedBody.reasoning, { effort: 'xhigh' });
});

test('resolves multimodal media immediately before a native OpenAI Responses request', async () => {
  let capturedBody;
  let capturedOptions;
  const sourceMessages = [{
    role: 'user',
    content: [{
      type: 'image_url',
      image_url: {
        url: 'http://localhost:3002/assets_v2/generations/session/frame.png',
        detail: 'high',
      },
    }],
  }];
  const originalMessages = JSON.parse(JSON.stringify(sourceMessages));
  const openaiClient = {
    async post(_path, options) {
      capturedOptions = options;
      capturedBody = options.body;
      return { id: 'resp-media-test', model: 'gpt-5.6-sol', output_text: 'seen' };
    },
  };

  await createCompatibleChatCompletion(openaiClient, {
    model: 'gpt-5.6-sol',
    messages: sourceMessages,
  }, {
    resolveMediaUrl: async (source, options) => {
      assert.equal(source, originalMessages[0].content[0].image_url.url);
      assert.deepEqual(options, {
        mediaKind: 'image',
        serviceName: 'samsar_processor_openai_responses',
      });
      return 'https://fresh.example/assets_v2/generations/session/frame.png';
    },
  });

  assert.deepEqual(sourceMessages, originalMessages);
  assert.deepEqual(capturedBody.input[0].content[0], {
    type: 'input_image',
    image_url: 'https://fresh.example/assets_v2/generations/session/frame.png',
    detail: 'high',
  });
  assert.equal(capturedOptions.maxRetries, 0);
});

test('/external native GPT vision preserves the existing max_tokens Responses translation', async () => {
  let capturedBody;
  const openaiClient = {
    async post(path, options) {
      assert.equal(path, '/responses');
      capturedBody = options.body;
      return {
        id: 'resp-external-vision',
        model: 'gpt-5.6-sol',
        output_text: 'described',
      };
    },
  };
  const messages = [{
    role: 'user',
    content: [{
      type: 'image_url',
      image_url: {
        url: 'http://localhost:3002/assets_v2/generations/session/external.png',
      },
    }],
  }];

  await createCompatibleChatCompletion(openaiClient, {
    model: 'gpt-5.6-sol',
    messages,
    bypassSamsarExternalInference: true,
    max_tokens: 16384,
  }, {
    resolveMediaUrl: async () => 'https://fresh.example/external.png',
  });

  assert.equal(capturedBody.max_output_tokens, 16384);
  assert.equal(capturedBody.input[0].content[0].type, 'input_image');
  assert.equal(Object.hasOwn(capturedBody, 'max_tokens'), false);
  assert.equal(Object.hasOwn(capturedBody, 'max_completion_tokens'), false);
});

test('routes Kimi K3 through its native high-reasoning chat adapter', async () => {
  let capturedPayload;
  const kimiClient = {
    chat: {
      completions: {
        create: async (payload) => {
          capturedPayload = payload;
          return {
            model: 'kimi-k3',
            choices: [{ message: { role: 'assistant', content: '{"ok":true}' } }],
          };
        },
      },
    },
    files: {
      create: async () => assert.fail('unexpected upload'),
      delete: async () => {},
    },
  };

  const response = await createCompatibleChatCompletion({}, {
    model: 'KIMIK3',
    messages: [{ role: 'developer', content: 'Return JSON.' }],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'result',
        schema: {
          type: 'object',
          properties: { ok: { type: 'boolean' } },
          required: ['ok'],
          additionalProperties: false,
        },
      },
    },
  }, { client: kimiClient });

  assert.equal(capturedPayload.model, 'kimi-k3');
  assert.equal(capturedPayload.reasoning_effort, 'high');
  assert.equal(capturedPayload.messages[0].role, 'system');
  assert.equal(capturedPayload.response_format.json_schema.strict, true);
  assert.equal(response.choices[0].message.content, '{"ok":true}');
});

test('adapter fallback follows preference order after a retryable provider failure', async () => {
  const attempts = [];
  const response = await runInferenceAdapterFallback(
    ['openrouter', 'samsar'],
    async (provider) => {
      attempts.push(provider);
      if (provider === 'openrouter') {
        const error = new Error('rate limited');
        error.status = 429;
        throw error;
      }
      return { provider };
    },
  );

  assert.deepEqual(attempts, ['openrouter', 'samsar']);
  assert.deepEqual(response, { provider: 'samsar' });
});

test('adapter fallback does not hide a non-retryable request error', async () => {
  const attempts = [];
  await assert.rejects(
    runInferenceAdapterFallback(
      ['openai', 'samsar'],
      async (provider) => {
        attempts.push(provider);
        const error = new Error('invalid schema');
        error.status = 400;
        throw error;
      },
    ),
    /invalid schema/,
  );

  assert.deepEqual(attempts, ['openai']);
  assert.equal(isRetryableInferenceAdapterError({ status: 503 }), false);
  assert.equal(isRetryableInferenceAdapterError({ status: 400 }), false);
});

test('automatic adapter attempts disable provider-local retries and preserve provider pins', () => {
  assert.deepEqual(
    buildProviderPinnedChatRequest(
      { model: 'gpt-5.6-sol', maxRetries: 4, externalMaxRetries: 4 },
      'openrouter',
    ),
    {
      model: 'gpt-5.6-sol',
      maxRetries: 0,
      externalMaxRetries: 0,
      authorization: 'openrouter',
      bypassSamsarExternalInference: false,
      samsarExternalInference: true,
    },
  );
});

test('automatic retry metadata does not leak into native Qwen payloads', () => {
  const { payload, requestOptions } = buildAlibabaQwenChatRequest({
    model: 'QWEN3.8',
    messages: [{ role: 'user', content: 'hello' }],
    authorization: 'native',
    bypassSamsarExternalInference: true,
    externalMaxRetries: 9,
    maxRetries: 0,
  });

  assert.equal(Object.hasOwn(payload, 'externalMaxRetries'), false);
  assert.equal(requestOptions.maxRetries, 0);
});
