import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeRuntimeInferenceDeploymentAvailability } from './DeploymentModelConfig.js';

const ENV_KEYS = [
  'ALIBABA_API_KEY',
  'DASHSCOPE_API_KEY',
  'ALIBABA_CLOUD_API_KEY',
  'QWEN_API_KEY',
  'SAMSAR_API_KEY',
];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function clearEnv() {
  ENV_KEYS.forEach((key) => delete process.env[key]);
}

function restoreEnv() {
  ENV_KEYS.forEach((key) => {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  });
}

test.afterEach(restoreEnv);

test('exposes Qwen in Docker availability when a native Alibaba key is provided', () => {
  clearEnv();
  process.env.ALIBABA_API_KEY = 'test-key';

  const result = mergeRuntimeInferenceDeploymentAvailability({
    providers: ['openai'],
    models: ['gpt-5.6-sol'],
    actions: ['chat'],
  });

  assert.deepEqual(result.providers, ['openai', 'alibabaCloud']);
  assert.deepEqual(result.models, ['gpt-5.6-sol', 'QWEN3.7']);
  assert.deepEqual(result.actions, ['chat', 'assistant']);
});

test('exposes Qwen through the Samsar inference fallback without duplicating models', () => {
  clearEnv();
  process.env.SAMSAR_API_KEY = 'test-key';

  const result = mergeRuntimeInferenceDeploymentAvailability({
    providers: ['samsar'],
    models: ['gpt-5.6-sol'],
  });

  assert.deepEqual(result.providers, ['samsar']);
  assert.deepEqual(result.models, ['gpt-5.6-sol', 'gemini-3.1-pro', 'QWEN3.7']);
});
