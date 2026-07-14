import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldUseSamsarExternalInference } from './SamsarExternalInferenceAdapter.js';

const ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_API_KEY',
  'DASHSCOPE_API_KEY',
  'ALIBABA_CLOUD_API_KEY',
  'ALIBABA_API_KEY',
  'QWEN_API_KEY',
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
