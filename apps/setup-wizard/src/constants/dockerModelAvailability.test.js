import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DOCKER_PROVIDER,
  buildDockerAvailableModelsFromEnabledProviders,
  resolveDockerModelProvider,
} from './dockerModelAvailability.js';

const INFERENCE_MODEL_KEYS = Object.freeze([
  'gpt-5.6-sol',
  'gemini-3.1-pro',
  'QWEN3.7',
]);

function getAvailableInferenceModels(available) {
  return available.models.filter((model) => INFERENCE_MODEL_KEYS.includes(model));
}

test('Alibaba Cloud alone exposes Qwen, Wan2.7 Pro, and native Happy Horse video', () => {
  const available = buildDockerAvailableModelsFromEnabledProviders([
    DOCKER_PROVIDER.ALIBABA_CLOUD,
  ]);

  assert.deepEqual(available.providers, [DOCKER_PROVIDER.ALIBABA_CLOUD]);
  assert.deepEqual(getAvailableInferenceModels(available), ['QWEN3.7']);
  assert.equal(available.models.includes('WAN2.7PRO'), true);
  assert.equal(available.models.includes('HAPPYHORSEI2V'), true);
  assert.deepEqual(available.actions, ['assistant', 'chat', 'image', 'video']);
  assert.equal(available.modelProviders['QWEN3.7'], DOCKER_PROVIDER.ALIBABA_CLOUD);
  assert.equal(available.modelProviders['WAN2.7PRO'], DOCKER_PROVIDER.ALIBABA_CLOUD);
  assert.equal(available.modelProviders.HAPPYHORSEI2V, DOCKER_PROVIDER.ALIBABA_CLOUD);
});

test('Samsar exposes GPT 5.6 Sol, Gemini 3.1 Pro, and Qwen 3.7', () => {
  const available = buildDockerAvailableModelsFromEnabledProviders([
    DOCKER_PROVIDER.SAMSAR,
  ]);

  assert.deepEqual(
    getAvailableInferenceModels(available),
    ['QWEN3.7', 'gemini-3.1-pro', 'gpt-5.6-sol'],
  );
  for (const model of INFERENCE_MODEL_KEYS) {
    assert.equal(available.modelProviders[model], DOCKER_PROVIDER.SAMSAR);
  }
});

test('no enabled provider exposes no Qwen model', () => {
  const available = buildDockerAvailableModelsFromEnabledProviders([]);

  assert.equal(available.models.includes('QWEN3.7'), false);
  assert.equal(available.modelProviders['QWEN3.7'], undefined);
});

test('Alibaba Cloud takes priority over Samsar for Qwen 3.7', () => {
  const enabledProviders = [DOCKER_PROVIDER.SAMSAR, DOCKER_PROVIDER.ALIBABA_CLOUD];
  const available = buildDockerAvailableModelsFromEnabledProviders(enabledProviders);

  assert.equal(
    resolveDockerModelProvider('QWEN3.7', enabledProviders),
    DOCKER_PROVIDER.ALIBABA_CLOUD,
  );
  assert.equal(available.modelProviders['QWEN3.7'], DOCKER_PROVIDER.ALIBABA_CLOUD);
  assert.deepEqual(available.modelProviderPriority['QWEN3.7'], [
    DOCKER_PROVIDER.ALIBABA_CLOUD,
    DOCKER_PROVIDER.SAMSAR,
  ]);
});

test('Happy Horse resolves Alibaba then FAL then Samsar', () => {
  assert.equal(
    resolveDockerModelProvider('HAPPYHORSEI2V', [
      DOCKER_PROVIDER.SAMSAR,
      DOCKER_PROVIDER.FAL,
      DOCKER_PROVIDER.ALIBABA_CLOUD,
    ]),
    DOCKER_PROVIDER.ALIBABA_CLOUD,
  );
  assert.equal(
    resolveDockerModelProvider('HAPPYHORSEI2V', [
      DOCKER_PROVIDER.SAMSAR,
      DOCKER_PROVIDER.FAL,
    ]),
    DOCKER_PROVIDER.FAL,
  );
  assert.equal(
    resolveDockerModelProvider('HAPPYHORSEI2V', [DOCKER_PROVIDER.SAMSAR]),
    DOCKER_PROVIDER.SAMSAR,
  );
});

test('Wan2.7 Pro resolves Alibaba then FAL then Samsar', () => {
  assert.equal(
    resolveDockerModelProvider('WAN2.7PRO', [
      DOCKER_PROVIDER.SAMSAR,
      DOCKER_PROVIDER.FAL,
      DOCKER_PROVIDER.ALIBABA_CLOUD,
    ]),
    DOCKER_PROVIDER.ALIBABA_CLOUD,
  );
  assert.equal(
    resolveDockerModelProvider('WAN2.7PRO', [DOCKER_PROVIDER.SAMSAR, DOCKER_PROVIDER.FAL]),
    DOCKER_PROVIDER.FAL,
  );
  assert.equal(
    resolveDockerModelProvider('WAN2.7PRO', [DOCKER_PROVIDER.SAMSAR]),
    DOCKER_PROVIDER.SAMSAR,
  );
});
