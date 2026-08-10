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

test('uses high reasoning for GPT 5.6 Sol inference aliases', () => {
  assert.equal(GPT_56_SOL_REASONING_EFFORT, 'high');
  assert.equal(isGPT56SolInferenceModel('gpt-5.6-sol'), true);
  assert.equal(isGPT56SolInferenceModel('gpt-5.6'), true);
  assert.equal(isGPT56SolInferenceModel('gpt-4o-mini'), false);
  assert.equal(normalizeInferenceModel('gpt-5.6-sol-high'), 'gpt-5.6-sol');
  assert.equal(normalizeInferenceModel('gpt-5.6-sol-xhigh'), 'gpt-5.6-sol-xhigh');
  assert.equal(getGPT56SolReasoningEffort('gpt-5.6-sol-xhigh'), 'xhigh');
  assert.equal(getGPT56SolReasoningEffort('gpt-5.6-sol-xhigh', 'high'), 'high');
  assert.equal(getProviderModelForInferenceModel('gpt-5.6-sol-xhigh'), 'gpt-5.6-sol');
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
