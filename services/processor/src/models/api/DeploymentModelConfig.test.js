import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  filterModelsForDeploymentAvailability,
  mergeRuntimeInferenceDeploymentAvailability,
  readDeploymentAvailableModels,
} from './DeploymentModelConfig.js';

const ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_DEPLOYMENT_EDITION',
  'SAMSAR_EDITION',
  'SAMSAR_RUNTIME',
  'ALIBABA_API_KEY',
  'DASHSCOPE_API_KEY',
  'ALIBABA_CLOUD_API_KEY',
  'QWEN_API_KEY',
  'FAL_API_KEY',
  'SAMSAR_API_KEY',
  'OPENROUTER_API_KEY',
  'SAMSAR_GENBLAZE_ENABLED',
  'SAMSAR_GENBLAZE_BASE_URL',
  'SAMSAR_GENBLAZE_MODEL_CATALOG_PATH',
  'OPENAI_API_KEY',
  'KIMI_K3_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS_JSON',
  'SAMSAR_AVAILABLE_MODELS_PATH',
  'SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH',
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

test('a raw Alibaba key enables native Qwen and Alibaba media models', () => {
  clearEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.ALIBABA_API_KEY = 'test-key';

  const result = mergeRuntimeInferenceDeploymentAvailability({
    providers: ['openai'],
    models: ['gpt-5.6-sol'],
    actions: ['chat'],
  });

  assert.deepEqual(result.providers, ['openai', 'alibabaCloud']);
  assert.deepEqual(result.models, ['gpt-5.6-sol', 'QWEN3.8', 'HAPPYHORSEI2V', 'WAN2.7PRO']);
  assert.deepEqual(result.actions, ['chat', 'assistant', 'image', 'video']);
  assert.equal(result.modelProviders['QWEN3.8'], 'alibabaCloud');
});

test('preserves Alibaba plan metadata for Docker clients', () => {
  const originalApiKey = process.env.ALIBABA_API_KEY;
  const originalKeyType = process.env.ALIBABA_API_KEY_TYPE;
  const originalEndpointType = process.env.ALIBABA_API_ENDPOINT_TYPE;
  try {
    process.env.ALIBABA_API_KEY = 'alibaba-key';
    process.env.ALIBABA_API_KEY_TYPE = 'token_plan';
    process.env.ALIBABA_API_ENDPOINT_TYPE = 'token_plan';
    const result = mergeRuntimeInferenceDeploymentAvailability({
      providers: ['alibabaCloud'],
      models: ['QWEN3.8'],
      modelProviders: { 'QWEN3.8': 'alibabaCloud' },
    });
    assert.equal(result.providerKeyTypes.alibabaCloud, 'token_plan');
    assert.equal(result.providerEndpointTypes.alibabaCloud, 'token_plan');
  } finally {
    if (originalApiKey === undefined) delete process.env.ALIBABA_API_KEY;
    else process.env.ALIBABA_API_KEY = originalApiKey;
    if (originalKeyType === undefined) delete process.env.ALIBABA_API_KEY_TYPE;
    else process.env.ALIBABA_API_KEY_TYPE = originalKeyType;
    if (originalEndpointType === undefined) delete process.env.ALIBABA_API_ENDPOINT_TYPE;
    else process.env.ALIBABA_API_ENDPOINT_TYPE = originalEndpointType;
  }
});

test('hosted runtime omits Qwen even when saved configuration selected Alibaba', () => {
  clearEnv();

  const result = mergeRuntimeInferenceDeploymentAvailability({
    providers: ['alibabaCloud'],
    models: ['gpt-5.6-sol', 'QWEN3.8'],
    actions: ['chat', 'assistant'],
    modelProviders: {
      'gpt-5.6-sol': 'openai',
      'QWEN3.8': 'alibabaCloud',
    },
    modelProviderPriority: {
      'gpt-5.6-sol': ['openai', 'samsar'],
      'QWEN3.8': ['alibabaCloud'],
    },
  });

  assert.deepEqual(result.models, ['gpt-5.6-sol']);
  assert.deepEqual(result.modelProviders, {
    'gpt-5.6-sol': 'openai',
    'QWEN3.8': 'alibabaCloud',
  });
  assert.deepEqual(result.modelProviderPriority, {
    'gpt-5.6-sol': ['openai', 'samsar'],
    'QWEN3.8': ['alibabaCloud'],
  });
});

