import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import OpenAI from 'openai';

import {
  DOCKER_INFERENCE_PROVIDER,
  createOpenRouterChatCompletion,
  getConfiguredInferenceProviders,
  getOpenRouterModelForInferenceRequest,
  isRetryableInferenceAdapterError,
  normalizeOpenRouterBaseUrl,
  resolveConfiguredInferenceProvider,
  runInferenceAdapterFallback,
  runInferenceWithConfiguredAdapters,
  shouldUseOpenRouterInference,
  shouldUseSamsarExternalInference,
} from './SamsarExternalInferenceAdapter.js';

const ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_DEPLOYMENT_EDITION',
  'SAMSAR_EDITION',
  'SAMSAR_RUNTIME',
  'SAMSAR_API_KEY',
  'DASHSCOPE_API_KEY',
  'ALIBABA_CLOUD_API_KEY',
  'ALIBABA_API_KEY',
  'QWEN_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS_JSON_B64',
  'GOOGLE_APPLICATION_CREDENTIALS_JSON',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_PROJECT_ID',
  'GCP_PROJECT',
  'GCLOUD_PROJECT',
  'PROJECT_ID',
  'K_SERVICE',
  'GAE_SERVICE',
  'FUNCTION_TARGET',
  'GCE_METADATA_HOST',
  'OPENAI_API_KEY',
  'KIMI_K3_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENROUTER_BASE_URL',
  'OPENROUTER_API_BASE_URL',
  'OPENROUTER_QWEN_38_MAX_MODEL',
  'OPENROUTER_GEMINI_31_PRO_MODEL',
  'OPENROUTER_GPT_56_SOL_MODEL',
  'SAMSAR_EXTERNAL_INFERENCE_ENABLED',
  'SAMSAR_FORCE_EXTERNAL_INFERENCE',
  'SAMSAR_GENBLAZE_BASE_URL',
  'SAMSAR_GENBLAZE_ENABLED',
  'SAMSAR_GENBLAZE_MODEL_CATALOG_PATH',
  'SAMSAR_QWEN_OPENROUTER_ONLY',
  'SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH',
];

function createTestGenblazeCatalog() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-genblaze-inference-'));
  const catalogPath = path.join(directory, 'genblaze-model-catalog.json');
  fs.writeFileSync(catalogPath, JSON.stringify({
    version: 1,
    provider: 'gmicloud',
    models: {
      'QWEN3.8': {
        text: { modelId: 'Qwen/Qwen3.8-Max', operation: 'chat.completions' },
        vision: { modelId: 'Qwen/Qwen3.8-Max', operation: 'chat.completions' },
      },
    },
  }));
  return { catalogPath, directory };
}
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function resetEnv() {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
}

test.afterEach(resetEnv);

test('Qwen uses the Samsar fallback in Docker when no Alibaba key is configured', () => {
  ENV_KEYS.forEach((key) => delete process.env[key]);
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_API_KEY = 'samsar-test-key';

  assert.equal(shouldUseSamsarExternalInference({ model: 'QWEN3.8' }), true);
});

test('Qwen stays native when a DashScope key is configured', () => {
  ENV_KEYS.forEach((key) => delete process.env[key]);
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_API_KEY = 'samsar-test-key';
  process.env.DASHSCOPE_API_KEY = 'dashscope-test-key';

  assert.equal(shouldUseSamsarExternalInference({ model: 'QWEN3.8' }), false);
});

test('Qwen uses GMICloud through GenBlaze before Samsar and OpenRouter', (t) => {
  const { catalogPath, directory } = createTestGenblazeCatalog();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  ENV_KEYS.forEach((key) => delete process.env[key]);
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_GENBLAZE_ENABLED = 'true';
  process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH = catalogPath;
  process.env.SAMSAR_API_KEY = 'samsar-test-key';
  process.env.OPENROUTER_API_KEY = 'openrouter-test-key';

  assert.equal(
    resolveConfiguredInferenceProvider('QWEN3.8'),
    DOCKER_INFERENCE_PROVIDER.GMICLOUD,
  );
});

