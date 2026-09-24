import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractDeploymentProviderEndpointTypes,
  extractDeploymentInferenceModelValues,
  filterOptionsForDeploymentInferenceModels,
  filterHostedInferenceModelOptions,
  formatDeploymentProviderLabel,
  getDeploymentInferenceAvailabilityModelValue,
  hasValidatedAlibabaQwenInference,
  inferGPT56SolEffortFromModelValue,
  labelOptionsForDeploymentInferenceProviders,
  normalizeDeploymentInferenceModelValue,
  normalizeDeploymentProviderKey,
  resolveAllowedInferenceModelOption,
} from './deploymentInferencePolicy.mjs';

const MODEL_OPTIONS = [
  { label: 'gpt-6-astra', value: 'gpt-6-astra' },
  { label: 'Claude Opus 5.5', value: 'claude-opus-5.5' },
  { label: 'Gemini 3.1 Pro', value: 'gemini-3.1-pro' },
  { label: 'Qwen 3.8 Max', value: 'QWEN3.8' },
  { label: 'Kimi K3', value: 'kimi-k3' },
];

test('hosted inference labels Qwen 3.8 Max for text and vision', () => {
  const hostedOptions = filterHostedInferenceModelOptions(MODEL_OPTIONS);
  assert.deepEqual(
    hostedOptions.map((option) => option.value),
    ['gpt-6-astra', 'claude-opus-5.5', 'gemini-3.1-pro', 'QWEN3.8', 'kimi-k3'],
  );
  assert.equal(
    hostedOptions[3].label,
    'Qwen 3.8 Max',
  );
});

test('standalone exposes Qwen only with an explicit model and validated Alibaba provenance', () => {
  const validatedPayload = {
    deployment: {
      providers: ['alibabaCloud'],
      models: ['QWEN3.8'],
      modelProviders: { 'QWEN3.8': 'alibabaCloud' },
    },
  };

  assert.equal(hasValidatedAlibabaQwenInference(validatedPayload), true);
  assert.deepEqual(extractDeploymentInferenceModelValues(validatedPayload), ['QWEN3.8']);
  assert.equal(
    labelOptionsForDeploymentInferenceProviders(MODEL_OPTIONS, {
      'QWEN3.8': 'alibabaCloud',
    }).find((option) => option.value === 'QWEN3.8').label,
    'Qwen 3.8 Max',
  );
  assert.equal(
    labelOptionsForDeploymentInferenceProviders(MODEL_OPTIONS, {
      'QWEN3.8': 'alibabaCloud',
    }).find((option) => option.value === 'QWEN3.8').value,
    'QWEN3.8',
  );
  assert.deepEqual(
    extractDeploymentProviderEndpointTypes({
      deployment: { providerEndpointTypes: { alibabaCloud: 'token_plan' } },
    }),
    { alibabaCloud: 'token_plan' },
  );
  assert.equal(
    labelOptionsForDeploymentInferenceProviders(
      MODEL_OPTIONS,
      { 'QWEN3.8': 'alibabaCloud' },
      { alibabaCloud: 'token_plan' },
    ).find((option) => option.value === 'QWEN3.8').label,
    'Qwen 3.8 Max',
  );

  const incompletePayloads = [
    { deployment: { providers: ['alibabaCloud'], modelProviders: { 'QWEN3.8': 'alibabaCloud' } } },
    { deployment: { models: ['QWEN3.8'], modelProviders: { 'QWEN3.8': 'alibabaCloud' } } },
    { deployment: { providers: ['alibabaCloud'], models: ['QWEN3.8'] } },
  ];

  incompletePayloads.forEach((payload) => {
    assert.equal(hasValidatedAlibabaQwenInference(payload), false);
    assert.equal(extractDeploymentInferenceModelValues(payload).includes('QWEN3.8'), false);
  });
});

