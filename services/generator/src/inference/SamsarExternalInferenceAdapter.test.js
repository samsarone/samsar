import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DOCKER_INFERENCE_PROVIDER,
  resolveConfiguredInferenceProvider,
  shouldUseOpenRouterInference,
  shouldUseSamsarExternalInference,
} from './SamsarExternalInferenceAdapter.js';

const ENV_KEYS = [
  'ALIBABA_CLOUD_API_KEY',
  'ALIBABA_API_KEY',
  'CURRENT_ENV',
  'DASHSCOPE_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS_JSON',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'QWEN_API_KEY',
  'SAMSAR_API_KEY',
  'SAMSAR_EXTERNAL_INFERENCE_ENABLED',
  'SAMSAR_QWEN_OPENROUTER_ONLY',
];

function withEnvironment(overrides, callback) {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  Object.assign(process.env, overrides);
  try {
    return callback();
  } finally {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test('Qwen routing prefers a native Alibaba key before Samsar fallback', () => {
  withEnvironment({
    CURRENT_ENV: 'docker',
    SAMSAR_API_KEY: 'samsar-key',
    DASHSCOPE_API_KEY: 'dashscope-key',
  }, () => {
    assert.equal(shouldUseSamsarExternalInference({
      model: 'QWEN3.7',
      authorization: 'native',
    }), false);
  });
});

test('ALIBABA_API_KEY is detected as native Qwen credentials', () => {
  withEnvironment({
    CURRENT_ENV: 'docker',
    SAMSAR_API_KEY: 'samsar-key',
    ALIBABA_API_KEY: 'alibaba-key',
  }, () => {
    assert.equal(shouldUseSamsarExternalInference({ model: 'QWEN3.7' }), false);
  });
});

test('Qwen routing falls back to Samsar in Docker when no native key exists', () => {
  withEnvironment({
    CURRENT_ENV: 'docker',
    SAMSAR_API_KEY: 'samsar-key',
  }, () => {
    assert.equal(shouldUseSamsarExternalInference({ model: 'QWEN3.7' }), true);
  });
});

test('OpenRouter enables every inference model while preserving native-first routing', () => {
  withEnvironment({
    CURRENT_ENV: 'docker',
    OPENROUTER_API_KEY: 'openrouter-key',
    SAMSAR_API_KEY: 'samsar-key',
  }, () => {
    for (const model of ['QWEN3.7', 'gemini-3.1-pro', 'gpt-5.6-sol']) {
      assert.equal(resolveConfiguredInferenceProvider(model), DOCKER_INFERENCE_PROVIDER.OPENROUTER);
    }
    process.env.OPENAI_API_KEY = 'openai-key';
    assert.equal(resolveConfiguredInferenceProvider('gpt-5.6-sol'), DOCKER_INFERENCE_PROVIDER.OPENAI);
  });
});

test('hosted and external Qwen always use OpenRouter instead of native adapters', () => {
  for (const environment of ['production', 'external-production', 'staging']) {
    withEnvironment({
      CURRENT_ENV: environment,
      OPENROUTER_API_KEY: 'openrouter-key',
      ALIBABA_API_KEY: 'alibaba-key',
    }, () => {
      const request = { model: 'QWEN3.7', authorization: 'deployed' };
      assert.equal(resolveConfiguredInferenceProvider('QWEN3.7'), DOCKER_INFERENCE_PROVIDER.OPENROUTER);
      assert.equal(shouldUseOpenRouterInference(request), true);
      assert.equal(shouldUseSamsarExternalInference(request), true);
    });
  }
});

test('explicit deployed authorization overrides native credentials for every inference provider', () => {
  withEnvironment({
    CURRENT_ENV: 'docker',
    SAMSAR_API_KEY: 'samsar-key',
    DASHSCOPE_API_KEY: 'dashscope-key',
    GOOGLE_APPLICATION_CREDENTIALS_JSON: '{}',
    OPENAI_API_KEY: 'openai-key',
  }, () => {
    for (const model of ['QWEN3.7', 'gemini-3.1-pro', 'gpt-5.6-sol']) {
      assert.equal(shouldUseSamsarExternalInference({
        model,
        authorization: 'deployed',
      }), true);
    }
  });
});

test('explicit native authorization preserves Samsar fallback while provider credentials are absent', () => {
  withEnvironment({
    CURRENT_ENV: 'docker',
    SAMSAR_API_KEY: 'samsar-key',
  }, () => {
    assert.equal(shouldUseSamsarExternalInference({
      model: 'QWEN3.7',
      authorization: 'native',
    }), true);
    for (const model of ['gemini-3.1-pro', 'gpt-5.6-sol']) {
      assert.equal(shouldUseSamsarExternalInference({
        model,
        authorization: 'native',
      }), true);
    }
  });
});
