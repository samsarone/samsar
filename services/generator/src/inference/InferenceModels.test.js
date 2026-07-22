import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_GEMINI_31_PRO_VERTEX_MODEL,
  GEMINI_31_PRO_INFERENCE_MODEL,
  GPT_56_SOL_REASONING_EFFORT,
  QWEN_37_INFERENCE_MODEL,
  isQwenInferenceModel,
  getProviderModelForInferenceModel,
  normalizeGeminiProviderModel,
  normalizeInferenceModel,
} from './InferenceModels.js';

test('uses high reasoning for GPT 5.6 Sol inference', () => {
  assert.equal(GPT_56_SOL_REASONING_EFFORT, 'high');
});

test('normalizes Qwen 3.7 aliases to the logical provider choice', () => {
  for (const alias of [
    'QWEN3.7',
    'qwen3.7-max',
    'qwen3.7-plus',
    'Qwen 3.7',
    'Alibaba Cloud Qwen 3.7',
    'qwen3.8-max-preview',
  ]) {
    assert.equal(normalizeInferenceModel(alias), QWEN_37_INFERENCE_MODEL);
    assert.equal(isQwenInferenceModel(alias), true);
  }
  assert.equal(getProviderModelForInferenceModel(QWEN_37_INFERENCE_MODEL), 'qwen3.7-max');
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