test('provider fallbacks expose their configured inference models', () => {
  assert.deepEqual(
    extractDeploymentInferenceModelValues({ deployment: { providers: ['samsar'] } }),
    ['gpt-6-astra', 'claude-opus-5.5', 'gemini-3.1-pro', 'QWEN3.8', 'kimi-k3'],
  );
  assert.equal(
    labelOptionsForDeploymentInferenceProviders(MODEL_OPTIONS, {
      'QWEN3.8': 'samsar',
    }).find((option) => option.value === 'QWEN3.8').label,
    'Qwen 3.8 Max',
  );
  assert.deepEqual(
    extractDeploymentInferenceModelValues({ deployment: { providers: ['openai', 'googleCloud'] } }),
    ['gpt-6-astra', 'gemini-3.1-pro'],
  );
  assert.deepEqual(
    extractDeploymentInferenceModelValues({ deployment: { providers: ['alibabaCloud'] } }),
    [],
  );
  assert.deepEqual(
    extractDeploymentInferenceModelValues({ deployment: { providers: ['gmicloud'] } }),
    ['QWEN3.8'],
  );
  assert.equal(
    labelOptionsForDeploymentInferenceProviders(MODEL_OPTIONS, {
      'QWEN3.8': 'gmicloud',
    }).find((option) => option.value === 'QWEN3.8').label,
    'Qwen 3.8 Max',
  );
});

test('GMICloud and GenBlaze aliases normalize to the deployment provider', () => {
  assert.equal(normalizeDeploymentProviderKey('GMI Cloud'), 'gmicloud');
  assert.equal(normalizeDeploymentProviderKey('GenBlaze'), 'gmicloud');
  assert.equal(formatDeploymentProviderLabel('gmicloud'), 'GMICloud via GenBlaze');
  assert.equal(hasValidatedAlibabaQwenInference({
    deployment: {
      providers: ['gmicloud'],
      models: ['QWEN3.8'],
      modelProviders: { 'QWEN3.8': 'gmicloud' },
    },
  }), true);
});

test('modern GMICloud model catalogs stay authoritative while legacy envelopes retain Qwen', () => {
  assert.deepEqual(
    extractDeploymentInferenceModelValues({
      deployment: {
        providers: ['gmicloud'],
        models: ['gpt-6-astra'],
        modelProviders: { 'gpt-6-astra': 'gmicloud' },
      },
    }),
    ['gpt-6-astra'],
  );
  assert.deepEqual(
    extractDeploymentInferenceModelValues({
      deployment: { providers: ['gmicloud'], models: [] },
    }),
    [],
  );
  assert.deepEqual(
    extractDeploymentInferenceModelValues({ deployment: { providers: ['gmicloud'] } }),
    ['QWEN3.8'],
  );
});

test('Kimi provider and model aliases resolve to the canonical top-level model', () => {
  assert.equal(normalizeDeploymentProviderKey('Moonshot AI'), 'kimi');
  assert.equal(normalizeDeploymentProviderKey('Kimi API'), 'kimi');
  assert.equal(normalizeDeploymentInferenceModelValue('KIMIK3'), 'kimi-k3');
  assert.equal(normalizeDeploymentInferenceModelValue('Moonshot K3'), 'kimi-k3');
  assert.deepEqual(
    extractDeploymentInferenceModelValues({ deployment: { providers: ['kimi'] } }),
    ['kimi-k3'],
  );
  assert.equal(
    resolveAllowedInferenceModelOption('KIMIK3', MODEL_OPTIONS)?.value,
    'kimi-k3',
  );
});

