import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import SamsarClient from 'samsar-js';
import OpenAI from 'openai';

const ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_DEPLOYMENT_EDITION',
  'SAMSAR_EDITION',
  'SAMSAR_RUNTIME',
  'NODE_ENV',
  'SAMSAR_API_KEY',
  'SAMSAR_EXTERNAL_INFERENCE_ENABLED',
  'SAMSAR_FORCE_EXTERNAL_INFERENCE',
  'SAMSAR_GENBLAZE_BASE_URL',
  'SAMSAR_GENBLAZE_ENABLED',
  'SAMSAR_GENBLAZE_MODEL_CATALOG_PATH',
  'OPENAI_API_KEY',
  'KIMI_K3_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENROUTER_GEMINI_MAX_TOKENS',
  'OPENROUTER_GEMINI_REASONING_EFFORT',
  'OPENROUTER_GPT_MAX_COMPLETION_TOKENS',
  'OPENROUTER_GPT_REASONING_EFFORT',
  'OPENROUTER_QWEN_INFERENCE_TIMEOUT_MS',
  'OPENROUTER_QWEN_MAX_RETRIES',
  'OPENROUTER_QWEN_MAX_TOKENS',
  'OPENROUTER_QWEN_REASONING_EFFORT',
  'SAMSAR_EXTERNAL_INFERENCE_MAX_RETRIES',
  'SAMSAR_EXTERNAL_INFERENCE_RETRY_BASE_DELAY_MS',
  'SAMSAR_EXTERNAL_INFERENCE_RETRY_MAX_DELAY_MS',
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
  'SAMSAR_QWEN_OPENROUTER_ONLY',
];

const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]])
);

const {
  DOCKER_INFERENCE_PROVIDER,
  DOCKER_INFERENCE_PROVIDER_PRIORITY_BY_MODEL,
  createGenblazeChatCompletion,
  createOpenRouterChatCompletion,
  createSamsarExternalChatCompletion,
  getOpenRouterModelForInferenceRequest,
  runExternalInferenceWithRetry,
  resolveConfiguredInferenceProvider,
  shouldUseOpenRouterInference,
  shouldUseSamsarExternalInference,
  unwrapSamsarExternalChatCompletionResponse,
} = await import('./SamsarExternalInferenceAdapter.js');

function createTestGenblazeCatalog() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-genblaze-inference-'));
  const catalogPath = path.join(directory, 'genblaze-model-catalog.json');
  fs.writeFileSync(catalogPath, JSON.stringify({
    version: 1,
    provider: 'gmicloud',
    models: {
      'QWEN3.7': {
        text: { modelId: 'Qwen/Qwen3.7-Max', operation: 'chat.completions' },
        vision: { modelId: 'Qwen/Qwen3.7-Plus', operation: 'chat.completions' },
      },
      'gpt-5.6-sol': {
        text: { modelId: 'gpt-5.6-sol', operation: 'chat.completions' },
        vision: { modelId: 'gpt-5.6-sol', operation: 'chat.completions' },
      },
      'gemini-3.1-pro': {
        text: { modelId: 'gemini-3.1-pro', operation: 'chat.completions' },
        vision: { modelId: 'gemini-3.1-pro', operation: 'chat.completions' },
      },
    },
  }));
  return { catalogPath, directory };
}

test('GenBlaze adapter preserves the OpenAI chat completion contract', async (t) => {
  const { catalogPath, directory } = createTestGenblazeCatalog();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH = catalogPath;
  let capturedPayload;
  const expected = {
    id: 'chatcmpl-genblaze',
    model: 'Qwen/Qwen3.7-Max',
    choices: [{ message: { role: 'assistant', content: 'ok' } }],
    usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
  };
  const response = await createGenblazeChatCompletion({
    model: 'qwen3.7-max',
    messages: [{ role: 'user', content: 'hello' }],
    authorization: 'gmicloud',
  }, {
    genblazeClient: {
      chat: {
        completions: {
          create: async (payload) => {
            capturedPayload = payload;
            return expected;
          },
        },
      },
    },
  });

  assert.equal(capturedPayload.model, 'QWEN3.7');
  assert.equal(capturedPayload.authorization, undefined);
  assert.deepEqual(response, expected);
});

