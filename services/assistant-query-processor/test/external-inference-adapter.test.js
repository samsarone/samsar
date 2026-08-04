import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createOpenRouterChatCompletion,
  DOCKER_INFERENCE_PROVIDER,
  getConfiguredInferenceProviders,
  resolveConfiguredInferenceProvider,
  shouldUseOpenRouterInference,
  shouldUseSamsarExternalInference,
} from '../src/SamsarExternalInferenceAdapter.js';

const ENV_KEYS = [
  'ALIBABA_API_KEY',
  'CURRENT_ENV',
  'KIMI_K3_API_KEY',
  'OPENROUTER_API_KEY',
  'SAMSAR_API_KEY',
  'SAMSAR_DEPLOYMENT_EDITION',
  'SAMSAR_EDITION',
  'SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH',
  'SAMSAR_QWEN_OPENROUTER_ONLY',
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

test('hosted, external, and staging Qwen always use OpenRouter', () => {
  for (const environment of ['production', 'external-production', 'staging']) {
    withEnvironment({
      CURRENT_ENV: environment,
      OPENROUTER_API_KEY: 'openrouter-key',
      ALIBABA_API_KEY: 'alibaba-key',
    }, () => {
      const request = { model: 'QWEN3.8', authorization: 'deployed' };
      assert.equal(resolveConfiguredInferenceProvider('QWEN3.8'), DOCKER_INFERENCE_PROVIDER.OPENROUTER);
      assert.equal(shouldUseOpenRouterInference(request), true);
      assert.equal(shouldUseSamsarExternalInference(request), true);
    });
  }
});

test('Docker Qwen may use the native Alibaba adapter', () => {
  withEnvironment({
    CURRENT_ENV: 'docker',
    OPENROUTER_API_KEY: 'openrouter-key',
    ALIBABA_API_KEY: 'alibaba-key',
  }, () => {
    assert.equal(resolveConfiguredInferenceProvider('QWEN3.8'), DOCKER_INFERENCE_PROVIDER.ALIBABA_CLOUD);
    assert.equal(shouldUseOpenRouterInference({ model: 'QWEN3.8' }), false);
    assert.equal(shouldUseSamsarExternalInference({ model: 'QWEN3.8' }), false);
  });
});

test('standalone inference adapters follow the saved per-model preference order', (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-assistant-order-'));
  const preferencePath = path.join(temporaryDirectory, 'model-adapter-preferences.json');
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  fs.writeFileSync(preferencePath, JSON.stringify({
    modelProviderPriority: {
      'gpt-5.6-sol': ['samsar', 'openrouter', 'openai'],
    },
  }));

  withEnvironment({
    CURRENT_ENV: 'docker',
    SAMSAR_DEPLOYMENT_EDITION: 'standalone',
    SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH: preferencePath,
    OPENAI_API_KEY: 'openai-key',
    OPENROUTER_API_KEY: 'openrouter-key',
    SAMSAR_API_KEY: 'samsar-key',
  }, () => {
    assert.deepEqual(getConfiguredInferenceProviders('gpt-5.6-sol'), [
      DOCKER_INFERENCE_PROVIDER.SAMSAR,
      DOCKER_INFERENCE_PROVIDER.OPENROUTER,
      DOCKER_INFERENCE_PROVIDER.OPENAI,
    ]);
  });
});

test('production inference ignores standalone preference files', (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-assistant-production-'));
  const preferencePath = path.join(temporaryDirectory, 'model-adapter-preferences.json');
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  fs.writeFileSync(preferencePath, JSON.stringify({
    modelProviderPriority: {
      'gpt-5.6-sol': ['samsar', 'openrouter', 'openai'],
      'QWEN3.8': ['alibabaCloud', 'samsar', 'openrouter'],
    },
  }));

  withEnvironment({
    CURRENT_ENV: 'production',
    SAMSAR_DEPLOYMENT_EDITION: 'production',
    SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH: preferencePath,
    OPENAI_API_KEY: 'openai-key',
    OPENROUTER_API_KEY: 'openrouter-key',
    SAMSAR_API_KEY: 'samsar-key',
    ALIBABA_API_KEY: 'alibaba-key',
  }, () => {
    assert.deepEqual(getConfiguredInferenceProviders('gpt-5.6-sol'), [
      DOCKER_INFERENCE_PROVIDER.OPENAI,
      DOCKER_INFERENCE_PROVIDER.OPENROUTER,
      DOCKER_INFERENCE_PROVIDER.SAMSAR,
    ]);
    assert.deepEqual(getConfiguredInferenceProviders('QWEN3.8'), [
      DOCKER_INFERENCE_PROVIDER.OPENROUTER,
    ]);
  });
});

test('Kimi K3 uses only native Kimi or the Samsar fallback', () => {
  withEnvironment({
    CURRENT_ENV: 'production',
    KIMI_K3_API_KEY: 'kimi-key',
    OPENROUTER_API_KEY: 'openrouter-key',
    SAMSAR_API_KEY: 'samsar-key',
  }, () => {
    assert.equal(
      resolveConfiguredInferenceProvider('KIMIK3'),
      DOCKER_INFERENCE_PROVIDER.KIMI,
    );
    assert.equal(shouldUseOpenRouterInference({ model: 'kimi-k3' }), false);
    assert.equal(shouldUseSamsarExternalInference({ model: 'kimi-k3' }), false);
  });

  withEnvironment({
    CURRENT_ENV: 'production',
    OPENROUTER_API_KEY: 'openrouter-key',
    SAMSAR_API_KEY: 'samsar-key',
  }, () => {
    assert.equal(
      resolveConfiguredInferenceProvider('Moonshot K3'),
      DOCKER_INFERENCE_PROVIDER.SAMSAR,
    );
    assert.equal(shouldUseOpenRouterInference({
      model: 'kimi-k3',
      authorization: 'openrouter',
    }), false);
    assert.equal(shouldUseSamsarExternalInference({ model: 'kimi-k3' }), true);
  });
});

test('the OpenRouter adapter rejects direct Kimi K3 dispatch', async () => {
  await assert.rejects(
    () => createOpenRouterChatCompletion(
      { model: 'kimi-k3', messages: [{ role: 'user', content: 'hello' }] },
      { client: { chat: { completions: { create: async () => assert.fail() } } } },
    ),
    /only the native Kimi API or Samsar API fallback/,
  );
});