test('Kimi K3 prefers its native credential and otherwise uses Samsar fallback', () => {
  ENV_KEYS.forEach((key) => delete process.env[key]);
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_API_KEY = 'samsar-test-key';

  assert.equal(
    resolveConfiguredInferenceProvider('Kimi K3'),
    DOCKER_INFERENCE_PROVIDER.SAMSAR,
  );
  assert.equal(shouldUseSamsarExternalInference({ model: 'Kimi K3' }), true);

  process.env.KIMI_K3_API_KEY = 'kimi-test-key';

  assert.equal(
    resolveConfiguredInferenceProvider('KIMIK3'),
    DOCKER_INFERENCE_PROVIDER.KIMI,
  );
  assert.equal(shouldUseSamsarExternalInference({ model: 'KIMIK3' }), false);
  assert.equal(shouldUseSamsarExternalInference({
    model: 'KIMIK3',
    authorization: 'deployed',
  }), true);
});

test('Kimi K3 aliases never route through OpenRouter, even when explicitly authorized', () => {
  ENV_KEYS.forEach((key) => delete process.env[key]);
  process.env.CURRENT_ENV = 'docker';
  process.env.OPENROUTER_API_KEY = 'openrouter-test-key';
  process.env.SAMSAR_API_KEY = 'samsar-test-key';

  for (const model of ['kimi-k3', 'kimi-k3-latest', 'KIMIK3', 'Kimi K3', 'Moonshot K3']) {
    assert.equal(
      shouldUseOpenRouterInference({ model, authorization: 'openrouter' }),
      false,
      `${model} must bypass OpenRouter`,
    );
  }
});

test('Samsar stays ahead of OpenRouter for Qwen in Docker', () => {
  ENV_KEYS.forEach((key) => delete process.env[key]);
  process.env.CURRENT_ENV = 'docker';
  process.env.OPENROUTER_API_KEY = 'openrouter-test-key';
  process.env.SAMSAR_API_KEY = 'samsar-test-key';

  assert.equal(
    resolveConfiguredInferenceProvider('QWEN3.8'),
    DOCKER_INFERENCE_PROVIDER.SAMSAR,
  );
  assert.equal(shouldUseSamsarExternalInference({ model: 'QWEN3.8' }), true);
  for (const model of ['gemini-3.1-pro', 'gpt-5.6-sol']) {
    assert.equal(
      resolveConfiguredInferenceProvider(model),
      DOCKER_INFERENCE_PROVIDER.OPENROUTER,
    );
    assert.equal(shouldUseSamsarExternalInference({ model }), true);
  }
});

test('standalone inference overlays saved adapter order and appends omitted defaults', (t) => {
  ENV_KEYS.forEach((key) => delete process.env[key]);
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-inference-order-'));
  const preferencesPath = path.join(temporaryDirectory, 'model-adapter-preferences.json');
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  fs.writeFileSync(preferencesPath, JSON.stringify({
    modelProviderPriority: {
      'QWEN3.8': ['samsar', 'openrouter'],
      KIMIK3: ['samsar'],
      'gpt-5.6-sol': ['openrouter', 'samsar'],
    },
  }));
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH = preferencesPath;
  process.env.ALIBABA_API_KEY = 'alibaba-test-key';
  process.env.KIMI_K3_API_KEY = 'kimi-test-key';
  process.env.OPENAI_API_KEY = 'openai-test-key';
  process.env.OPENROUTER_API_KEY = 'openrouter-test-key';
  process.env.SAMSAR_API_KEY = 'samsar-test-key';

  assert.deepEqual(getConfiguredInferenceProviders('QWEN3.8'), [
    DOCKER_INFERENCE_PROVIDER.SAMSAR,
    DOCKER_INFERENCE_PROVIDER.OPENROUTER,
    DOCKER_INFERENCE_PROVIDER.ALIBABA_CLOUD,
  ]);
  assert.deepEqual(getConfiguredInferenceProviders('Kimi K3'), [
    DOCKER_INFERENCE_PROVIDER.SAMSAR,
    DOCKER_INFERENCE_PROVIDER.KIMI,
  ]);
  assert.deepEqual(getConfiguredInferenceProviders('gpt-5.6-sol'), [
    DOCKER_INFERENCE_PROVIDER.OPENROUTER,
    DOCKER_INFERENCE_PROVIDER.SAMSAR,
    DOCKER_INFERENCE_PROVIDER.OPENAI,
  ]);
  assert.equal(
    resolveConfiguredInferenceProvider('QWEN3.8'),
    DOCKER_INFERENCE_PROVIDER.SAMSAR,
  );
});