test('GenBlaze sends canonical GPT and Gemini models with high reasoning and multimodal content', async (t) => {
  const { catalogPath, directory } = createTestGenblazeCatalog();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH = catalogPath;
  const payloads = [];
  const genblazeClient = {
    chat: {
      completions: {
        create: async (payload) => {
          payloads.push(payload);
          return { choices: [{ message: { role: 'assistant', content: 'ok' } }] };
        },
      },
    },
  };
  const imagePart = {
    type: 'image_url',
    image_url: { url: 'https://assets.example/frame.png' },
  };

  await createGenblazeChatCompletion({
    model: 'gpt-5.6-sol',
    messages: [{ role: 'user', content: 'reason deeply' }],
    reasoning: { effort: 'xhigh' },
    reasoning_effort: 'low',
  }, { genblazeClient });
  await createGenblazeChatCompletion({
    model: 'gemini-3.1-pro',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'inspect' }, imagePart] }],
    reasoning_effort: 'high',
  }, {
    genblazeClient,
    resolveMediaUrl: async (url) => url,
  });

  assert.equal(payloads[0].model, 'gpt-5.6-sol');
  assert.equal(payloads[0].reasoning_effort, 'high');
  assert.equal(payloads[0].reasoning, undefined);
  assert.equal(payloads[1].model, 'gemini-3.1-pro');
  assert.equal(payloads[1].reasoning_effort, 'high');
  assert.equal(payloads[1].reasoning, undefined);
  assert.deepEqual(payloads[1].messages[0].content[1], imagePart);
  await assert.rejects(
    createGenblazeChatCompletion({ model: 'kimi-k3', messages: [] }, { genblazeClient }),
    (error) => error?.code === 'GENBLAZE_MODEL_UNSUPPORTED',
  );
});

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