test('OpenRouter alone exposes every inference model with validated Qwen provenance', () => {
  const payload = {
    deployment: {
      providers: ['openrouter'],
      models: ['gpt-6-astra', 'gemini-3.1-pro', 'QWEN3.8'],
      modelProviders: {
        'gpt-6-astra': 'openrouter',
        'gemini-3.1-pro': 'openrouter',
        'QWEN3.8': 'openrouter',
      },
    },
  };
  assert.equal(hasValidatedAlibabaQwenInference(payload), true);
  assert.equal(
    labelOptionsForDeploymentInferenceProviders(MODEL_OPTIONS, {
      'QWEN3.8': 'openrouter',
    }).find((option) => option.value === 'QWEN3.8').label,
    'Qwen 3.8 Max',
  );
  assert.deepEqual(extractDeploymentInferenceModelValues(payload), [
    'gpt-6-astra',
    'gemini-3.1-pro',
    'QWEN3.8',
    'claude-opus-5.5',
  ]);
});

test('model preferences resolve against the allowed options without mutating canonical options', () => {
  const hostedOptions = filterHostedInferenceModelOptions(MODEL_OPTIONS);
  assert.equal(
    resolveAllowedInferenceModelOption('Qwen 3.8 Max', hostedOptions)?.value,
    'QWEN3.8',
  );
  assert.equal(
    resolveAllowedInferenceModelOption('QWEN3.8', hostedOptions)?.value,
    'QWEN3.8',
  );
  assert.equal(
    resolveAllowedInferenceModelOption('QWEN3.8', [{ label: 'Gemini', value: 'gemini-3.1-pro' }])?.value,
    'gemini-3.1-pro',
  );
  assert.equal(
    resolveAllowedInferenceModelOption('qwen-3.8', MODEL_OPTIONS)?.value,
    'QWEN3.8',
  );
  assert.equal(
    resolveAllowedInferenceModelOption('qwen/qwen3.8-max', MODEL_OPTIONS)?.value,
    'QWEN3.8',
  );
  assert.deepEqual(MODEL_OPTIONS.map((option) => option.value), [
    'gpt-6-astra',
    'claude-opus-5.5',
    'gemini-3.1-pro',
    'QWEN3.8',
    'kimi-k3',
  ]);
});

test('legacy GPT 5.6 XHigh model values resolve to canonical Sol with separate effort', () => {
  for (const value of [
    'gpt-6-astra-xhigh',
    'GPT 6 Astra XHigh',
    'GPT 6 Astra Extra High',
    'GPT5.6XHIGH',
  ]) {
    assert.equal(
      normalizeDeploymentInferenceModelValue(value),
      'gpt-6-astra',
    );
    assert.equal(
      getDeploymentInferenceAvailabilityModelValue(value),
      'gpt-6-astra',
    );
  }

  assert.equal(
    normalizeDeploymentInferenceModelValue('GPT 6 Astra High'),
    'gpt-6-astra',
  );
  assert.equal(normalizeDeploymentInferenceModelValue('gpt-6-astra-unknown'), '');
  assert.equal(
    resolveAllowedInferenceModelOption('gpt-6-astra-xhigh', MODEL_OPTIONS)?.value,
    'gpt-6-astra',
  );
  assert.equal(
    resolveAllowedInferenceModelOption('gpt-6-astra', MODEL_OPTIONS)?.value,
    'gpt-6-astra',
  );

  assert.deepEqual(
    filterOptionsForDeploymentInferenceModels(MODEL_OPTIONS, ['gpt-6-astra'])
      .map((option) => option.value),
    ['gpt-6-astra'],
  );
});

test('GPT 6 Astra effort inference is exact and preserves legacy suffix intent', () => {
  assert.equal(inferGPT56SolEffortFromModelValue('gpt-6-astra'), 'high');
  assert.equal(inferGPT56SolEffortFromModelValue('gpt-6-astra-high'), 'high');
  assert.equal(inferGPT56SolEffortFromModelValue('GPT 6 Astra Extra High'), 'xhigh');
  assert.equal(inferGPT56SolEffortFromModelValue('gpt-6-astra-xhigh'), 'xhigh');

  for (const value of ['gpt-5.6-pro', 'gpt-5.6-preview', 'gpt-6-astrastice', 'gemini-xhigh']) {
    assert.equal(inferGPT56SolEffortFromModelValue(value), '');
  }
});
