import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GPT_56_SOL_REASONING_EFFORT,
  getGPT56SolReasoningEffort,
  KIMI_K3_INFERENCE_MODEL,
  QWEN_38_INFERENCE_MODEL,
  getProviderModelForInferenceModel,
  isGPT56SolInferenceModel,
  isKimiInferenceModel,
  isQwenInferenceModel,
  normalizeInferenceModel,
} from './InferenceModels.js';

test('uses high reasoning for GPT 6.2 Astra inference aliases', () => {
  assert.equal(GPT_56_SOL_REASONING_EFFORT, 'high');
  assert.equal(isGPT56SolInferenceModel('gpt-6.2-astra'), true);
  assert.equal(isGPT56SolInferenceModel('gpt-5.6'), true);
  assert.equal(isGPT56SolInferenceModel('gpt-4o-mini'), false);
  assert.equal(normalizeInferenceModel('gpt-6.2-astra-high'), 'gpt-6.2-astra');
  assert.equal(normalizeInferenceModel('gpt-6.2-astra-xhigh'), 'gpt-6.2-astra-xhigh');
  assert.equal(getGPT56SolReasoningEffort('gpt-6.2-astra-xhigh'), 'xhigh');
  assert.equal(getGPT56SolReasoningEffort('gpt-6.2-astra-xhigh', 'high'), 'high');
  assert.equal(getProviderModelForInferenceModel('gpt-6.2-astra-xhigh'), 'gpt-6.2-astra');
});

test('normalizes Qwen 3.8 aliases to the canonical logical model', () => {
  for (const alias of [
    'QWEN3.8',
    'qwen3.8-max',
    'qwen-3.8-max',
    'Qwen 3.8',
    'Alibaba Cloud Qwen 3.8',
    'qwen/qwen3.8-max',
  ]) {
    assert.equal(normalizeInferenceModel(alias), QWEN_38_INFERENCE_MODEL);
    assert.equal(isQwenInferenceModel(alias), true);
  }
  assert.equal(getProviderModelForInferenceModel(QWEN_38_INFERENCE_MODEL), 'qwen3.8-max');
});

test('normalizes Kimi K3 aliases to the native provider model', () => {
  for (const alias of [
    'kimi-k3',
    'KIMIK3',
    'Kimi K3',
    'kimi-k3-latest',
    'Moonshot Kimi K3',
    'Moonshot K3',
  ]) {
    assert.equal(normalizeInferenceModel(alias), KIMI_K3_INFERENCE_MODEL);
    assert.equal(isKimiInferenceModel(alias), true);
  }
  assert.equal(getProviderModelForInferenceModel('Kimi K3'), 'kimi-k3');
});


test('upgrades saved GPT 5.6 selections to GPT 6.2 Astra without losing xhigh effort', () => {
  assert.equal(normalizeInferenceModel('gpt-5.6-sol'), 'gpt-6.2-astra');
  assert.equal(normalizeInferenceModel('gpt-5.6-sol-xhigh'), 'gpt-6.2-astra-xhigh');
});


test('migrates saved Astra selections to GPT 6.2 Astra and preserves explicit xhigh', () => {
  for (const alias of ['gpt-6.2-astra', 'GPT 6.2 Astra High', 'gpt-6-astra', 'GPT 6 Astra High']) {
    assert.equal(normalizeInferenceModel(alias), 'gpt-6.2-astra');
    assert.equal(getGPT56SolReasoningEffort(alias), 'high');
  }
  for (const alias of ['gpt-6.2-astra-xhigh', 'GPT 6.2 Astra Extra High', 'gpt-6-astra-xhigh', 'GPT 6 Astra Extra High']) {
    assert.equal(getGPT56SolReasoningEffort(alias), 'xhigh');
  }
});