test('production Docker keeps production model-filtering policy', () => {
  clearEnv();
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'production';
  process.env.SAMSAR_RUNTIME = 'docker';

  const result = mergeRuntimeInferenceDeploymentAvailability({
    providers: ['alibabaCloud'],
    models: ['gpt-5.6-sol', 'QWEN3.8'],
    actions: ['chat', 'assistant'],
    modelProviders: {
      'gpt-5.6-sol': 'openai',
      'QWEN3.8': 'alibabaCloud',
    },
  });

  assert.deepEqual(result.models, ['gpt-5.6-sol']);
});

test('Docker retains Qwen only for an explicit validated Alibaba model selection', () => {
  clearEnv();
  process.env.CURRENT_ENV = 'docker';

  const configured = {
    providers: ['alibaba_cloud'],
    models: ['QWEN3.8', 'WAN2.7PRO'],
    actions: ['assistant', 'chat', 'image'],
    modelProviders: {
      'QWEN3.8': 'dashscope',
      'WAN2.7PRO': 'fal',
    },
    modelProviderPriority: {
      'QWEN3.8': ['alibabaCloud', 'samsar'],
      'WAN2.7PRO': ['alibabaCloud', 'fal', 'samsar'],
    },
  };

  const result = mergeRuntimeInferenceDeploymentAvailability(configured);

  assert.deepEqual(result.models, ['QWEN3.8', 'WAN2.7PRO']);
  assert.deepEqual(result.modelProviders, configured.modelProviders);
  assert.deepEqual(result.modelProviderPriority, configured.modelProviderPriority);
});

test('canonicalizes saved Qwen 3.8 Max selections to QWEN3.8', () => {
  clearEnv();
  process.env.CURRENT_ENV = 'docker';

  const result = mergeRuntimeInferenceDeploymentAvailability({
    providers: ['alibabaCloud'],
    models: ['QWEN3.8'],
    modelProviders: { 'QWEN3.8': 'alibabaCloud' },
    modelProviderPriority: { 'QWEN3.8': ['alibabaCloud', 'samsar'] },
  });

  assert.deepEqual(result.models, ['QWEN3.8']);
  assert.deepEqual(result.modelProviders, { 'QWEN3.8': 'alibabaCloud' });
  assert.deepEqual(result.modelProviderPriority, {
    'QWEN3.8': ['alibabaCloud', 'samsar'],
  });
});

test('Docker drops Qwen when any saved Alibaba authorization field is missing or mismatched', () => {
  clearEnv();
  process.env.CURRENT_ENV = 'docker';

  const base = {
    providers: ['alibabaCloud'],
    models: ['QWEN3.8'],
    modelProviders: { 'QWEN3.8': 'alibabaCloud' },
  };

  assert.deepEqual(
    mergeRuntimeInferenceDeploymentAvailability({ ...base, providers: ['samsar'] }).models,
    [],
  );
  assert.deepEqual(
    mergeRuntimeInferenceDeploymentAvailability({
      ...base,
      modelProviders: { 'QWEN3.8': 'samsar' },
    }).models,
    [],
  );
  assert.deepEqual(
    mergeRuntimeInferenceDeploymentAvailability({ ...base, modelProviders: {} }).models,
    [],
  );
});

