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
  { label: 'Qwen 3.7 Plus', value: 'QWEN3.7' },
  { label: 'Kimi K3', value: 'kimi-k3' },
];

test('hosted inference labels OpenRouter Qwen text Max and vision Plus', () => {
  const hostedOptions = filterHostedInferenceModelOptions(MODEL_OPTIONS);
  assert.deepEqual(
    hostedOptions.map((option) => option.value),
    ['gpt-5.6-sol', 'gemini-3.1-pro', 'QWEN3.7', 'kimi-k3'],
  );
  assert.equal(
    hostedOptions[2].label,
    'Qwen 3.7 Max / Qwen 3.7 Plus Vision',
  );
});

test('standalone exposes Qwen only with an explicit model and validated Alibaba provenance', () => {
  const validatedPayload = {
    deployment: {
      providers: ['alibabaCloud'],
      models: ['QWEN3.7'],
      modelProviders: { 'QWEN3.7': 'alibabaCloud' },
    },
  };

  assert.equal(hasValidatedAlibabaQwenInference(validatedPayload), true);
  assert.deepEqual(extractDeploymentInferenceModelValues(validatedPayload), ['QWEN3.7']);
  assert.equal(
    labelOptionsForDeploymentInferenceProviders(MODEL_OPTIONS, {
      'QWEN3.7': 'alibabaCloud',
    })[2].label,
    'Qwen 3.7 Plus',
  );
  assert.equal(
    labelOptionsForDeploymentInferenceProviders(MODEL_OPTIONS, {
      'QWEN3.7': 'alibabaCloud',
    })[2].value,
    'QWEN3.7',
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
      { 'QWEN3.7': 'alibabaCloud' },
      { alibabaCloud: 'token_plan' },
    )[2].label,
    'Qwen 3.8 Max Preview / Qwen 3.7 Plus Vision',
  );

  const incompletePayloads = [
    { deployment: { providers: ['alibabaCloud'], modelProviders: { 'QWEN3.7': 'alibabaCloud' } } },
    { deployment: { models: ['QWEN3.7'], modelProviders: { 'QWEN3.7': 'alibabaCloud' } } },
    { deployment: { providers: ['alibabaCloud'], models: ['QWEN3.7'] } },
  ];

  incompletePayloads.forEach((payload) => {
    assert.equal(hasValidatedAlibabaQwenInference(payload), false);
    assert.equal(extractDeploymentInferenceModelValues(payload).includes('QWEN3.7'), false);
  });
});

test('provider fallbacks expose their configured inference models', () => {
  assert.deepEqual(
    extractDeploymentInferenceModelValues({ deployment: { providers: ['samsar'] } }),
    ['gpt-5.6-sol', 'gemini-3.1-pro', 'QWEN3.7', 'kimi-k3'],
  );
  assert.equal(
    labelOptionsForDeploymentInferenceProviders(MODEL_OPTIONS, {
      'QWEN3.7': 'samsar',
    })[2].label,
    'Qwen 3.7 Max / Qwen 3.7 Plus Vision',
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
    ['QWEN3.7'],
  );
  assert.equal(
    labelOptionsForDeploymentInferenceProviders(MODEL_OPTIONS, {
      'QWEN3.7': 'gmicloud',
    })[2].label,
    'Qwen 3.7 Max / Qwen 3.7 Plus Vision',
  );
});

test('GMICloud and GenBlaze aliases normalize to the deployment provider', () => {
  assert.equal(normalizeDeploymentProviderKey('GMI Cloud'), 'gmicloud');
  assert.equal(normalizeDeploymentProviderKey('GenBlaze'), 'gmicloud');
  assert.equal(formatDeploymentProviderLabel('gmicloud'), 'GMICloud via GenBlaze');
  assert.equal(hasValidatedAlibabaQwenInference({
    deployment: {
      providers: ['gmicloud'],
      models: ['QWEN3.7'],
      modelProviders: { 'QWEN3.7': 'gmicloud' },
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
      models: ['gpt-5.6-sol', 'gemini-3.1-pro', 'QWEN3.7'],
      modelProviders: {
        'gpt-5.6-sol': 'openrouter',
        'gemini-3.1-pro': 'openrouter',
        'QWEN3.7': 'openrouter',
      },
    },
  };
  assert.equal(hasValidatedAlibabaQwenInference(payload), true);
  assert.equal(
    labelOptionsForDeploymentInferenceProviders(MODEL_OPTIONS, {
      'QWEN3.7': 'openrouter',
    })[2].label,
    'Qwen 3.7 Max / Qwen 3.7 Plus Vision',
  );
  assert.deepEqual(extractDeploymentInferenceModelValues(payload), [
    'gpt-5.6-sol',
    'gemini-3.1-pro',
    'QWEN3.7',
  ]);
});

test('model preferences resolve against the allowed options without mutating canonical options', () => {
  const hostedOptions = filterHostedInferenceModelOptions(MODEL_OPTIONS);
  assert.equal(
    resolveAllowedInferenceModelOption('QWEN3.7', hostedOptions)?.value,
    'QWEN3.7',
  );
  assert.equal(
    resolveAllowedInferenceModelOption('QWEN3.8', hostedOptions)?.value,
    'QWEN3.7',
  );
  assert.equal(
    resolveAllowedInferenceModelOption('QWEN3.7', [{ label: 'Gemini', value: 'gemini-3.1-pro' }])?.value,
    'gemini-3.1-pro',
  );
  assert.equal(
    resolveAllowedInferenceModelOption('qwen-3.7', MODEL_OPTIONS)?.value,
    'QWEN3.7',
  );
  assert.deepEqual(MODEL_OPTIONS.map((option) => option.value), [
    'gpt-5.6-sol',
    'gemini-3.1-pro',
    'QWEN3.7',
    'kimi-k3',
  ]);
});
