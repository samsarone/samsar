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

test('GMICloud exposes only credential-scoped compatible mappings', () => {
  const available = buildDockerAvailableModelsFromEnabledProviders([
    DOCKER_PROVIDER.GMI_CLOUD,
  ], {
    gmiCloudModelMappings: {
      'gpt-5.6-sol': {
        text: { modelId: 'openai/gpt-5.6-sol' },
        vision: { modelId: 'openai/gpt-5.6-sol' },
      },
      'QWEN3.7': {
        text: { modelId: 'Qwen/Qwen3.7-Max' },
        vision: { modelId: 'Qwen/Qwen3.7-Plus' },
      },
      'VEO3.1': { video: { modelId: 'veo-3.1-generate-001' } },
    },
  });

  assert.deepEqual(available.providers, [DOCKER_PROVIDER.GMI_CLOUD]);
  assert.deepEqual(available.models, ['QWEN3.7', 'VEO3.1', 'gpt-5.6-sol']);
  assert.deepEqual(available.actions, ['assistant', 'chat', 'video']);
  assert.equal(available.modelProviders['QWEN3.7'], DOCKER_PROVIDER.GMI_CLOUD);
  assert.equal(available.modelProviders['gemini-3.1-pro'], undefined);
  assert.equal(available.modelProviderPriority['gemini-3.1-pro'], undefined);
  assert.equal(
    getDockerModelDisplayName('QWEN3.7', DOCKER_PROVIDER.GMI_CLOUD),
    'Qwen 3.7 Max / Plus-equivalent Vision',
  );
});

test('GMICloud inference is not advertised until both text and vision routes are verified', () => {
  const available = buildDockerAvailableModelsFromEnabledProviders([
    DOCKER_PROVIDER.GMI_CLOUD,
  ], {
    gmiCloudModelMappings: {
      'gpt-5.6-sol': { text: { modelId: 'openai/gpt-5.6-sol' } },
      'gemini-3.1-pro': { vision: { modelId: 'google/gemini-3.1-pro-preview' } },
      'QWEN3.7': { text: { modelId: 'Qwen/Qwen3.7-Max' } },
    },
  });

  assert.deepEqual(available.models, []);
  assert.deepEqual(available.actions, []);
});

test('GMICloud exposes each credential-scoped exact compatible video model', () => {
  const videoMappings = {
    'VEO3.1FLIV': { video: { modelId: 'veo-3.1-generate-001' } },
    'SEEDANCE2.0I2V': { video: { modelId: 'seedance-2-0-260128' } },
    'SEEDANCE2.0T2V': { video: { modelId: 'seedance-2-0-260128' } },
    KLINGIMGTOVID3PRO: { video: { modelId: 'kling-v3-image-to-video' } },
    KLINGIMGTOVIDTURBO: { video: { modelId: 'kling-3.0-turbo-i2v' } },
    KLINGIMGTOVIDPRO: { video: { modelId: 'Kling-Image2Video-V1.6-Pro' } },
    'KLINGIMGTOVID2.1MASTER': { video: { modelId: 'Kling-Image2Video-V2.1-Master' } },
    'KLINGIMGTOVID2.1PRO': { video: { modelId: 'Kling-Image2Video-V2.1-Pro' } },
    'KLINGIMGTOVID2.1STANDARD': { video: { modelId: 'Kling-Image2Video-V2.1-Standard' } },
    HAILUOPRO: { video: { modelId: 'Minimax-Hailuo-02' } },
  };
  const available = buildDockerAvailableModelsFromEnabledProviders([
    DOCKER_PROVIDER.GMI_CLOUD,
  ], { gmiCloudModelMappings: videoMappings });

  for (const model of Object.keys(videoMappings)) {
    assert.equal(available.models.includes(model), true, model);
    assert.equal(available.modelProviders[model], DOCKER_PROVIDER.GMI_CLOUD, model);
    assert.equal(
      available.modelProviderPriority[model].indexOf(DOCKER_PROVIDER.GMI_CLOUD) <
        available.modelProviderPriority[model].indexOf(DOCKER_PROVIDER.FAL),
      true,
      model,
    );
  }
  assert.equal(available.models.includes('KLINGTXTTOVID3PRO'), false);
});

