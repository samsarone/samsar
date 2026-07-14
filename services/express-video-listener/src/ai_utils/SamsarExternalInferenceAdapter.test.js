import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldUseSamsarExternalInference } from './SamsarExternalInferenceAdapter.js';

const ENV_KEYS = [
  'ALIBABA_CLOUD_API_KEY',
  'ALIBABA_API_KEY',
  'CURRENT_ENV',
  'DASHSCOPE_API_KEY',
  'OPENAI_API_KEY',
  'QWEN_API_KEY',
  'SAMSAR_API_KEY',
  'SAMSAR_EXTERNAL_INFERENCE_ENABLED',
  'SAMSAR_FORCE_EXTERNAL_INFERENCE',
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

test('Qwen routing prefers a native Alibaba key before the Samsar Docker fallback', () => {
  withEnvironment({
    CURRENT_ENV: 'docker',
    SAMSAR_API_KEY: 'samsar-key',
    DASHSCOPE_API_KEY: 'dashscope-key',
  }, () => {
    assert.equal(shouldUseSamsarExternalInference({ model: 'QWEN3.7' }), false);
  });
});

test('Qwen routing falls back to Samsar in Docker when no Alibaba key exists', () => {
  withEnvironment({
    CURRENT_ENV: 'docker',
    SAMSAR_API_KEY: 'samsar-key',
    OPENAI_API_KEY: 'openai-key-does-not-authorize-qwen',
  }, () => {
    assert.equal(shouldUseSamsarExternalInference({ model: 'QWEN3.7' }), true);
  });
});

test('the existing GPT and Gemini native-credential decisions are unchanged', () => {
  withEnvironment({
    CURRENT_ENV: 'docker',
    SAMSAR_API_KEY: 'samsar-key',
    OPENAI_API_KEY: 'openai-key',
  }, () => {
    assert.equal(shouldUseSamsarExternalInference({ model: 'gpt-5.6-sol' }), false);
    assert.equal(shouldUseSamsarExternalInference({ model: 'gemini-3.1-pro' }), true);
  });
});

test('an explicit deployed authorization uses Samsar even when a native key exists', () => {
  withEnvironment({
    CURRENT_ENV: 'docker',
    SAMSAR_API_KEY: 'samsar-key',
    ALIBABA_API_KEY: 'alibaba-key',
  }, () => {
    assert.equal(shouldUseSamsarExternalInference({
      model: 'QWEN3.7',
      authorization: 'deployed',
    }), true);
  });
});

test('an explicit native authorization falls back to Samsar when its provider key is absent', () => {
  withEnvironment({
    CURRENT_ENV: 'docker',
    SAMSAR_API_KEY: 'samsar-key',
  }, () => {
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
});

test('the ALIBABA_API_KEY alias authorizes explicit native Qwen routing', () => {
  withEnvironment({
    CURRENT_ENV: 'docker',
    SAMSAR_API_KEY: 'samsar-key',
    ALIBABA_API_KEY: 'alibaba-key',
  }, () => {
    assert.equal(shouldUseSamsarExternalInference({
      model: 'QWEN3.7',
      authorization: 'native',
    }), false);
  });
});
