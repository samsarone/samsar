import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldUseSamsarExternalInference } from './SamsarExternalInferenceAdapter.js';

const ENV_KEYS = [
  'ALIBABA_CLOUD_API_KEY',
  'ALIBABA_API_KEY',
  'CURRENT_ENV',
  'DASHSCOPE_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS_JSON',
  'OPENAI_API_KEY',
  'QWEN_API_KEY',
  'SAMSAR_API_KEY',
  'SAMSAR_EXTERNAL_INFERENCE_ENABLED',
];

function withEnvironment(overrides, callback) {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
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

test('Qwen routing prefers native Alibaba credentials', () => {
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

test('Qwen routing falls back to Samsar in Docker without native credentials', () => {
  withEnvironment({ CURRENT_ENV: 'docker', SAMSAR_API_KEY: 'samsar-key' }, () => {
    assert.equal(shouldUseSamsarExternalInference({ model: 'QWEN3.7' }), true);
  });
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
  withEnvironment({ CURRENT_ENV: 'docker', SAMSAR_API_KEY: 'samsar-key' }, () => {
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