test('GMICloud exposes only credential-scoped exact speech routes with audio actions', () => {
  const available = buildDockerAvailableModelsFromEnabledProviders([
    DOCKER_PROVIDER.GMI_CLOUD,
  ], {
    gmiCloudModelMappings: {
      OPENAI_TTS: { audio: { modelId: 'gpt-4o-mini-tts' } },
      ELEVENLABS: { audio: { modelId: 'elevenlabs-tts-multilingual-v2' } },
    },
  });

  assert.deepEqual(available.models, ['ELEVENLABS', 'OPENAI_TTS']);
  assert.deepEqual(available.actions, ['audio']);
  assert.equal(available.modelProviders.OPENAI_TTS, DOCKER_PROVIDER.GMI_CLOUD);
  assert.equal(available.modelProviders.ELEVENLABS, DOCKER_PROVIDER.GMI_CLOUD);
  assert.deepEqual(available.modelProviderPriority.OPENAI_TTS, [
    DOCKER_PROVIDER.OPENAI,
    DOCKER_PROVIDER.SAMSAR,
    DOCKER_PROVIDER.GMI_CLOUD,
  ]);
  assert.deepEqual(available.modelProviderPriority.ELEVENLABS, [
    DOCKER_PROVIDER.ELEVENLABS,
    DOCKER_PROVIDER.SAMSAR,
    DOCKER_PROVIDER.GMI_CLOUD,
    DOCKER_PROVIDER.FAL,
  ]);
});

test('Samsar keeps moderation available when OpenRouter owns inference routing', () => {
  const available = buildDockerAvailableModelsFromEnabledProviders([
    DOCKER_PROVIDER.OPENROUTER,
    DOCKER_PROVIDER.SAMSAR,
  ]);

  assert.equal(available.modelProviders['gpt-5.6-sol'], DOCKER_PROVIDER.OPENROUTER);
  assert.equal(available.actions.includes('moderation'), true);
});

test('validated GMI inference is inserted after Samsar and before OpenRouter only for mapped models', () => {
  const enabledProviders = [
    DOCKER_PROVIDER.OPENROUTER,
    DOCKER_PROVIDER.SAMSAR,
    DOCKER_PROVIDER.GMI_CLOUD,
  ];
  const available = buildDockerAvailableModelsFromEnabledProviders(enabledProviders, {
    gmiCloudModelMappings: {
      'gpt-5.6-sol': {
        text: { modelId: 'openai/gpt-5.6-sol' },
        vision: { modelId: 'openai/gpt-5.6-sol' },
      },
    },
  });

  assert.deepEqual(available.modelProviderPriority['gpt-5.6-sol'], [
    DOCKER_PROVIDER.OPENAI,
    DOCKER_PROVIDER.SAMSAR,
    DOCKER_PROVIDER.GMI_CLOUD,
    DOCKER_PROVIDER.OPENROUTER,
  ]);
  assert.equal(available.modelProviders['gpt-5.6-sol'], DOCKER_PROVIDER.SAMSAR);
  assert.deepEqual(available.modelProviderPriority['gemini-3.1-pro'], [
    DOCKER_PROVIDER.GOOGLE_CLOUD,
    DOCKER_PROVIDER.OPENROUTER,
    DOCKER_PROVIDER.SAMSAR,
  ]);
  assert.equal(available.modelProviders['gemini-3.1-pro'], DOCKER_PROVIDER.OPENROUTER);
});

test('no enabled provider exposes no Qwen model', () => {
  const available = buildDockerAvailableModelsFromEnabledProviders([]);

  assert.equal(available.models.includes('QWEN3.7'), false);
  assert.equal(available.modelProviders['QWEN3.7'], undefined);
});