test('production and staging ignore standalone inference preferences', (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-inference-hosted-'));
  const preferencesPath = path.join(temporaryDirectory, 'model-adapter-preferences.json');
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  fs.writeFileSync(preferencesPath, JSON.stringify({
    modelProviderPriority: {
      'gpt-5.6-sol': ['samsar', 'openrouter', 'openai'],
    },
  }));

  for (const environment of ['production', 'staging']) {
    ENV_KEYS.forEach((key) => delete process.env[key]);
    process.env.CURRENT_ENV = environment;
    process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH = preferencesPath;
    process.env.OPENAI_API_KEY = 'openai-test-key';
    process.env.OPENROUTER_API_KEY = 'openrouter-test-key';
    process.env.SAMSAR_API_KEY = 'samsar-test-key';

    assert.equal(
      resolveConfiguredInferenceProvider('gpt-5.6-sol'),
      DOCKER_INFERENCE_PROVIDER.OPENAI,
    );
    assert.deepEqual(getConfiguredInferenceProviders('gpt-5.6-sol'), [
      DOCKER_INFERENCE_PROVIDER.OPENAI,
      DOCKER_INFERENCE_PROVIDER.OPENROUTER,
      DOCKER_INFERENCE_PROVIDER.SAMSAR,
    ]);
  }
});

test('production Docker runtime does not activate standalone inference fallback', async (t) => {
  ENV_KEYS.forEach((key) => delete process.env[key]);
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-inference-production-'));
  const preferencesPath = path.join(temporaryDirectory, 'model-adapter-preferences.json');
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  fs.writeFileSync(preferencesPath, JSON.stringify({
    modelProviderPriority: {
      'gpt-5.6-sol': ['samsar', 'openrouter', 'openai'],
    },
  }));
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'production';
  process.env.SAMSAR_RUNTIME = 'docker';
  process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH = preferencesPath;
  process.env.OPENAI_API_KEY = 'openai-test-key';
  process.env.OPENROUTER_API_KEY = 'openrouter-test-key';
  process.env.SAMSAR_API_KEY = 'samsar-test-key';

  assert.equal(
    resolveConfiguredInferenceProvider('gpt-5.6-sol'),
    DOCKER_INFERENCE_PROVIDER.OPENAI,
  );
  const attempts = [];
  const request = { model: 'gpt-5.6-sol' };
  await runInferenceWithConfiguredAdapters(request, async (provider, dispatchedRequest) => {
    attempts.push({ provider, dispatchedRequest });
    return 'ok';
  });
  assert.deepEqual(attempts, [{ provider: '', dispatchedRequest: request }]);
});

test('configured adapter fallback advances in saved order on retryable errors', async (t) => {
  ENV_KEYS.forEach((key) => delete process.env[key]);
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-inference-retry-'));
  const preferencesPath = path.join(temporaryDirectory, 'model-adapter-preferences.json');
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  fs.writeFileSync(preferencesPath, JSON.stringify({
    modelProviderPriority: {
      'gpt-5.6-sol': ['openrouter', 'samsar', 'openai'],
    },
  }));
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH = preferencesPath;
  process.env.OPENAI_API_KEY = 'openai-test-key';
  process.env.OPENROUTER_API_KEY = 'openrouter-test-key';
  process.env.SAMSAR_API_KEY = 'samsar-test-key';

  const attempts = [];
  const response = await runInferenceWithConfiguredAdapters(
    {
      model: 'gpt-5.6-sol',
      messages: [{ role: 'user', content: 'hello' }],
      authorization: 'native',
    },
    async (provider, request) => {
      attempts.push({ provider, request });
      if (provider === DOCKER_INFERENCE_PROVIDER.OPENROUTER) {
        const error = new Error('rate limited');
        error.status = 429;
        throw error;
      }
      return { provider };
    },
  );

  assert.deepEqual(attempts.map(({ provider }) => provider), [
    DOCKER_INFERENCE_PROVIDER.OPENROUTER,
    DOCKER_INFERENCE_PROVIDER.SAMSAR,
  ]);
  assert.equal(attempts[0].request.authorization, 'openrouter');
  assert.equal(attempts[0].request.bypassSamsarExternalInference, false);
  assert.equal(attempts[0].request.externalMaxRetries, 0);
  assert.equal(attempts[0].request.maxRetries, 0);
  assert.equal(attempts[1].request.authorization, 'deployed');
  assert.equal(attempts[1].request.samsarExternalInference, true);
  assert.equal(attempts[1].request.externalMaxRetries, 0);
  assert.equal(attempts[1].request.maxRetries, 0);
  assert.deepEqual(response, { provider: DOCKER_INFERENCE_PROVIDER.SAMSAR });
});

