import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractDeploymentProviderEndpointTypes,
  extractDeploymentInferenceModelValues,
  filterHostedInferenceModelOptions,
  formatDeploymentProviderLabel,
  hasValidatedAlibabaQwenInference,
  labelOptionsForDeploymentInferenceProviders,
  normalizeDeploymentInferenceModelValue,
  normalizeDeploymentProviderKey,
  resolveAllowedInferenceModelOption,
} from './deploymentInferencePolicy.mjs';

const MODEL_OPTIONS = [
  { label: 'GPT 5.6 Sol', value: 'gpt-5.6-sol' },
  { label: 'Gemini 3.1 Pro', value: 'gemini-3.1-pro' },
  { label: 'Qwen 3.8 Max', value: 'QWEN3.8' },
  { label: 'Kimi K3', value: 'kimi-k3' },
];

test('hosted inference labels Qwen 3.8 Max for text and vision', () => {
  const hostedOptions = filterHostedInferenceModelOptions(MODEL_OPTIONS);
  assert.deepEqual(
    hostedOptions.map((option) => option.value),
    ['gpt-5.6-sol', 'gemini-3.1-pro', 'QWEN3.8', 'kimi-k3'],
  );
  assert.equal(
    hostedOptions[2].label,
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
    })[2].label,
    'Qwen 3.8 Max',
  );
  assert.equal(
    labelOptionsForDeploymentInferenceProviders(MODEL_OPTIONS, {
      'QWEN3.8': 'alibabaCloud',
    })[2].value,
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
    )[2].label,
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
    ['gpt-5.6-sol', 'gemini-3.1-pro', 'QWEN3.8', 'kimi-k3'],
  );
  assert.equal(
    labelOptionsForDeploymentInferenceProviders(MODEL_OPTIONS, {
      'QWEN3.8': 'samsar',
    })[2].label,
    'Qwen 3.8 Max',
  );
  assert.deepEqual(
    extractDeploymentInferenceModelValues({ deployment: { providers: ['openai', 'googleCloud'] } }),
    ['gpt-5.6-sol', 'gemini-3.1-pro'],
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
    })[2].label,
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
      models: ['gpt-5.6-sol', 'gemini-3.1-pro', 'QWEN3.8'],
      modelProviders: {
        'gpt-5.6-sol': 'openrouter',
        'gemini-3.1-pro': 'openrouter',
        'QWEN3.8': 'openrouter',
      },
    },
  };
  assert.equal(hasValidatedAlibabaQwenInference(payload), true);
  assert.equal(
    labelOptionsForDeploymentInferenceProviders(MODEL_OPTIONS, {
      'QWEN3.8': 'openrouter',
    })[2].label,
    'Qwen 3.8 Max',
  );
  assert.deepEqual(extractDeploymentInferenceModelValues(payload), [
    'gpt-5.6-sol',
    'gemini-3.1-pro',
    'QWEN3.8',
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
    'gpt-5.6-sol',
    'gemini-3.1-pro',
    'QWEN3.8',
    'kimi-k3',
  ]);
});
