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
  'ALIBABA_API_KEY',
  'DASHSCOPE_API_KEY',
  'ALIBABA_CLOUD_API_KEY',
  'QWEN_API_KEY',
  'FAL_API_KEY',
  'SAMSAR_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS_JSON',
  'SAMSAR_AVAILABLE_MODELS_PATH',
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
  assert.deepEqual(result.models, ['gpt-5.6-sol', 'QWEN3.7', 'HAPPYHORSEI2V', 'WAN2.7PRO']);
  assert.deepEqual(result.actions, ['chat', 'assistant', 'image', 'video']);
  assert.equal(result.modelProviders['QWEN3.7'], 'alibabaCloud');
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
      models: ['QWEN3.7'],
      modelProviders: { 'QWEN3.7': 'alibabaCloud' },
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
    models: ['gpt-5.6-sol', 'QWEN3.7'],
    actions: ['chat', 'assistant'],
    modelProviders: {
      'gpt-5.6-sol': 'openai',
      'QWEN3.7': 'alibabaCloud',
    },
    modelProviderPriority: {
      'gpt-5.6-sol': ['openai', 'samsar'],
      'QWEN3.7': ['alibabaCloud'],
    },
  });

  assert.deepEqual(result.models, ['gpt-5.6-sol']);
  assert.deepEqual(result.modelProviders, {
    'gpt-5.6-sol': 'openai',
    'QWEN3.7': 'alibabaCloud',
  });
  assert.deepEqual(result.modelProviderPriority, {
    'gpt-5.6-sol': ['openai', 'samsar'],
    'QWEN3.7': ['alibabaCloud'],
  });
});

test('Docker retains Qwen only for an explicit validated Alibaba model selection', () => {
  clearEnv();
  process.env.CURRENT_ENV = 'docker';

  const configured = {
    providers: ['alibaba_cloud'],
    models: ['QWEN3.7', 'WAN2.7PRO'],
    actions: ['assistant', 'chat', 'image'],
    modelProviders: {
      'QWEN3.7': 'dashscope',
      'WAN2.7PRO': 'fal',
    },
    modelProviderPriority: {
      'QWEN3.7': ['alibabaCloud', 'samsar'],
      'WAN2.7PRO': ['alibabaCloud', 'fal', 'samsar'],
    },
  };

  const result = mergeRuntimeInferenceDeploymentAvailability(configured);

  assert.deepEqual(result.models, ['QWEN3.7', 'WAN2.7PRO']);
  assert.deepEqual(result.modelProviders, configured.modelProviders);
  assert.deepEqual(result.modelProviderPriority, configured.modelProviderPriority);
});

test('canonicalizes saved Qwen 3.8 selections to Qwen 3.7 until 3.8 is added separately', () => {
  clearEnv();
  process.env.CURRENT_ENV = 'docker';

  const result = mergeRuntimeInferenceDeploymentAvailability({
    providers: ['alibabaCloud'],
    models: ['QWEN3.8'],
    modelProviders: { 'QWEN3.8': 'alibabaCloud' },
    modelProviderPriority: { 'QWEN3.8': ['alibabaCloud', 'samsar'] },
  });

  assert.deepEqual(result.models, ['QWEN3.7']);
  assert.deepEqual(result.modelProviders, { 'QWEN3.7': 'alibabaCloud' });
  assert.deepEqual(result.modelProviderPriority, {
    'QWEN3.7': ['alibabaCloud', 'samsar'],
  });
});

test('Docker drops Qwen when any saved Alibaba authorization field is missing or mismatched', () => {
  clearEnv();
  process.env.CURRENT_ENV = 'docker';

  const base = {
    providers: ['alibabaCloud'],
    models: ['QWEN3.7'],
    modelProviders: { 'QWEN3.7': 'alibabaCloud' },
  };

  assert.deepEqual(
    mergeRuntimeInferenceDeploymentAvailability({ ...base, providers: ['samsar'] }).models,
    [],
  );
  assert.deepEqual(
    mergeRuntimeInferenceDeploymentAvailability({
      ...base,
      modelProviders: { 'QWEN3.7': 'samsar' },
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
    'QWEN3.7',
    'HAPPYHORSEI2V',
    'WAN2.7PRO',
  ]);
  assert.deepEqual(result.actions, ['chat', 'assistant', 'image', 'video']);
});

test('OpenRouter runtime credentials advertise all inference models without media models', () => {
  clearEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

  const result = mergeRuntimeInferenceDeploymentAvailability({});
  assert.deepEqual(result.providers, ['openrouter']);
  assert.deepEqual(result.models, ['gpt-5.6-sol', 'gemini-3.1-pro', 'QWEN3.7']);
  assert.deepEqual(result.actions, ['chat', 'assistant']);
  assert.deepEqual(result.modelProviders, {
    'gpt-5.6-sol': 'openrouter',
    'gemini-3.1-pro': 'openrouter',
    'QWEN3.7': 'openrouter',
  });
});

test('Docker retains Qwen with validated OpenRouter provenance', () => {
  clearEnv();
  process.env.CURRENT_ENV = 'docker';
  const result = mergeRuntimeInferenceDeploymentAvailability({
    providers: ['openrouter'],
    models: ['QWEN3.7'],
    modelProviders: { 'QWEN3.7': 'openrouter' },
    modelProviderPriority: { 'QWEN3.7': ['alibabaCloud', 'openrouter', 'samsar'] },
  });
  assert.deepEqual(result.models, ['QWEN3.7']);
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
    models: ['QWEN3.7', 'WAN2.7PRO'],
    actions: ['chat', 'image'],
    modelProviders: {
      'QWEN3.7': 'alibabaCloud',
      'WAN2.7PRO': 'fal',
    },
    modelProviderPriority: {
      'QWEN3.7': ['alibabaCloud', 'samsar'],
      'WAN2.7PRO': ['alibabaCloud', 'fal', 'samsar'],
    },
  }));

  try {
    const result = readDeploymentAvailableModels();
    assert.deepEqual(result.modelProviders, {
      'QWEN3.7': 'alibabaCloud',
      'WAN2.7PRO': 'fal',
    });
    assert.deepEqual(result.modelProviderPriority, {
      'QWEN3.7': ['alibabaCloud', 'samsar'],
      'WAN2.7PRO': ['alibabaCloud', 'fal', 'samsar'],
    });
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