test('production Docker does not enable standalone external inference implicitly', () => {
  clearProviderEnv();
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'production';
  process.env.SAMSAR_RUNTIME = 'docker';
  process.env.SAMSAR_API_KEY = 'test-samsar-key';

  assert.equal(shouldUseSamsarExternalInference({
    model: 'gpt-5.6-sol',
    messages: [{ role: 'user', content: 'hello' }],
  }), false);

  process.env.SAMSAR_EXTERNAL_INFERENCE_ENABLED = 'true';
  assert.equal(shouldUseSamsarExternalInference({
    model: 'gpt-5.6-sol',
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

test('Kimi K3 uses its native key first and Samsar as the standalone fallback', () => {
  clearProviderEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_API_KEY = 'test-samsar-key';

  assert.equal(
    resolveConfiguredInferenceProvider('KIMIK3'),
    DOCKER_INFERENCE_PROVIDER.SAMSAR,
  );
  assert.equal(shouldUseSamsarExternalInference({ model: 'kimi-k3' }), true);
  assert.equal(shouldUseOpenRouterInference({
    model: 'kimi-k3',
    authorization: 'openrouter',
  }), false);

  process.env.KIMI_K3_API_KEY = 'test-kimi-key';
  assert.equal(
    resolveConfiguredInferenceProvider('Kimi K3'),
    DOCKER_INFERENCE_PROVIDER.KIMI,
  );
  assert.equal(shouldUseSamsarExternalInference({ model: 'kimi-k3' }), false);
  assert.deepEqual(DOCKER_INFERENCE_PROVIDER_PRIORITY_BY_MODEL['kimi-k3'], [
    DOCKER_INFERENCE_PROVIDER.KIMI,
    DOCKER_INFERENCE_PROVIDER.SAMSAR,
  ]);
});

test('Kimi K3 Samsar fallback forces high reasoning', async (t) => {
  clearProviderEnv();
  process.env.SAMSAR_API_KEY = 'test-samsar-key';
  let capturedPayload;
  t.mock.method(SamsarClient.prototype, 'createV2ExternalChatCompletion', async (payload) => {
    capturedPayload = payload;
    return {
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    };
  });

  await createSamsarExternalChatCompletion({
    model: 'kimi-k3',
    messages: [{ role: 'user', content: 'hello' }],
    reasoning_effort: 'low',
    externalMaxRetries: 0,
  });

  assert.equal(capturedPayload.model, 'kimi-k3');
  assert.equal(capturedPayload.reasoning_effort, 'high');
});

test('Docker Qwen uses native, GMICloud, Samsar, then OpenRouter', () => {
  clearProviderEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.NODE_ENV = 'production';
  process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
  process.env.SAMSAR_API_KEY = 'test-samsar-key';

  for (const model of ['gpt-5.6-sol', 'gemini-3.1-pro']) {
    assert.equal(resolveConfiguredInferenceProvider(model), DOCKER_INFERENCE_PROVIDER.OPENROUTER);
    assert.equal(shouldUseSamsarExternalInference({ model }), true);
  }
  assert.equal(resolveConfiguredInferenceProvider('QWEN3.7'), DOCKER_INFERENCE_PROVIDER.SAMSAR);
  assert.equal(shouldUseSamsarExternalInference({ model: 'QWEN3.7' }), true);

  assert.deepEqual(DOCKER_INFERENCE_PROVIDER_PRIORITY_BY_MODEL['QWEN3.7'], [
    DOCKER_INFERENCE_PROVIDER.ALIBABA_CLOUD,
    DOCKER_INFERENCE_PROVIDER.GMICLOUD,
    DOCKER_INFERENCE_PROVIDER.SAMSAR,
    DOCKER_INFERENCE_PROVIDER.OPENROUTER,
  ]);

  process.env.ALIBABA_API_KEY = 'test-alibaba-key';
  assert.equal(resolveConfiguredInferenceProvider('QWEN3.7'), DOCKER_INFERENCE_PROVIDER.ALIBABA_CLOUD);
  assert.equal(shouldUseSamsarExternalInference({ model: 'QWEN3.7' }), false);
});

test('Docker Qwen selects GMICloud through GenBlaze before Samsar and OpenRouter', (t) => {
  const { catalogPath, directory } = createTestGenblazeCatalog();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  clearProviderEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_GENBLAZE_ENABLED = 'true';
  process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH = catalogPath;
  process.env.SAMSAR_API_KEY = 'test-samsar-key';
  process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

  assert.equal(resolveConfiguredInferenceProvider('QWEN3.7'), DOCKER_INFERENCE_PROVIDER.GMICLOUD);
});

test('OpenRouter maps Qwen text to Max and vision requests to Plus', () => {
  assert.equal(getOpenRouterModelForInferenceRequest({
    model: 'QWEN3.7',
    messages: [{ role: 'user', content: 'hello' }],
  }, {
    OPENROUTER_QWEN_37_MAX_MODEL: 'qwen/qwen3.7-max',
    OPENROUTER_QWEN_37_PLUS_MODEL: 'qwen/qwen3.7-plus',
  }), 'qwen/qwen3.7-max');
  assert.equal(getOpenRouterModelForInferenceRequest({
    model: 'QWEN3.7',
    messages: [{
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: 'https://example.com/frame.png' } }],
    }],
  }), 'qwen/qwen3.7-plus');
});

test('production Qwen uses OpenRouter even when native Alibaba is configured', () => {
  clearProviderEnv();
  process.env.CURRENT_ENV = 'production';
  process.env.ALIBABA_API_KEY = 'test-alibaba-key';
  process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

  assert.equal(resolveConfiguredInferenceProvider('QWEN3.7'), DOCKER_INFERENCE_PROVIDER.OPENROUTER);
  assert.equal(shouldUseOpenRouterInference({ model: 'QWEN3.7' }), true);
  assert.equal(shouldUseOpenRouterInference({ model: 'QWEN3.7', authorization: 'openrouter' }), true);
  assert.equal(shouldUseSamsarExternalInference({ model: 'QWEN3.7' }), true);
  assert.equal(shouldUseSamsarExternalInference({ model: 'QWEN3.7', authorization: 'deployed' }), true);
});

test('production Qwen selects OpenRouter when its credential is configured', () => {
  clearProviderEnv();
  process.env.CURRENT_ENV = 'production';
  process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

  assert.equal(resolveConfiguredInferenceProvider('QWEN3.7'), DOCKER_INFERENCE_PROVIDER.OPENROUTER);
  assert.equal(shouldUseOpenRouterInference({ model: 'QWEN3.7' }), true);
  assert.equal(shouldUseSamsarExternalInference({ model: 'QWEN3.7' }), true);
});

test('all hosted Qwen runtimes use OpenRouter-only routing', () => {
  for (const environment of ['production', 'external-production', 'staging']) {
    clearProviderEnv();
    process.env.CURRENT_ENV = environment;
    process.env.ALIBABA_API_KEY = 'test-alibaba-key';
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

    assert.equal(resolveConfiguredInferenceProvider('QWEN3.7'), DOCKER_INFERENCE_PROVIDER.OPENROUTER);
    assert.equal(shouldUseOpenRouterInference({
      model: 'QWEN3.7',
      authorization: 'deployed',
    }), true);
    assert.equal(shouldUseSamsarExternalInference({
      model: 'QWEN3.7',
      authorization: 'deployed',
    }), true);
  }
});

test('OpenRouter adapter sends OpenAI-compatible vision requests with the Plus deployment', async (t) => {
  clearProviderEnv();
  process.env.CURRENT_ENV = 'production';
  process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
  process.env.OPENROUTER_QWEN_MAX_TOKENS = '50000';
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
  assert.equal(capturedPayload.max_tokens, 2048);
  assert.equal(capturedOptions.timeout, 1200000);
});

test('OpenRouter resolves provider media freshly on every adapter retry', async (t) => {
  clearProviderEnv();
  process.env.CURRENT_ENV = 'production';
  process.env.OPENROUTER_API_KEY = 'openrouter-fresh-media-key';
  process.env.SAMSAR_EXTERNAL_INFERENCE_RETRY_BASE_DELAY_MS = '1';
  process.env.SAMSAR_EXTERNAL_INFERENCE_RETRY_MAX_DELAY_MS = '1';
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
  const payloads = [];
  t.mock.method(OpenAI.Chat.Completions.prototype, 'create', async (payload) => {
    payloads.push(payload);
    if (payloads.length === 1) {
      const error = new Error('temporary OpenRouter failure');
      error.status = 503;
      throw error;
    }
    return { choices: [{ message: { role: 'assistant', content: 'ok' } }] };
  });
  let resolverCalls = 0;

  const response = await createOpenRouterChatCompletion({
    model: 'QWEN3.7',
    messages: [{
      role: 'user',
      content: [{
        type: 'image_url',
        image_url: { url: '/assets_v2/generations/session/openrouter.png' },
      }],
    }],
    externalMaxRetries: 1,
  }, {
    resolveMediaUrl: async (_source, options) => {
      resolverCalls += 1;
      assert.equal(options.serviceName, 'samsar_processor_openrouter');
      return `https://fresh-${resolverCalls}.example/assets_v2/generations/session/openrouter.png`;
    },
  });

  assert.equal(response.choices[0].message.content, 'ok');
  assert.equal(resolverCalls, 2);
  assert.equal(payloads[0].messages[0].content[0].image_url.url, 'https://fresh-1.example/assets_v2/generations/session/openrouter.png');
  assert.equal(payloads[1].messages[0].content[0].image_url.url, 'https://fresh-2.example/assets_v2/generations/session/openrouter.png');
});

test('OpenRouter applies Qwen-specific token and reasoning limits to Max text inference', async (t) => {
  clearProviderEnv();
  process.env.CURRENT_ENV = 'production';
  process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
  let capturedPayload;
  t.mock.method(OpenAI.Chat.Completions.prototype, 'create', async (payload) => {
    capturedPayload = payload;
    return { choices: [{ message: { role: 'assistant', content: 'ok' } }] };
  });

  await createOpenRouterChatCompletion({
    model: 'QWEN3.7',
    messages: [{ role: 'user', content: 'hello' }],
    reasoning: { effort: 'xhigh' },
    max_completion_tokens: 20000,
  });

  assert.equal(capturedPayload.model, 'qwen/qwen3.7-max');
  assert.equal(capturedPayload.reasoning.effort, 'high');
  assert.equal(capturedPayload.max_tokens, 2048);
  assert.equal(Object.hasOwn(capturedPayload, 'max_completion_tokens'), false);
});

test('OpenRouter reserves Qwen output tokens and enforces schema support for structured JSON', async (t) => {
  clearProviderEnv();
  process.env.CURRENT_ENV = 'production';
  process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
  process.env.OPENROUTER_QWEN_REASONING_EFFORT = 'high';
  let capturedPayload;
  t.mock.method(OpenAI.Chat.Completions.prototype, 'create', async (payload) => {
    capturedPayload = payload;
    return { choices: [{ message: { role: 'assistant', content: '{"value":"ok"}' } }] };
  });

  await createOpenRouterChatCompletion({
    model: 'QWEN3.7',
    messages: [{ role: 'user', content: 'return JSON' }],
    reasoning: { effort: 'high' },
    max_tokens: 4096,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'result',
        strict: true,
        schema: {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
          additionalProperties: false,
        },
      },
    },
    provider: { data_collection: 'deny' },
    plugins: [{ id: 'existing-plugin' }],
  });

  assert.equal(capturedPayload.model, 'qwen/qwen3.7-max');
  assert.equal(capturedPayload.reasoning.effort, 'high');
  assert.equal(capturedPayload.max_tokens, 2048);
  assert.deepEqual(capturedPayload.provider, {
    data_collection: 'deny',
    require_parameters: true,
  });
  assert.deepEqual(capturedPayload.plugins, [
    { id: 'existing-plugin' },
    { id: 'response-healing' },
  ]);
});

