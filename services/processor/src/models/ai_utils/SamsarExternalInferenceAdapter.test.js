import assert from 'node:assert/strict';
import test from 'node:test';
import SamsarClient from 'samsar-js';
import OpenAI from 'openai';

const ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_API_KEY',
  'SAMSAR_EXTERNAL_INFERENCE_ENABLED',
  'SAMSAR_FORCE_EXTERNAL_INFERENCE',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'ALIBABA_API_KEY',
  'DASHSCOPE_API_KEY',
  'ALIBABA_CLOUD_API_KEY',
  'QWEN_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_APPLICATION_CREDENTIALS_JSON',
  'GOOGLE_APPLICATION_CREDENTIALS_JSON_B64',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_PROJECT_ID',
  'GCP_PROJECT',
  'GCLOUD_PROJECT',
  'PROJECT_ID',
  'K_SERVICE',
  'GAE_SERVICE',
  'FUNCTION_TARGET',
  'GCE_METADATA_HOST',
];

const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]])
);

const {
  DOCKER_INFERENCE_PROVIDER,
  DOCKER_INFERENCE_PROVIDER_PRIORITY_BY_MODEL,
  createOpenRouterChatCompletion,
  createSamsarExternalChatCompletion,
  getOpenRouterModelForInferenceRequest,
  resolveConfiguredInferenceProvider,
  shouldUseSamsarExternalInference,
  unwrapSamsarExternalChatCompletionResponse,
} = await import('./SamsarExternalInferenceAdapter.js');

function restoreEnv() {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnv[key];
    }
  }
}

function clearProviderEnv() {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
}

test.afterEach(() => {
  restoreEnv();
});

test('unwrapSamsarExternalChatCompletionResponse unwraps samsar-js response envelopes', () => {
  const chatCompletion = {
    id: 'chatcmpl-test',
    choices: [
      {
        message: {
          role: 'assistant',
          content: 'ok',
        },
      },
    ],
  };

  assert.equal(unwrapSamsarExternalChatCompletionResponse({
    data: chatCompletion,
    status: 200,
    creditsCharged: 1.23,
  }), chatCompletion);
});

test('unwrapSamsarExternalChatCompletionResponse preserves raw OpenAI-compatible responses', () => {
  const chatCompletion = {
    choices: [
      {
        message: {
          role: 'assistant',
          content: 'ok',
        },
      },
    ],
  };

  assert.equal(unwrapSamsarExternalChatCompletionResponse(chatCompletion), chatCompletion);
});

test('shouldUseSamsarExternalInference falls back for Gemini in docker without Google auth', () => {
  clearProviderEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_API_KEY = 'test-samsar-key';
  process.env.OPENAI_API_KEY = 'test-openai-key';

  assert.equal(shouldUseSamsarExternalInference({
    model: 'gemini-3.1-pro',
    messages: [{ role: 'user', content: 'hello' }],
  }), true);
});

test('shouldUseSamsarExternalInference keeps Gemini native when Google auth is configured', () => {
  clearProviderEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_API_KEY = 'test-samsar-key';
  process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
  process.env.K_SERVICE = 'processor';

  assert.equal(shouldUseSamsarExternalInference({
    model: 'gemini-3.1-pro',
    messages: [{ role: 'user', content: 'hello' }],
  }), false);
});

test('shouldUseSamsarExternalInference falls back for OpenAI models in docker without OpenAI auth', () => {
  clearProviderEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_API_KEY = 'test-samsar-key';

  assert.equal(shouldUseSamsarExternalInference({
    model: 'gpt-5.6-sol',
    messages: [{ role: 'user', content: 'hello' }],
  }), true);
});

test('shouldUseSamsarExternalInference keeps OpenAI native when OpenAI auth is configured', () => {
  clearProviderEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_API_KEY = 'test-samsar-key';
  process.env.OPENAI_API_KEY = 'test-openai-key';

  assert.equal(shouldUseSamsarExternalInference({
    model: 'gpt-5.6-sol',
    messages: [{ role: 'user', content: 'hello' }],
  }), false);
});

test('shouldUseSamsarExternalInference falls back for Qwen in docker without Alibaba auth', () => {
  clearProviderEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_API_KEY = 'test-samsar-key';

  assert.equal(shouldUseSamsarExternalInference({
    model: 'QWEN3.7',
    messages: [{ role: 'user', content: 'hello' }],
  }), true);
});

test('shouldUseSamsarExternalInference keeps Qwen native when DashScope auth is configured', () => {
  clearProviderEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_API_KEY = 'test-samsar-key';
  process.env.DASHSCOPE_API_KEY = 'test-dashscope-key';

  assert.equal(shouldUseSamsarExternalInference({
    model: 'qwen3.7-max',
    messages: [{ role: 'user', content: 'hello' }],
  }), false);
});

