import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DOCKER_PROVIDER,
  buildDockerAvailableModelsFromEnabledProviders,
  buildExpressPipelineAvailability,
  getDockerModelDisplayName,
  resolveDockerModelProvider,
} from './dockerModelAvailability.js';

const INFERENCE_MODEL_KEYS = Object.freeze([
  'gpt-5.6-sol',
  'gemini-3.1-pro',
  'KIMIK3',
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
  assert.equal(
    getDockerModelDisplayName('QWEN3.7', DOCKER_PROVIDER.ALIBABA_CLOUD),
    'Qwen 3.7 Plus',
  );
});

test('Samsar exposes every supported inference model, including Kimi K3', () => {
  const available = buildDockerAvailableModelsFromEnabledProviders([
    DOCKER_PROVIDER.SAMSAR,
  ]);

  assert.deepEqual(
    getAvailableInferenceModels(available),
    ['KIMIK3', 'QWEN3.7', 'gemini-3.1-pro', 'gpt-5.6-sol'],
  );
  for (const model of INFERENCE_MODEL_KEYS) {
    assert.equal(available.modelProviders[model], DOCKER_PROVIDER.SAMSAR);
  }
});

test('OpenRouter alone exposes GPT, Gemini, and Qwen inference', () => {
  const available = buildDockerAvailableModelsFromEnabledProviders([
    DOCKER_PROVIDER.OPENROUTER,
  ]);
  assert.deepEqual(
    getAvailableInferenceModels(available),
    ['QWEN3.7', 'gemini-3.1-pro', 'gpt-5.6-sol'],
  );
  assert.deepEqual(available.actions, ['assistant', 'chat']);
  for (const model of ['gpt-5.6-sol', 'gemini-3.1-pro', 'QWEN3.7']) {
    assert.equal(available.modelProviders[model], DOCKER_PROVIDER.OPENROUTER);
  }
  assert.equal(available.modelProviders.KIMIK3, undefined);
  assert.equal(
    getDockerModelDisplayName('QWEN3.7', DOCKER_PROVIDER.OPENROUTER),
    'Qwen 3.7 Plus',
  );
});

test('Samsar keeps moderation available when OpenRouter owns inference routing', () => {
  const available = buildDockerAvailableModelsFromEnabledProviders([
    DOCKER_PROVIDER.OPENROUTER,
    DOCKER_PROVIDER.SAMSAR,
  ]);

  assert.equal(available.modelProviders['gpt-5.6-sol'], DOCKER_PROVIDER.OPENROUTER);
  assert.equal(available.actions.includes('moderation'), true);
});

test('no enabled provider exposes no Qwen model', () => {
  const available = buildDockerAvailableModelsFromEnabledProviders([]);

  assert.equal(available.models.includes('QWEN3.7'), false);
  assert.equal(available.modelProviders['QWEN3.7'], undefined);
});

test('Qwen priority is Alibaba Cloud, OpenRouter, then Samsar', () => {
  const enabledProviders = [
    DOCKER_PROVIDER.SAMSAR,
    DOCKER_PROVIDER.OPENROUTER,
    DOCKER_PROVIDER.ALIBABA_CLOUD,
  ];
  const available = buildDockerAvailableModelsFromEnabledProviders(enabledProviders);

  assert.equal(
    resolveDockerModelProvider('QWEN3.7', enabledProviders),
    DOCKER_PROVIDER.ALIBABA_CLOUD,
  );
  assert.equal(available.modelProviders['QWEN3.7'], DOCKER_PROVIDER.ALIBABA_CLOUD);
  assert.deepEqual(available.modelProviderPriority['QWEN3.7'], [
    DOCKER_PROVIDER.ALIBABA_CLOUD,
    DOCKER_PROVIDER.OPENROUTER,
    DOCKER_PROVIDER.SAMSAR,
  ]);

  assert.equal(
    resolveDockerModelProvider('QWEN3.7', [DOCKER_PROVIDER.SAMSAR, DOCKER_PROVIDER.OPENROUTER]),
    DOCKER_PROVIDER.OPENROUTER,
  );
});

