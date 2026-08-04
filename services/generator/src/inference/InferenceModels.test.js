import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_GEMINI_31_PRO_VERTEX_MODEL,
  GEMINI_31_PRO_INFERENCE_MODEL,
  GPT_56_SOL_REASONING_EFFORT,
  KIMI_K3_INFERENCE_MODEL,
  QWEN_38_INFERENCE_MODEL,
  isKimiInferenceModel,
  isQwenInferenceModel,
  getProviderModelForInferenceModel,
  normalizeGeminiProviderModel,
  normalizeInferenceModel,
} from './InferenceModels.js';

test('uses high reasoning for GPT 5.6 Sol inference', () => {
  assert.equal(GPT_56_SOL_REASONING_EFFORT, 'high');
});

test('normalizes Qwen 3.8 Max aliases to the logical provider choice', () => {
  for (const alias of [
    'QWEN3.8',
    'qwen3.8-max',
    'Qwen 3.8 Max',
    'Alibaba Cloud Qwen 3.8 Max',
    'DashScope Qwen 3.8 Max',
    'qwen/qwen3.8-max',
  ]) {
    assert.equal(normalizeInferenceModel(alias), QWEN_38_INFERENCE_MODEL);
    assert.equal(isQwenInferenceModel(alias), true);
  }
  assert.equal(getProviderModelForInferenceModel(QWEN_38_INFERENCE_MODEL), 'qwen3.8-max');
});

test('normalizes Gemini 3.1 Pro inference aliases to the canonical key', () => {
  assert.equal(normalizeInferenceModel('gemini-3.1-pro'), GEMINI_31_PRO_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('gemini-3.1-pro-preview'), GEMINI_31_PRO_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('gemini-3-pro'), GEMINI_31_PRO_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('Gemini 3.1 Pro'), GEMINI_31_PRO_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('gemini31pro'), GEMINI_31_PRO_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('Google Gemini 3.1 Pro Preview'), GEMINI_31_PRO_INFERENCE_MODEL);

  assert.equal(getProviderModelForInferenceModel('Gemini 3.1 Pro'), DEFAULT_GEMINI_31_PRO_VERTEX_MODEL);
  assert.equal(normalizeGeminiProviderModel('gemini31pro'), DEFAULT_GEMINI_31_PRO_VERTEX_MODEL);
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