test('Docker inference uses native then OpenRouter then Samsar for every model', () => {
  clearProviderEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
  process.env.SAMSAR_API_KEY = 'test-samsar-key';

  for (const model of ['gpt-5.6-sol', 'gemini-3.1-pro', 'QWEN3.7']) {
    assert.equal(resolveConfiguredInferenceProvider(model), DOCKER_INFERENCE_PROVIDER.OPENROUTER);
    assert.equal(shouldUseSamsarExternalInference({ model }), true);
  }

  assert.deepEqual(DOCKER_INFERENCE_PROVIDER_PRIORITY_BY_MODEL['QWEN3.7'], [
    DOCKER_INFERENCE_PROVIDER.ALIBABA_CLOUD,
    DOCKER_INFERENCE_PROVIDER.OPENROUTER,
    DOCKER_INFERENCE_PROVIDER.SAMSAR,
  ]);

  process.env.ALIBABA_API_KEY = 'test-alibaba-key';
  assert.equal(resolveConfiguredInferenceProvider('QWEN3.7'), DOCKER_INFERENCE_PROVIDER.ALIBABA_CLOUD);
  assert.equal(shouldUseSamsarExternalInference({ model: 'QWEN3.7' }), false);
});

test('OpenRouter maps Qwen Max for text and Plus for vision', () => {
  assert.equal(getOpenRouterModelForInferenceRequest({
    model: 'QWEN3.7',
    messages: [{ role: 'user', content: 'hello' }],
  }), 'qwen/qwen3.7-max');
  assert.equal(getOpenRouterModelForInferenceRequest({
    model: 'QWEN3.7',
    messages: [{
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: 'https://example.com/frame.png' } }],
    }],
  }), 'qwen/qwen3.7-plus');
});

test('production Qwen is constrained to OpenRouter even when Alibaba is configured', () => {
  clearProviderEnv();
  process.env.CURRENT_ENV = 'production';
  process.env.ALIBABA_API_KEY = 'test-alibaba-key';
  process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

  assert.equal(resolveConfiguredInferenceProvider('QWEN3.7'), DOCKER_INFERENCE_PROVIDER.OPENROUTER);
  assert.equal(shouldUseSamsarExternalInference({ model: 'QWEN3.7' }), true);
});

test('OpenRouter adapter sends OpenAI-compatible vision requests with the Plus deployment', async (t) => {
  clearProviderEnv();
  process.env.CURRENT_ENV = 'production';
  process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
  let capturedPayload;
  let capturedOptions;
  t.mock.method(OpenAI.Chat.Completions.prototype, 'create', async (payload, options) => {
    capturedPayload = payload;
    capturedOptions = options;
    return { choices: [{ message: { role: 'assistant', content: 'ok' } }] };
  });

  await createOpenRouterChatCompletion({
    model: 'QWEN3.7',
    messages: [{
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: 'https://example.com/frame.png' } }],
    }],
    timeout: 12345,
  });

  assert.equal(capturedPayload.model, 'qwen/qwen3.7-plus');
  assert.equal(capturedPayload.messages[0].content[0].type, 'image_url');
  assert.equal(capturedOptions.timeout, 12345);
});

test('deployed authorization routes Qwen through Samsar even when native Alibaba auth exists', () => {
  clearProviderEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_API_KEY = 'test-samsar-key';
  process.env.DASHSCOPE_API_KEY = 'test-dashscope-key';

  assert.equal(shouldUseSamsarExternalInference({
    model: 'QWEN3.7',
    authorization: 'deployed',
    messages: [{ role: 'user', content: 'hello' }],
  }), true);
});

test('native authorization keeps Qwen on Alibaba when both credentials exist', () => {
  clearProviderEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_API_KEY = 'test-samsar-key';
  process.env.DASHSCOPE_API_KEY = 'test-dashscope-key';

  assert.equal(shouldUseSamsarExternalInference({
    model: 'QWEN3.7',
    authorization: 'native',
    messages: [{ role: 'user', content: 'hello' }],
  }), false);
});

test('native authorization preserves Samsar fallback until provider credentials are configured', () => {
  clearProviderEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_API_KEY = 'test-samsar-key';

  assert.equal(shouldUseSamsarExternalInference({
    model: 'QWEN3.7',
    authorization: 'native',
  }), true);
  assert.equal(shouldUseSamsarExternalInference({
    model: 'gemini-3.1-pro',
    authorization: 'native',
  }), true);
  assert.equal(shouldUseSamsarExternalInference({
    model: 'gpt-5.6-sol',
    authorization: 'native',
  }), true);
});

test('external inference preserves GPT 5.6 models with xhigh without changing Gemini reasoning', async (t) => {
  clearProviderEnv();
  process.env.SAMSAR_API_KEY = 'test-samsar-key';
  const payloads = [];
  t.mock.method(SamsarClient.prototype, 'createV2ExternalChatCompletion', async (payload) => {
    payloads.push(payload);
    return {
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    };
  });

  await createSamsarExternalChatCompletion({
    model: 'gpt-5.6-sol',
    messages: [{ role: 'user', content: 'hello' }],
    reasoning_effort: 'low',
  });
  await createSamsarExternalChatCompletion({
    model: 'gpt-5.6-luna',
    messages: [{ role: 'user', content: 'generate metadata' }],
    reasoning_effort: 'low',
  });
  await createSamsarExternalChatCompletion({
    model: 'gemini-3.1-pro',
    messages: [{ role: 'user', content: 'hello' }],
    reasoning_effort: 'high',
  });

  assert.equal(payloads[0].reasoning_effort, 'xhigh');
  assert.equal(payloads[1].model, 'gpt-5.6-luna');
  assert.equal(payloads[1].reasoning_effort, 'xhigh');
  assert.equal(payloads[2].reasoning_effort, 'high');
});