test('Kimi K3 priority is the native Kimi API, then Samsar', () => {
  const enabledProviders = [
    DOCKER_PROVIDER.SAMSAR,
    DOCKER_PROVIDER.KIMI,
  ];
  const available = buildDockerAvailableModelsFromEnabledProviders(enabledProviders);

  assert.equal(
    resolveDockerModelProvider('KIMIK3', enabledProviders),
    DOCKER_PROVIDER.KIMI,
  );
  assert.equal(available.modelProviders.KIMIK3, DOCKER_PROVIDER.KIMI);
  assert.deepEqual(available.modelProviderPriority.KIMIK3, [
    DOCKER_PROVIDER.KIMI,
    DOCKER_PROVIDER.SAMSAR,
  ]);
  assert.equal(getDockerModelDisplayName('KIMIK3', DOCKER_PROVIDER.KIMI), 'Kimi K3');

  assert.equal(
    resolveDockerModelProvider('KIMIK3', [DOCKER_PROVIDER.SAMSAR]),
    DOCKER_PROVIDER.SAMSAR,
  );
  for (const alias of ['kimi-k3', 'Kimi K3', 'kimi_k3', 'Moonshot K3']) {
    assert.equal(
      resolveDockerModelProvider(alias, enabledProviders),
      DOCKER_PROVIDER.KIMI,
    );
    assert.equal(getDockerModelDisplayName(alias), 'Kimi K3');
  }
});

test('GPT Image 2 priority is OpenAI, FAL, then Samsar', () => {
  const available = buildDockerAvailableModelsFromEnabledProviders([
    DOCKER_PROVIDER.OPENAI,
    DOCKER_PROVIDER.FAL,
    DOCKER_PROVIDER.SAMSAR,
  ]);

  assert.deepEqual(available.modelProviderPriority.GPTIMAGE2, [
    DOCKER_PROVIDER.OPENAI,
    DOCKER_PROVIDER.FAL,
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

test('provider model display names are clean and stable', () => {
  assert.equal(getDockerModelDisplayName('GPTIMAGE2EDIT'), 'GPT Image 2 Edit');
  assert.equal(getDockerModelDisplayName('elevenlabs_music'), 'ElevenLabs Music');
});

test('Samsar alone enables the complete Express pipeline model set', () => {
  const available = buildDockerAvailableModelsFromEnabledProviders([DOCKER_PROVIDER.SAMSAR]);
  const expressAvailability = buildExpressPipelineAvailability(available);

  assert.equal(expressAvailability.isReady, true);
  assert.deepEqual(expressAvailability.missingRequirements, []);
});

test('Fal needs an inference provider for the complete Express pipeline model set', () => {
  const falOnly = buildDockerAvailableModelsFromEnabledProviders([DOCKER_PROVIDER.FAL]);
  const falOnlyExpressAvailability = buildExpressPipelineAvailability(falOnly);

  assert.equal(falOnlyExpressAvailability.isReady, false);
  assert.deepEqual(
    falOnlyExpressAvailability.missingRequirements.map((requirement) => requirement.key),
    ['inference'],
  );

  for (const inferenceProvider of [
    DOCKER_PROVIDER.OPENAI,
    DOCKER_PROVIDER.GOOGLE_CLOUD,
    DOCKER_PROVIDER.KIMI,
    DOCKER_PROVIDER.ALIBABA_CLOUD,
    DOCKER_PROVIDER.OPENROUTER,
  ]) {
    const inferenceAndFal = buildDockerAvailableModelsFromEnabledProviders([
      inferenceProvider,
      DOCKER_PROVIDER.FAL,
    ]);
    assert.equal(
      buildExpressPipelineAvailability(inferenceAndFal).isReady,
      true,
      `${inferenceProvider} plus Fal should enable the complete Express pipeline model set`,
    );
  }
});

test('an inference-only config reports every missing Express media type', () => {
  const available = buildDockerAvailableModelsFromEnabledProviders([DOCKER_PROVIDER.OPENROUTER]);
  const expressAvailability = buildExpressPipelineAvailability(available);

  assert.deepEqual(
    expressAvailability.missingRequirements.map((requirement) => requirement.label),
    ['Image generation', 'Video', 'Speech', 'Backing track', 'Lip sync', 'Sound effect'],
  );
});