test('Qwen priority is native Alibaba, Samsar, GMICloud, then OpenRouter', () => {
  const enabledProviders = [
    DOCKER_PROVIDER.SAMSAR,
    DOCKER_PROVIDER.GMI_CLOUD,
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
    DOCKER_PROVIDER.SAMSAR,
    DOCKER_PROVIDER.GMI_CLOUD,
    DOCKER_PROVIDER.OPENROUTER,
  ]);

  assert.equal(
    resolveDockerModelProvider('QWEN3.7', [DOCKER_PROVIDER.SAMSAR, DOCKER_PROVIDER.OPENROUTER]),
    DOCKER_PROVIDER.SAMSAR,
  );
  assert.equal(
    resolveDockerModelProvider('QWEN3.7', [DOCKER_PROVIDER.GMI_CLOUD, DOCKER_PROVIDER.OPENROUTER]),
    DOCKER_PROVIDER.GMI_CLOUD,
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

test('GPT Image 2 priority places validated GMI below OpenAI and Samsar but above FAL', () => {
  const available = buildDockerAvailableModelsFromEnabledProviders([
    DOCKER_PROVIDER.OPENAI,
    DOCKER_PROVIDER.FAL,
    DOCKER_PROVIDER.SAMSAR,
    DOCKER_PROVIDER.GMI_CLOUD,
  ], {
    gmiCloudModelMappings: {
      GPTIMAGE2: { image: { modelId: 'gpt-image-2-generate' } },
    },
  });

  assert.deepEqual(available.modelProviderPriority.GPTIMAGE2, [
    DOCKER_PROVIDER.OPENAI,
    DOCKER_PROVIDER.SAMSAR,
    DOCKER_PROVIDER.GMI_CLOUD,
    DOCKER_PROVIDER.FAL,
  ]);
  assert.equal(available.modelProviders.GPTIMAGE2, DOCKER_PROVIDER.OPENAI);
  assert.equal(
    resolveDockerModelProvider('GPTIMAGE2', [DOCKER_PROVIDER.GMI_CLOUD, DOCKER_PROVIDER.FAL]),
    DOCKER_PROVIDER.GMI_CLOUD,
  );
});

test('credential-scoped image edit routes place GMI below native and Samsar but above FAL', () => {
  const available = buildDockerAvailableModelsFromEnabledProviders([
    DOCKER_PROVIDER.OPENAI,
    DOCKER_PROVIDER.GOOGLE_CLOUD,
    DOCKER_PROVIDER.FAL,
    DOCKER_PROVIDER.SAMSAR,
    DOCKER_PROVIDER.GMI_CLOUD,
  ], {
    gmiCloudModelMappings: {
      GPTIMAGE2EDIT: { image: { modelId: 'gpt-image-2-edit' } },
      NANOBANANA2EDIT: { image: { modelId: 'gemini-3.1-flash-image' } },
      BRIA_ERASER: { image: { modelId: 'bria-eraser' } },
      BRIA_GENFILL: { image: { modelId: 'bria-genfill' } },
    },
  });

  assert.deepEqual(available.modelProviderPriority.GPTIMAGE2EDIT, [
    DOCKER_PROVIDER.OPENAI,
    DOCKER_PROVIDER.SAMSAR,
    DOCKER_PROVIDER.GMI_CLOUD,
  ]);
  assert.deepEqual(available.modelProviderPriority.NANOBANANA2EDIT, [
    DOCKER_PROVIDER.GOOGLE_CLOUD,
    DOCKER_PROVIDER.SAMSAR,
    DOCKER_PROVIDER.GMI_CLOUD,
    DOCKER_PROVIDER.FAL,
  ]);
  assert.deepEqual(available.modelProviderPriority.BRIA_ERASER, [
    DOCKER_PROVIDER.SAMSAR,
    DOCKER_PROVIDER.GMI_CLOUD,
    DOCKER_PROVIDER.FAL,
  ]);
  assert.equal(available.actions.includes('image_edit'), true);
});

test('Happy Horse resolves Alibaba then Samsar then FAL', () => {
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
    DOCKER_PROVIDER.SAMSAR,
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
  const gmiOnly = buildDockerAvailableModelsFromEnabledProviders([
    DOCKER_PROVIDER.GMI_CLOUD,
  ], {
    gmiCloudModelMappings: {
      'WAN2.7PRO': { image: { modelId: 'wan2.7-image-pro' } },
    },
  });
  assert.equal(gmiOnly.models.includes('WAN2.7PRO'), false);
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