test('OpenRouter explicitly budgets high-reasoning Gemini and GPT completions', async (t) => {
  clearProviderEnv();
  process.env.CURRENT_ENV = 'production';
  process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
  const payloads = [];
  t.mock.method(OpenAI.Chat.Completions.prototype, 'create', async (payload) => {
    payloads.push(payload);
    return { choices: [{ message: { role: 'assistant', content: '{"value":"ok"}' } }] };
  });

  const responseFormat = { type: 'json_object' };
  await createOpenRouterChatCompletion({
    model: 'gemini-3.1-pro',
    messages: [{ role: 'user', content: 'return JSON' }],
    response_format: responseFormat,
  });
  await createOpenRouterChatCompletion({
    model: 'gpt-5.6-sol',
    messages: [{ role: 'user', content: 'return JSON' }],
    response_format: responseFormat,
  });

  assert.equal(payloads[0].model, 'google/gemini-3.1-pro-preview');
  assert.equal(payloads[0].reasoning.effort, 'high');
  assert.equal(payloads[0].max_tokens, 65536);
  assert.equal(Object.hasOwn(payloads[0], 'max_completion_tokens'), false);
  assert.equal(payloads[1].model, 'openai/gpt-5.6-sol');
  assert.equal(payloads[1].reasoning.effort, 'high');
  assert.equal(payloads[1].max_completion_tokens, 65536);
  assert.equal(Object.hasOwn(payloads[1], 'max_tokens'), false);
  for (const payload of payloads) {
    assert.equal(payload.provider.require_parameters, true);
    assert.deepEqual(payload.plugins, [{ id: 'response-healing' }]);
  }
});