test('explicit external pins and bypass flags do not enter the cross-adapter chain', async () => {
  ENV_KEYS.forEach((key) => delete process.env[key]);
  process.env.CURRENT_ENV = 'docker';
  process.env.OPENAI_API_KEY = 'openai-test-key';
  process.env.OPENROUTER_API_KEY = 'openrouter-test-key';
  process.env.SAMSAR_API_KEY = 'samsar-test-key';

  for (const request of [
    { model: 'gpt-5.6-sol', authorization: 'deployed' },
    { model: 'gpt-5.6-sol', authorization: 'openrouter' },
    { model: 'gpt-5.6-sol', bypassSamsarExternalInference: true },
    { model: 'gpt-5.6-sol', samsarExternalInference: true },
    { model: 'gpt-5.6-sol', samsarExternalInference: false },
  ]) {
    const attempts = [];
    await runInferenceWithConfiguredAdapters(request, async (provider, dispatchedRequest) => {
      attempts.push({ provider, dispatchedRequest });
      return 'ok';
    });
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].provider, '');
    assert.equal(attempts[0].dispatchedRequest, request);
  }
});

test('standalone fallback excludes Samsar when external inference is disabled', async (t) => {
  ENV_KEYS.forEach((key) => delete process.env[key]);
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-inference-disabled-'));
  const preferencesPath = path.join(temporaryDirectory, 'model-adapter-preferences.json');
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  fs.writeFileSync(preferencesPath, JSON.stringify({
    modelProviderPriority: {
      'gpt-5.6-sol': ['samsar', 'openrouter', 'openai'],
    },
  }));
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH = preferencesPath;
  process.env.SAMSAR_EXTERNAL_INFERENCE_ENABLED = 'false';
  process.env.SAMSAR_API_KEY = 'samsar-test-key';
  process.env.OPENROUTER_API_KEY = 'openrouter-test-key';
  process.env.OPENAI_API_KEY = 'openai-test-key';

  const attempts = [];
  await runInferenceWithConfiguredAdapters(
    { model: 'gpt-5.6-sol' },
    async (provider) => {
      attempts.push(provider);
      return 'ok';
    },
  );
  assert.deepEqual(attempts, [DOCKER_INFERENCE_PROVIDER.OPENROUTER]);
});

test('adapter fallback stops on request errors and reports a fully exhausted chain', async () => {
  const nonRetryableAttempts = [];
  await assert.rejects(
    runInferenceAdapterFallback(['openai', 'samsar'], async (provider) => {
      nonRetryableAttempts.push(provider);
      const error = new Error('invalid request');
      error.status = 400;
      throw error;
    }),
    /invalid request/,
  );
  assert.deepEqual(nonRetryableAttempts, ['openai']);
  assert.equal(isRetryableInferenceAdapterError({ status: 503 }), true);
  assert.equal(isRetryableInferenceAdapterError({ status: 400 }), false);

  let exhaustedError;
  try {
    await runInferenceAdapterFallback(['openrouter', 'samsar'], async () => {
      const error = new Error('temporarily unavailable');
      error.code = 'ECONNRESET';
      throw error;
    });
  } catch (error) {
    exhaustedError = error;
  }
  assert.deepEqual(exhaustedError?.attemptedInferenceAdapters, [
    'openrouter',
    'samsar',
  ]);
});

test('hosted Qwen retry prompts use OpenRouter even when Alibaba is configured', () => {
  ENV_KEYS.forEach((key) => delete process.env[key]);
  process.env.CURRENT_ENV = 'production';
  process.env.OPENROUTER_API_KEY = 'openrouter-test-key';
  process.env.OPENROUTER_QWEN_MAX_TOKENS = '50000';
  process.env.ALIBABA_API_KEY = 'alibaba-test-key';

  const request = {
    model: 'QWEN3.8',
    authorization: 'native',
  };
  assert.equal(
    resolveConfiguredInferenceProvider('QWEN3.8'),
    DOCKER_INFERENCE_PROVIDER.OPENROUTER,
  );
  assert.equal(shouldUseOpenRouterInference(request), true);
  assert.equal(shouldUseSamsarExternalInference(request), true);
});

test('external production and staging Qwen use OpenRouter instead of native adapters', () => {
  for (const environment of ['external-production', 'staging']) {
    ENV_KEYS.forEach((key) => delete process.env[key]);
    process.env.CURRENT_ENV = environment;
    process.env.OPENROUTER_API_KEY = 'openrouter-test-key';
    process.env.ALIBABA_API_KEY = 'alibaba-test-key';

    const request = { model: 'QWEN3.8', authorization: 'deployed' };
    assert.equal(resolveConfiguredInferenceProvider('QWEN3.8'), DOCKER_INFERENCE_PROVIDER.OPENROUTER);
    assert.equal(shouldUseOpenRouterInference(request), true);
    assert.equal(shouldUseSamsarExternalInference(request), true);
  }
});

