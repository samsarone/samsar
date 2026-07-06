import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_INFERENCE_MODEL,
  DEFAULT_GEMINI_31_PRO_VERTEX_MODEL,
  GEMINI_31_PRO_INFERENCE_MODEL,
  INFERENCE_MODEL_KEYS,
  INFERENCE_PROVIDER_MODEL_KEYS,
  getProviderModelForInferenceModel,
  normalizeGeminiProviderModel,
  normalizeInferenceModel,
} from './InferenceModels.js';

test('defaults inference model to GPT 5.5', () => {
  assert.equal(INFERENCE_MODEL_KEYS.GPT_55, 'gpt-5.5');
  assert.equal(INFERENCE_PROVIDER_MODEL_KEYS[INFERENCE_MODEL_KEYS.GPT_55], 'gpt-5.5');
  assert.equal(normalizeInferenceModel(), DEFAULT_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel(''), DEFAULT_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('gpt-5.5'), DEFAULT_INFERENCE_MODEL);
  assert.equal(getProviderModelForInferenceModel('gpt-5.5'), 'gpt-5.5');
});

test('normalizes Gemini 3.1 Pro assistant model aliases to the current Vertex model', () => {
  assert.equal(INFERENCE_MODEL_KEYS.GEMINI_31_PRO, 'gemini-3.1-pro');
  assert.equal(
    INFERENCE_PROVIDER_MODEL_KEYS[INFERENCE_MODEL_KEYS.GEMINI_31_PRO],
    DEFAULT_GEMINI_31_PRO_VERTEX_MODEL,
  );
  assert.equal(normalizeInferenceModel('gemini-3.1-pro'), GEMINI_31_PRO_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('gemini-3.1-pro-preview'), GEMINI_31_PRO_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('gemini-3-pro'), GEMINI_31_PRO_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('gemini-3-pro-preview'), GEMINI_31_PRO_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('Gemini 3.1 Pro'), GEMINI_31_PRO_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('gemini31pro'), GEMINI_31_PRO_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('Google Gemini 3.1 Pro Preview'), GEMINI_31_PRO_INFERENCE_MODEL);

  assert.equal(getProviderModelForInferenceModel('gemini-3.1-pro'), DEFAULT_GEMINI_31_PRO_VERTEX_MODEL);
  assert.equal(normalizeGeminiProviderModel('gemini-3.1-pro-preview'), DEFAULT_GEMINI_31_PRO_VERTEX_MODEL);
  assert.equal(normalizeGeminiProviderModel('gemini-3-pro'), DEFAULT_GEMINI_31_PRO_VERTEX_MODEL);
  assert.equal(getProviderModelForInferenceModel('Gemini 3.1 Pro'), DEFAULT_GEMINI_31_PRO_VERTEX_MODEL);
});
