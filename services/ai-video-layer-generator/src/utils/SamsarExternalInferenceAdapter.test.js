import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DOCKER_INFERENCE_PROVIDER,
  getOpenRouterModelForInferenceRequest,
  normalizeOpenRouterBaseUrl,
  resolveConfiguredInferenceProvider,
  shouldUseOpenRouterInference,
  shouldUseSamsarExternalInference,
} from './SamsarExternalInferenceAdapter.js';

const ENV_KEYS = [
  'CURRENT_ENV',
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
  'OPENROUTER_API_KEY',
  'OPENROUTER_BASE_URL',
  'OPENROUTER_API_BASE_URL',
  'OPENROUTER_QWEN_37_PLUS_MODEL',
  'OPENROUTER_QWEN_37_MAX_MODEL',
  'OPENROUTER_GEMINI_31_PRO_MODEL',
  'OPENROUTER_GPT_56_SOL_MODEL',
  'SAMSAR_EXTERNAL_INFERENCE_ENABLED',
  'SAMSAR_FORCE_EXTERNAL_INFERENCE',
  'SAMSAR_QWEN_OPENROUTER_ONLY',
];
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

  assert.equal(shouldUseSamsarExternalInference({ model: 'QWEN3.7' }), true);
});

test('Qwen stays native when a DashScope key is configured', () => {
  ENV_KEYS.forEach((key) => delete process.env[key]);
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_API_KEY = 'samsar-test-key';
  process.env.DASHSCOPE_API_KEY = 'dashscope-test-key';

  assert.equal(shouldUseSamsarExternalInference({ model: 'QWEN3.7' }), false);
});

test('OpenRouter is the Docker fallback before Samsar for every inference model', () => {
  ENV_KEYS.forEach((key) => delete process.env[key]);
  process.env.CURRENT_ENV = 'docker';
  process.env.OPENROUTER_API_KEY = 'openrouter-test-key';
  process.env.SAMSAR_API_KEY = 'samsar-test-key';

  for (const model of ['QWEN3.7', 'gemini-3.1-pro', 'gpt-5.6-sol']) {
    assert.equal(
      resolveConfiguredInferenceProvider(model),
      DOCKER_INFERENCE_PROVIDER.OPENROUTER,
    );
    assert.equal(shouldUseSamsarExternalInference({ model }), true);
  }
});

test('hosted Qwen retry prompts use OpenRouter even when Alibaba is configured', () => {
  ENV_KEYS.forEach((key) => delete process.env[key]);
  process.env.CURRENT_ENV = 'production';
  process.env.OPENROUTER_API_KEY = 'openrouter-test-key';
  process.env.ALIBABA_API_KEY = 'alibaba-test-key';

  const request = {
    model: 'QWEN3.7',
    authorization: 'native',
  };
  assert.equal(
    resolveConfiguredInferenceProvider('QWEN3.7'),
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

    const request = { model: 'QWEN3.7', authorization: 'deployed' };
    assert.equal(resolveConfiguredInferenceProvider('QWEN3.7'), DOCKER_INFERENCE_PROVIDER.OPENROUTER);
    assert.equal(shouldUseOpenRouterInference(request), true);
    assert.equal(shouldUseSamsarExternalInference(request), true);
  }
});

test('OpenRouter maps Qwen text and vision requests to the matching deployment', () => {
  assert.equal(
    getOpenRouterModelForInferenceRequest({ model: 'QWEN3.7', messages: [] }),
    'qwen/qwen3.7-max',
  );
  assert.equal(
    getOpenRouterModelForInferenceRequest({
      model: 'QWEN3.7',
      messages: [{
        role: 'user',
        content: [{ type: 'input_image', image_url: 'frame' }],
      }],
    }),
    'qwen/qwen3.7-plus',
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
    model: 'QWEN3.7',
    authorization: 'deployed',
  }), true);
});

test('an explicit native authorization still falls back when its provider key is absent', () => {
  ENV_KEYS.forEach((key) => delete process.env[key]);
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_API_KEY = 'samsar-test-key';

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

test('the ALIBABA_API_KEY alias authorizes native Qwen routing', () => {
  ENV_KEYS.forEach((key) => delete process.env[key]);
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_API_KEY = 'samsar-test-key';
  process.env.ALIBABA_API_KEY = 'alibaba-test-key';

  assert.equal(shouldUseSamsarExternalInference({
    model: 'QWEN3.7',
    authorization: 'native',
  }), false);
});