test('Samsar fallback advertises every inference model', () => {
  clearEnv();
  process.env.SAMSAR_API_KEY = 'test-key';

  const result = mergeRuntimeInferenceDeploymentAvailability({
    providers: ['samsar'],
    models: ['gpt-5.6-sol'],
  });

  assert.deepEqual(result.providers, ['samsar']);
  assert.deepEqual(result.models, [
    'gpt-5.6-sol',
    'gemini-3.1-pro',
    'QWEN3.8',
    'KIMIK3',
    'HAPPYHORSEI2V',
    'WAN2.7PRO',
  ]);
  assert.deepEqual(result.actions, ['chat', 'assistant', 'image', 'video']);
});

test('Kimi runtime credentials advertise K3 with native-first provider selection', () => {
  clearEnv();
  process.env.KIMI_K3_API_KEY = 'test-kimi-key';

  const result = mergeRuntimeInferenceDeploymentAvailability({});

  assert.deepEqual(result.providers, ['kimi']);
  assert.deepEqual(result.models, ['KIMIK3']);
  assert.deepEqual(result.actions, ['chat', 'assistant']);
  assert.equal(result.modelProviders.KIMIK3, 'kimi');
  assert.deepEqual(result.modelProviderPriority.KIMIK3, ['kimi', 'samsar']);
});

test('OpenRouter runtime credentials advertise all inference models without media models', () => {
  clearEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

  const result = mergeRuntimeInferenceDeploymentAvailability({});
  assert.deepEqual(result.providers, ['openrouter']);
  assert.deepEqual(result.models, ['gpt-5.6-sol', 'gemini-3.1-pro', 'QWEN3.8']);
  assert.deepEqual(result.actions, ['chat', 'assistant']);
  assert.deepEqual(result.modelProviders, {
    'gpt-5.6-sol': 'openrouter',
    'gemini-3.1-pro': 'openrouter',
    'QWEN3.8': 'openrouter',
  });
});