test('production Qwen OpenRouter controls enforce minimum timeout and disable SDK retries', async (t) => {
  clearProviderEnv();
  process.env.CURRENT_ENV = 'production';
  process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
  process.env.SAMSAR_QWEN_OPENROUTER_ONLY = 'true';
  process.env.OPENROUTER_QWEN_INFERENCE_TIMEOUT_MS = '120000';
  process.env.OPENROUTER_QWEN_MAX_RETRIES = '0';
  let capturedOptions;
  t.mock.method(OpenAI.Chat.Completions.prototype, 'create', async (_payload, options) => {
    capturedOptions = options;
    return { choices: [{ message: { role: 'assistant', content: 'ok' } }] };
  });

  await createOpenRouterChatCompletion({
    model: 'QWEN3.7',
    messages: [{ role: 'user', content: 'hello' }],
    timeout: 180000,
    maxRetries: 2,
  });

  assert.equal(capturedOptions.timeout, 1200000);
  assert.equal(capturedOptions.maxRetries, 0);
  assert.equal(capturedOptions.signal instanceof AbortSignal, true);
});

test('production Qwen retries a transient OpenRouter connection reset', async (t) => {
  clearProviderEnv();
  process.env.CURRENT_ENV = 'production';
  process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
  process.env.SAMSAR_QWEN_OPENROUTER_ONLY = 'true';
  process.env.OPENROUTER_QWEN_MAX_RETRIES = '3';
  process.env.SAMSAR_EXTERNAL_INFERENCE_RETRY_BASE_DELAY_MS = '1';
  process.env.SAMSAR_EXTERNAL_INFERENCE_RETRY_MAX_DELAY_MS = '1';
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
  const requestOptions = [];
  let calls = 0;
  t.mock.method(OpenAI.Chat.Completions.prototype, 'create', async (_payload, options) => {
    calls += 1;
    requestOptions.push(options);
    if (calls === 1) {
      const error = new Error('read ECONNRESET');
      error.code = 'ECONNRESET';
      throw error;
    }
    return { choices: [{ message: { role: 'assistant', content: 'recovered' } }] };
  });

  const response = await createOpenRouterChatCompletion({
    model: 'QWEN3.7',
    messages: [{ role: 'user', content: 'hello' }],
  });

  assert.equal(response.choices[0].message.content, 'recovered');
  assert.equal(calls, 2);
  assert.equal(requestOptions.every((options) => options.maxRetries === 0), true);
});

test('external inference retries transient 429 responses three times with backoff', async () => {
  let calls = 0;
  const delays = [];

  const response = await runExternalInferenceWithRetry(async () => {
    calls += 1;
    if (calls <= 3) {
      const error = new Error('Provider returned error');
      error.status = 429;
      throw error;
    }
    return 'ok';
  }, {
    maxRetries: 3,
    timeoutMs: 1000,
    sleep: async (delayMs) => delays.push(delayMs),
    logger: { error() {}, warn() {} },
  });

  assert.equal(response, 'ok');
  assert.equal(calls, 4);
  assert.deepEqual(delays, [5000, 10000, 20000]);
});

test('external inference retries truncated OpenRouter JSON responses with backoff', async () => {
  let calls = 0;
  const delays = [];

  const response = await runExternalInferenceWithRetry(async () => {
    calls += 1;
    if (calls <= 3) {
      throw new Error(
        'invalid json response body at https://openrouter.ai/api/v1/chat/completions reason: Unexpected end of JSON input',
      );
    }
    return 'ok';
  }, {
    maxRetries: 3,
    timeoutMs: 1000,
    sleep: async (delayMs) => delays.push(delayMs),
    logger: { error() {}, warn() {} },
  });

  assert.equal(response, 'ok');
  assert.equal(calls, 4);
  assert.deepEqual(delays, [5000, 10000, 20000]);
});

test('external inference recognizes provider status exposed only as a numeric code', async () => {
  let calls = 0;

  const response = await runExternalInferenceWithRetry(async () => {
    calls += 1;
    if (calls === 1) {
      const error = new Error('Rate limited');
      error.code = 429;
      throw error;
    }
    return 'ok';
  }, {
    maxRetries: 1,
    timeoutMs: 1000,
    sleep: async () => {},
    logger: { error() {}, warn() {} },
  });

  assert.equal(response, 'ok');
  assert.equal(calls, 2);
});