test('OpenRouter maps Qwen text and vision requests to Qwen 3.8 Max', () => {
  assert.equal(
    getOpenRouterModelForInferenceRequest({ model: 'QWEN3.8', messages: [] }),
    'qwen/qwen3.8-max',
  );
  assert.equal(
    getOpenRouterModelForInferenceRequest({
      model: 'QWEN3.8',
      messages: [{
        role: 'user',
        content: [{ type: 'input_image', image_url: 'frame' }],
      }],
    }),
    'qwen/qwen3.8-max',
  );
});

test('OpenRouter base URL normalization never falls back to the Samsar API host', () => {
  assert.equal(normalizeOpenRouterBaseUrl('   '), 'https://openrouter.ai/api/v1');
  assert.equal(normalizeOpenRouterBaseUrl('https://router.example/v1///'), 'https://router.example/v1');
});

test('an explicit deployed authorization uses Samsar even when a native key exists', () => {
  ENV_KEYS.forEach((key) => delete process.env[key]);
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_API_KEY = 'samsar-test-key';
  process.env.ALIBABA_API_KEY = 'alibaba-test-key';

  assert.equal(shouldUseSamsarExternalInference({
    model: 'QWEN3.8',
    authorization: 'deployed',
  }), true);
});

test('an explicit native authorization still falls back when its provider key is absent', () => {
  ENV_KEYS.forEach((key) => delete process.env[key]);
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_API_KEY = 'samsar-test-key';

  assert.equal(shouldUseSamsarExternalInference({
    model: 'QWEN3.8',
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

test('the ALIBABA_API_KEY alias authorizes native Qwen routing', () => {
  ENV_KEYS.forEach((key) => delete process.env[key]);
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_API_KEY = 'samsar-test-key';
  process.env.ALIBABA_API_KEY = 'alibaba-test-key';

  assert.equal(shouldUseSamsarExternalInference({
    model: 'QWEN3.8',
    authorization: 'native',
  }), false);
});

test('Qwen OpenRouter applies Qwen 3.8 Max routing with bounded settings', async (t) => {
  ENV_KEYS.forEach((key) => delete process.env[key]);
  process.env.CURRENT_ENV = 'production';
  process.env.OPENROUTER_API_KEY = 'openrouter-test-key';
  const payloads = [];
  const options = [];
  t.mock.method(OpenAI.Chat.Completions.prototype, 'create', async (payload, requestOptions) => {
    payloads.push(payload);
    options.push(requestOptions);
    return { choices: [{ message: { content: 'ok' } }] };
  });

  await createOpenRouterChatCompletion({
    model: 'QWEN3.8',
    messages: [{ role: 'user', content: 'hello' }],
    reasoning: { effort: 'xhigh' },
    max_completion_tokens: 20000,
  });
  await createOpenRouterChatCompletion({
    model: 'QWEN3.8',
    messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'x' } }] }],
  });
  await createOpenRouterChatCompletion({
    model: 'QWEN3.8',
    messages: [{ role: 'user', content: 'return JSON' }],
    reasoning: { effort: 'low' },
    max_tokens: 16384,
    response_format: { type: 'json_object' },
    provider: { data_collection: 'deny' },
    plugins: [{ id: 'existing-plugin' }],
  });

  assert.equal(payloads[0].model, 'qwen/qwen3.8-max');
  assert.equal(payloads[0].reasoning.effort, 'high');
  assert.equal(payloads[0].max_tokens, 20000);
  assert.equal(payloads[1].model, 'qwen/qwen3.8-max');
  assert.equal(payloads[1].max_tokens, 16384);
  assert.equal(payloads[2].model, 'qwen/qwen3.8-max');
  assert.equal(payloads[2].reasoning.effort, 'high');
  assert.equal(payloads[2].max_tokens, 16384);
  assert.deepEqual(payloads[2].provider, { data_collection: 'deny', require_parameters: true });
  assert.deepEqual(payloads[2].plugins, [{ id: 'existing-plugin' }, { id: 'response-healing' }]);
  assert.equal(options[0].maxRetries, 0);
  assert.equal(options[0].signal instanceof AbortSignal, true);
});