test('GenBlaze runtime advertises exact GMICloud Qwen text and vision inference', () => {
  clearEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_GENBLAZE_ENABLED = 'true';
  process.env.SAMSAR_GENBLAZE_BASE_URL = 'http://genblaze:8080/v1';
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-genblaze-catalog-'));
  process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH = path.join(
    tempDirectory,
    'genblaze-model-catalog.json',
  );
  fs.writeFileSync(process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH, JSON.stringify({
    provider: 'gmicloud',
    models: {
      'QWEN3.8': {
        text: { modelId: 'Qwen/Qwen3.8-Max', operation: 'chat.completions' },
        vision: { modelId: 'Qwen/Qwen3.8-Max', operation: 'chat.completions' },
      },
    },
  }));

  try {
    const result = mergeRuntimeInferenceDeploymentAvailability({});
    assert.deepEqual(result.providers, ['gmicloud']);
    assert.deepEqual(result.models, ['QWEN3.8']);
    assert.deepEqual(result.actions, ['chat', 'assistant']);
    assert.equal(result.modelProviders['QWEN3.8'], 'gmicloud');
    assert.deepEqual(result.modelProviderPriority['QWEN3.8'], [
      'alibabaCloud',
      'gmicloud',
      'samsar',
      'openrouter',
    ]);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test('GenBlaze runtime flag never advertises inference without exact catalog routes', () => {
  clearEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_GENBLAZE_ENABLED = 'true';

  const result = mergeRuntimeInferenceDeploymentAvailability({});
  assert.deepEqual(result.providers, []);
  assert.deepEqual(result.models, []);
  assert.deepEqual(result.actions, []);
});

test('stale saved GMICloud inference is removed when its runtime catalog route is absent', () => {
  clearEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_GENBLAZE_ENABLED = 'true';

  const result = mergeRuntimeInferenceDeploymentAvailability({
    providers: ['gmicloud'],
    models: ['QWEN3.8'],
    actions: ['chat', 'assistant'],
    modelProviders: { 'QWEN3.8': 'gmicloud' },
    modelProviderPriority: {
      'QWEN3.8': ['alibabaCloud', 'samsar', 'gmicloud', 'openrouter'],
    },
  });

  assert.deepEqual(result.models, []);
  assert.deepEqual(result.actions, []);
  assert.equal(result.modelProviders['QWEN3.8'], undefined);
});

test('Docker retains Qwen with validated GMICloud provenance', () => {
  clearEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_GENBLAZE_ENABLED = 'true';
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-genblaze-saved-'));
  process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH = path.join(
    tempDirectory,
    'genblaze-model-catalog.json',
  );
  fs.writeFileSync(process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH, JSON.stringify({
    provider: 'gmicloud',
    models: {
      'QWEN3.8': {
        text: { modelId: 'Qwen/Qwen3.8-Max' },
        vision: { modelId: 'Qwen/Qwen3.8-Max' },
      },
    },
  }));
  try {
    const result = mergeRuntimeInferenceDeploymentAvailability({
      providers: ['gmicloud'],
      models: ['QWEN3.8'],
      modelProviders: { 'QWEN3.8': 'gmicloud' },
      modelProviderPriority: {
        'QWEN3.8': ['alibabaCloud', 'samsar', 'gmicloud', 'openrouter'],
      },
    });
    assert.deepEqual(result.models, ['QWEN3.8']);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test('GMICloud and FAL availability is a union with shared-model adapter preferences', () => {
  clearEnv();
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
  process.env.SAMSAR_RUNTIME = 'container';
  process.env.SAMSAR_GENBLAZE_ENABLED = 'true';
  process.env.FAL_API_KEY = 'test-fal-key';
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-gmi-fal-union-'));
  process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH = path.join(
    tempDirectory,
    'genblaze-model-catalog.json',
  );
  process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH = path.join(
    tempDirectory,
    'model-adapter-preferences.json',
  );
  fs.writeFileSync(process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH, JSON.stringify({
    provider: 'gmicloud',
    models: {
      GPTIMAGE2: {
        image: { modelId: 'gpt-image-2-generate', operation: 'image.generate' },
      },
      SEEDREAM: {
        image: { modelId: 'seedream-5.0-pro', operation: 'image.generate' },
      },
      SEEDANCEI2V: {
        video: { modelId: 'seedance-1-5-pro-251215', operation: 'video.generate' },
      },
    },
  }));
  fs.writeFileSync(process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH, JSON.stringify({
    modelProviderPriority: {
      GPTIMAGE2: ['fal', 'gmicloud'],
      SEEDANCEI2V: ['gmicloud', 'fal'],
    },
  }));

  try {
    const result = mergeRuntimeInferenceDeploymentAvailability({
      providers: ['gmicloud', 'fal'],
      models: [
        'GPTIMAGE2',
        'SEEDREAM',
        'WAN2.7PRO',
        'SEEDANCEI2V',
        'COSMOS3SUPERI2V',
      ],
      actions: ['image', 'video'],
      modelProviders: {
        GPTIMAGE2: 'gmicloud',
        SEEDREAM: 'gmicloud',
        'WAN2.7PRO': 'fal',
        SEEDANCEI2V: 'gmicloud',
        COSMOS3SUPERI2V: 'fal',
      },
      modelProviderPriority: {
        GPTIMAGE2: ['gmicloud', 'fal'],
        SEEDREAM: ['gmicloud', 'fal'],
        'WAN2.7PRO': ['fal'],
        SEEDANCEI2V: ['gmicloud', 'fal'],
        COSMOS3SUPERI2V: ['fal'],
      },
    });

    assert.deepEqual(result.models, [
      'GPTIMAGE2',
      'SEEDREAM',
      'WAN2.7PRO',
      'SEEDANCEI2V',
      'COSMOS3SUPERI2V',
      'HAPPYHORSEI2V',
    ]);
    assert.equal(result.modelProviders.GPTIMAGE2, 'fal');
    assert.equal(result.modelProviders.SEEDREAM, 'gmicloud');
    assert.equal(result.modelProviders.SEEDANCEI2V, 'gmicloud');
    assert.equal(result.modelProviders['WAN2.7PRO'], 'fal');
    assert.equal(result.modelProviders.COSMOS3SUPERI2V, 'fal');
    assert.deepEqual(result.modelProviderPriority.GPTIMAGE2, ['fal', 'gmicloud']);
    assert.deepEqual(result.modelProviderPriority.SEEDANCEI2V, ['gmicloud', 'fal']);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test('an unavailable preferred GMICloud route falls back without removing the FAL model', () => {
  clearEnv();
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
  process.env.SAMSAR_RUNTIME = 'container';
  process.env.SAMSAR_GENBLAZE_ENABLED = 'true';
  process.env.FAL_API_KEY = 'test-fal-key';
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-gmi-fal-fallback-'));
  process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH = path.join(
    tempDirectory,
    'genblaze-model-catalog.json',
  );
  fs.writeFileSync(process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH, JSON.stringify({
    provider: 'gmicloud',
    models: {},
  }));

  try {
    const result = mergeRuntimeInferenceDeploymentAvailability({
      providers: ['gmicloud', 'fal'],
      models: ['GPTIMAGE2'],
      actions: ['image'],
      modelProviders: { GPTIMAGE2: 'gmicloud' },
      modelProviderPriority: { GPTIMAGE2: ['gmicloud', 'fal'] },
    });

    assert.equal(result.models.includes('GPTIMAGE2'), true);
    assert.equal(result.modelProviders.GPTIMAGE2, 'fal');
    assert.deepEqual(result.modelProviderPriority.GPTIMAGE2, ['fal']);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test('Docker retains Qwen with validated OpenRouter provenance', () => {
  clearEnv();
  process.env.CURRENT_ENV = 'docker';
  const result = mergeRuntimeInferenceDeploymentAvailability({
    providers: ['openrouter'],
    models: ['QWEN3.8'],
    modelProviders: { 'QWEN3.8': 'openrouter' },
    modelProviderPriority: { 'QWEN3.8': ['alibabaCloud', 'openrouter', 'samsar'] },
  });
  assert.deepEqual(result.models, ['QWEN3.8']);
});

test('FAL runtime enrichment exposes Wan2.7 Pro and Happy Horse media actions', () => {
  clearEnv();
  process.env.FAL_API_KEY = 'test-key';

  const result = mergeRuntimeInferenceDeploymentAvailability({});

  assert.deepEqual(result.providers, ['fal']);
  assert.deepEqual(result.models, ['WAN2.7PRO', 'HAPPYHORSEI2V']);
  assert.deepEqual(result.actions, ['image', 'video']);
});

test('runtime Alibaba availability supplements a stale saved model filter', () => {
  clearEnv();
  process.env.ALIBABA_API_KEY = 'test-key';

  const models = filterModelsForDeploymentAvailability(
    [
      { value: 'VEO3.1I2V' },
      { value: 'HAPPYHORSEI2V' },
      { value: 'WAN2.7PRO' },
    ],
    {
      providers: ['openai'],
      models: ['gpt-5.6-sol'],
      actions: ['chat'],
    },
  );

  assert.deepEqual(models, [
    { value: 'HAPPYHORSEI2V' },
    { value: 'WAN2.7PRO' },
  ]);
});

test('runtime FAL availability supplements a stale saved image model filter', () => {
  clearEnv();
  process.env.FAL_API_KEY = 'test-key';

  const models = filterModelsForDeploymentAvailability(
    [
      { value: 'GPTIMAGE2' },
      { value: 'WAN2.7PRO' },
      { value: 'HAPPYHORSEI2V' },
    ],
    {
      providers: ['openai'],
      models: ['GPTIMAGE2'],
      actions: ['image'],
    },
  );

  assert.deepEqual(models, [
    { value: 'GPTIMAGE2' },
    { value: 'WAN2.7PRO' },
    { value: 'HAPPYHORSEI2V' },
  ]);
});

test('reads provider-selection metadata from the saved availability artifact', () => {
  clearEnv();
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-available-models-'));
  const filePath = path.join(tempDirectory, 'available-models.json');
  process.env.SAMSAR_AVAILABLE_MODELS_PATH = filePath;

  fs.writeFileSync(filePath, JSON.stringify({
    providers: ['alibabaCloud', 'fal'],
    models: ['QWEN3.8', 'WAN2.7PRO'],
    actions: ['chat', 'image'],
    modelProviders: {
      'QWEN3.8': 'alibabaCloud',
      'WAN2.7PRO': 'fal',
    },
    modelProviderPriority: {
      'QWEN3.8': ['alibabaCloud', 'samsar'],
      'WAN2.7PRO': ['alibabaCloud', 'fal', 'samsar'],
    },
  }));

  try {
    const result = readDeploymentAvailableModels();
    assert.deepEqual(result.modelProviders, {
      'QWEN3.8': 'alibabaCloud',
      'WAN2.7PRO': 'fal',
    });
    assert.deepEqual(result.modelProviderPriority, {
      'QWEN3.8': ['alibabaCloud', 'samsar'],
      'WAN2.7PRO': ['alibabaCloud', 'fal', 'samsar'],
    });
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test('runtime enrichment preserves the installation default order separately from saved preferences', () => {
  clearEnv();
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-adapter-defaults-'));
  const preferencePath = path.join(tempDirectory, 'model-adapter-preferences.json');
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
  process.env.SAMSAR_RUNTIME = 'docker';
  process.env.ALIBABA_API_KEY = 'configured';
  process.env.SAMSAR_API_KEY = 'configured';
  process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH = preferencePath;
  fs.writeFileSync(preferencePath, JSON.stringify({
    modelProviderPriority: {
      'QWEN3.8': ['samsar', 'alibabaCloud'],
    },
  }));

  try {
    const result = mergeRuntimeInferenceDeploymentAvailability({
      providers: ['alibabaCloud', 'samsar'],
      models: ['QWEN3.8'],
      modelProviders: { 'QWEN3.8': 'samsar' },
      modelProviderPriority: {
        'QWEN3.8': ['samsar', 'alibabaCloud', 'openrouter'],
      },
      defaultModelProviderPriority: {
        'QWEN3.8': ['alibabaCloud', 'openrouter', 'samsar'],
      },
    });

    assert.deepEqual(result.modelProviderPriority['QWEN3.8'], [
      'samsar',
      'alibabaCloud',
      'gmicloud',
      'openrouter',
    ]);
    assert.deepEqual(result.defaultModelProviderPriority['QWEN3.8'], [
      'alibabaCloud',
      'gmicloud',
      'samsar',
      'openrouter',
    ]);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test('Docker hides Wan2.7 Pro without an Alibaba, FAL, or Samsar credential', () => {
  clearEnv();
  process.env.CURRENT_ENV = 'docker';
  const models = [
    { value: 'GPTIMAGE2' },
    { value: 'WAN2.7PRO' },
  ];

  assert.deepEqual(filterModelsForDeploymentAvailability(models, null), [
    { value: 'GPTIMAGE2' },
  ]);
  assert.deepEqual(filterModelsForDeploymentAvailability(models, { models: [] }), [
    { value: 'GPTIMAGE2' },
  ]);
  assert.deepEqual(filterModelsForDeploymentAvailability(models, {
    models: ['GPTIMAGE2', 'WAN2.7PRO'],
  }), [
    { value: 'GPTIMAGE2' },
  ]);

  process.env.FAL_API_KEY = 'test-key';
  assert.deepEqual(filterModelsForDeploymentAvailability(models, null), models);
});