test('external inference honors provider Retry-After on 429 responses', async () => {
  const delays = [];
  let calls = 0;
  const response = await runExternalInferenceWithRetry(async () => {
    calls += 1;
    if (calls === 1) {
      const error = new Error('Rate limited');
      error.status = 429;
      error.headers = new Headers({ 'retry-after': '12' });
      throw error;
    }
    return 'ok';
  }, {
    maxRetries: 1,
    timeoutMs: 1000,
    sleep: async (delayMs) => delays.push(delayMs),
    logger: { error() {}, warn() {} },
  });

  assert.equal(response, 'ok');
  assert.deepEqual(delays, [12000]);
});

test('external inference hard timeout aborts an unresolved provider request', async () => {
  let observedSignal;

  await assert.rejects(
    runExternalInferenceWithRetry(({ signal }) => {
      observedSignal = signal;
      return new Promise(() => {});
    }, {
      maxRetries: 0,
      timeoutMs: 5,
      logger: { error() {}, warn() {} },
    }),
    (error) => error.code === 'ETIMEDOUT' && error.status === 504,
  );

  assert.equal(observedSignal.aborted, true);
});

test('external inference does not retry non-transient authorization failures', async () => {
  let calls = 0;

  await assert.rejects(
    runExternalInferenceWithRetry(async () => {
      calls += 1;
      const error = new Error('Unauthorized');
      error.status = 401;
      throw error;
    }, {
      maxRetries: 3,
      timeoutMs: 1000,
      sleep: async () => assert.fail('401 should not schedule a retry'),
      logger: { error() {}, warn() {} },
    }),
    (error) => error.status === 401,
  );

  assert.equal(calls, 1);
});

test('external inference never retries insufficient-credit failures', async () => {
  for (const error of [
    Object.assign(new Error('Payment required'), { status: 402 }),
    new Error('OpenRouter account has insufficient credits'),
  ]) {
    let calls = 0;
    await assert.rejects(
      runExternalInferenceWithRetry(async () => {
        calls += 1;
        throw error;
      }, {
        maxRetries: 3,
        timeoutMs: 1000,
        sleep: async () => assert.fail('credit failures must not schedule a retry'),
        logger: { error() {}, warn() {} },
      }),
      error,
    );
    assert.equal(calls, 1);
  }
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

test('external inference applies each GPT 5.6 model reasoning default without changing Gemini reasoning', async (t) => {
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

  assert.equal(payloads[0].reasoning_effort, 'high');
  assert.equal(payloads[1].model, 'gpt-5.6-luna');
  assert.equal(payloads[1].reasoning_effort, 'xhigh');
  assert.equal(payloads[2].reasoning_effort, 'high');
});

test('Samsar external inference resolves provider media freshly on every retry', async (t) => {
  clearProviderEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_API_KEY = 'fresh-media-retry-key';
  process.env.SAMSAR_EXTERNAL_INFERENCE_RETRY_BASE_DELAY_MS = '1';
  process.env.SAMSAR_EXTERNAL_INFERENCE_RETRY_MAX_DELAY_MS = '1';
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
  const payloads = [];
  let providerAttempts = 0;
  t.mock.method(SamsarClient.prototype, 'createV2ExternalChatCompletion', async (payload) => {
    payloads.push(payload);
    providerAttempts += 1;
    if (providerAttempts === 1) {
      const error = new Error('temporary hosted failure');
      error.status = 503;
      throw error;
    }
    return { choices: [{ message: { role: 'assistant', content: 'ok' } }] };
  });

  const sourceMessages = [{
    role: 'user',
    content: [{
      type: 'input_image',
      image_url: 'http://localhost:3002/assets_v2/generations/session/frame.png',
    }],
  }];
  const originalMessages = JSON.parse(JSON.stringify(sourceMessages));
  let resolverCalls = 0;
  const response = await createSamsarExternalChatCompletion({
    model: 'gpt-5.6-sol',
    messages: sourceMessages,
    externalMaxRetries: 1,
    timeout: 1000,
  }, {
    resolveMediaUrl: async (_source, options) => {
      resolverCalls += 1;
      assert.equal(options.mediaKind, 'image');
      assert.equal(options.serviceName, 'samsar_processor_external_inference');
      return `https://fresh-${resolverCalls}.example/assets_v2/generations/session/frame.png`;
    },
  });

  assert.equal(response.choices[0].message.content, 'ok');
  assert.equal(resolverCalls, 2);
  assert.equal(payloads[0].messages[0].content[0].image_url, 'https://fresh-1.example/assets_v2/generations/session/frame.png');
  assert.equal(payloads[1].messages[0].content[0].image_url, 'https://fresh-2.example/assets_v2/generations/session/frame.png');
  assert.deepEqual(sourceMessages, originalMessages);
});

test('deployed external inference can queue and poll a long-running assistant request', async (t) => {
  clearProviderEnv();
  process.env.SAMSAR_API_KEY = 'polling-test-samsar-key';
  let queuedPayload;
  let statusQuery;

  t.mock.method(SamsarClient.prototype, 'postV2', async (path, payload) => {
    assert.equal(path, 'external/chat/completions');
    queuedPayload = payload;
    return {
      data: { request_id: 'request-123', status: 'PENDING' },
      status: 202,
    };
  });
  t.mock.method(SamsarClient.prototype, 'getV2', async (path, options) => {
    assert.equal(path, 'external/chat/status');
    statusQuery = options.query;
    return {
      data: {
        request_id: 'request-123',
        status: 'COMPLETED',
        response: {
          choices: [{ message: { role: 'assistant', content: '{"ok":true}' } }],
        },
      },
      status: 200,
    };
  });

  const response = await createSamsarExternalChatCompletion({
    model: 'gpt-5.6-sol',
    messages: [{ role: 'user', content: 'return JSON' }],
    externalPolling: true,
    externalPollIntervalMs: 1,
    externalPollTimeoutMs: 1000,
    externalMaxRetries: 0,
  });

  assert.equal(queuedPayload.async, true);
  assert.equal(queuedPayload.response_mode, 'polling');
  assert.equal(queuedPayload.reasoning_effort, 'high');
  assert.deepEqual(statusQuery, { request_id: 'request-123' });
  assert.equal(response.choices[0].message.content, '{"ok":true}');
});

test('Docker external polling persists correlation before polling the hosted request', async (t) => {
  clearProviderEnv();
  process.env.SAMSAR_API_KEY = 'persistent-polling-test-key';
  const storeEvents = [];
  let queuedPayload;
  const requestStore = {
    async prepare(context, details) {
      storeEvents.push(['prepare', context, details]);
      return {
        clientRequestId: 'samsar:video-session-1:text_to_video:theme:attempt-1',
        sessionId: 'video-session-1',
        requestKey: 'text_to_video:theme:attempt-1',
        providerRequestId: null,
        status: 'PENDING',
      };
    },
    async markSubmitted(clientRequestId, providerRequestId) {
      storeEvents.push(['submitted', clientRequestId, providerRequestId]);
    },
    async markPolling(clientRequestId) {
      storeEvents.push(['polling', clientRequestId]);
    },
    async markCompleted(clientRequestId, response) {
      storeEvents.push(['completed', clientRequestId, response]);
    },
    async markFailed(clientRequestId, error) {
      storeEvents.push(['failed', clientRequestId, error.message]);
    },
  };

  t.mock.method(SamsarClient.prototype, 'postV2', async (path, payload) => {
    assert.equal(path, 'external/chat/completions');
    queuedPayload = payload;
    return { data: { request_id: 'hosted-request-1', status: 'PENDING' } };
  });
  t.mock.method(SamsarClient.prototype, 'getV2', async () => ({
    data: {
      request_id: 'hosted-request-1',
      status: 'COMPLETED',
      response: { choices: [{ message: { content: 'persisted' } }] },
    },
  }));

  const response = await createSamsarExternalChatCompletion({
    model: 'gpt-5.6-sol',
    messages: [{ role: 'user', content: 'hello' }],
    externalPolling: true,
    externalPollIntervalMs: 1,
    externalPollTimeoutMs: 1000,
    externalMaxRetries: 0,
    externalRequestContext: {
      sessionId: 'video-session-1',
      requestKey: 'text_to_video:theme:attempt-1',
    },
    externalRequestStore: requestStore,
  });

  assert.equal(queuedPayload.client_request_id, 'samsar:video-session-1:text_to_video:theme:attempt-1');
  assert.equal(queuedPayload.client_session_id, 'video-session-1');
  assert.equal(queuedPayload.client_request_key, 'text_to_video:theme:attempt-1');
  assert.deepEqual(storeEvents.map(([event]) => event), [
    'prepare',
    'submitted',
    'polling',
    'completed',
  ]);
  assert.equal(response.choices[0].message.content, 'persisted');
});

test('Docker external polling resumes a persisted hosted request without resubmitting', async (t) => {
  clearProviderEnv();
  process.env.SAMSAR_API_KEY = 'resume-polling-test-key';
  let submitCalls = 0;
  const requestStore = {
    async prepare() {
      return {
        clientRequestId: 'local-request-2',
        sessionId: 'video-session-2',
        requestKey: 'text_to_video:narrative-1:attempt-1',
        providerRequestId: 'hosted-request-2',
        status: 'POLLING',
      };
    },
    async markSubmitted() {},
    async markPolling() {},
    async markCompleted() {},
    async markFailed() {},
  };
  t.mock.method(SamsarClient.prototype, 'postV2', async () => {
    submitCalls += 1;
    throw new Error('submit must not be called for a persisted provider request');
  });
  t.mock.method(SamsarClient.prototype, 'getV2', async (path, options) => {
    assert.equal(path, 'external/chat/status');
    assert.deepEqual(options.query, { request_id: 'hosted-request-2' });
    return {
      data: {
        request_id: 'hosted-request-2',
        status: 'COMPLETED',
        response: { choices: [{ message: { content: 'resumed' } }] },
      },
    };
  });

  const response = await createSamsarExternalChatCompletion({
    model: 'gpt-5.6-sol',
    messages: [{ role: 'user', content: 'resume' }],
    externalPolling: true,
    externalPollTimeoutMs: 1000,
    externalMaxRetries: 0,
    externalRequestContext: {
      sessionId: 'video-session-2',
      requestKey: 'text_to_video:narrative-1:attempt-1',
    },
    externalRequestStore: requestStore,
  });

  assert.equal(submitCalls, 0);
  assert.equal(response.choices[0].message.content, 'resumed');
});

test('Docker external polling marks a completed persisted response as reused without serializing the marker', async (t) => {
  clearProviderEnv();
  process.env.SAMSAR_API_KEY = 'completed-polling-test-key';
  const persistedResponse = {
    model: 'gpt-5.6-sol',
    usage: { input_tokens: 10, output_tokens: 2 },
    choices: [{ message: { content: 'already completed' } }],
  };
  const requestStore = {
    async prepare() {
      return {
        clientRequestId: 'local-request-completed',
        providerRequestId: 'hosted-request-completed',
        status: 'COMPLETED',
        response: persistedResponse,
      };
    },
  };
  const postMock = t.mock.method(SamsarClient.prototype, 'postV2', async () => {
    throw new Error('a completed request must not be submitted again');
  });
  const getMock = t.mock.method(SamsarClient.prototype, 'getV2', async () => {
    throw new Error('a completed request must not be polled again');
  });

  const response = await createSamsarExternalChatCompletion({
    model: 'gpt-5.6-sol',
    messages: [{ role: 'user', content: 'reuse' }],
    externalPolling: true,
    externalRequestContext: {
      sessionId: 'video-session-completed',
      requestKey: 'text_to_video:theme:attempt-1',
    },
    externalRequestStore: requestStore,
  });

  assert.equal(response, persistedResponse);
  assert.equal(response[Symbol.for('samsar.externalInferenceReused')], true);
  assert.equal(JSON.stringify(response).includes('externalInferenceReused'), false);
  assert.equal(postMock.mock.callCount(), 0);
  assert.equal(getMock.mock.callCount(), 0);
});

test('Docker retries a reset submit with the same hosted idempotency key', async (t) => {
  clearProviderEnv();
  process.env.SAMSAR_API_KEY = 'reset-submit-test-key';
  const submittedClientIds = [];
  const submittedMediaUrls = [];
  let submitAttempt = 0;
  const requestStore = {
    async prepare() {
      return {
        clientRequestId: 'stable-client-request-3',
        sessionId: 'video-session-3',
        requestKey: 'text_to_video:theme:attempt-1',
        providerRequestId: null,
        status: 'PENDING',
      };
    },
    async markSubmitted() {},
    async markPolling() {},
    async markCompleted() {},
    async markFailed() {},
  };
  t.mock.method(SamsarClient.prototype, 'postV2', async (path, payload) => {
    assert.equal(path, 'external/chat/completions');
    submittedClientIds.push(payload.client_request_id);
    submittedMediaUrls.push(payload.messages[0].content[0].image_url);
    submitAttempt += 1;
    if (submitAttempt === 1) {
      const error = new Error('socket reset after hosted request acceptance');
      error.code = 'ECONNRESET';
      throw error;
    }
    return { data: { request_id: 'hosted-request-3', status: 'PENDING' } };
  });
  t.mock.method(SamsarClient.prototype, 'getV2', async () => ({
    data: {
      request_id: 'hosted-request-3',
      status: 'COMPLETED',
      response: { choices: [{ message: { content: 'recovered reset' } }] },
    },
  }));

  const response = await createSamsarExternalChatCompletion({
    model: 'gpt-5.6-sol',
    messages: [{
      role: 'user',
      content: [{
        type: 'input_image',
        image_url: '/assets_v2/generations/session/polling-reset.png',
      }],
    }],
    externalPolling: true,
    externalPollIntervalMs: 1,
    externalPollTimeoutMs: 1000,
    externalMaxRetries: 0,
    externalRequestContext: {
      sessionId: 'video-session-3',
      requestKey: 'text_to_video:theme:attempt-1',
    },
    externalRequestStore: requestStore,
  }, {
    resolveMediaUrl: async (_source, options) => (
      `https://polling-${submittedMediaUrls.length + 1}.example/${options.mediaKind}.png`
    ),
  });

  assert.deepEqual(submittedClientIds, [
    'stable-client-request-3',
    'stable-client-request-3',
  ]);
  assert.deepEqual(submittedMediaUrls, [
    'https://polling-1.example/image.png',
    'https://polling-2.example/image.png',
  ]);
  assert.equal(response.choices[0].message.content, 'recovered reset');
});
