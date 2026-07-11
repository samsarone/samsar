import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_INFERENCE_MODEL,
  DEFAULT_GEMINI_31_PRO_VERTEX_MODEL,
  GEMINI_31_PRO_INFERENCE_MODEL,
  GPT_56_SOL_REASONING_EFFORT,
  INFERENCE_MODEL_KEYS,
  INFERENCE_MODELS,
  INFERENCE_PROVIDER_MODEL_KEYS,
  INFERENCE_REASONING_EFFORTS,
  PUBLICATION_METADATA_INFERENCE_SETTINGS,
  getReasoningEffortForInferenceModel,
  getProviderModelForInferenceModel,
  isOpenAIInferenceModel,
  normalizeGeminiProviderModel,
  normalizeInferenceModel,
  normalizeOpenAIInferenceModel,
} from './InferenceModels.js';

test('defaults inference model to GPT 5.6 Sol', () => {
  assert.equal(INFERENCE_MODELS.Inference, 'gpt-5.6-sol');
  assert.equal(INFERENCE_MODEL_KEYS.GPT_56_SOL, 'gpt-5.6-sol');
  assert.equal(INFERENCE_PROVIDER_MODEL_KEYS[INFERENCE_MODEL_KEYS.GPT_56_SOL], 'gpt-5.6-sol');
  assert.equal(normalizeInferenceModel(), DEFAULT_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel(''), DEFAULT_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('gpt-5.6-sol'), DEFAULT_INFERENCE_MODEL);
  assert.equal(getProviderModelForInferenceModel('gpt-5.6-sol'), 'gpt-5.6-sol');
  assert.equal(GPT_56_SOL_REASONING_EFFORT, 'xhigh');
});

test('configures GPT 5.6 Luna with xhigh reasoning only for publication metadata', () => {
  assert.equal(INFERENCE_MODELS.PublicationMetadata, 'gpt-5.6-luna');
  assert.equal(INFERENCE_REASONING_EFFORTS.PublicationMetadata, 'xhigh');
  assert.deepEqual(PUBLICATION_METADATA_INFERENCE_SETTINGS, {
    model: 'gpt-5.6-luna',
    reasoning: { effort: 'xhigh' },
  });
  assert.equal(normalizeOpenAIInferenceModel('gpt-5.6-luna'), 'gpt-5.6-luna');
  assert.equal(getReasoningEffortForInferenceModel('gpt-5.6-luna'), 'xhigh');
  assert.equal(isOpenAIInferenceModel('gpt-5.6-luna'), true);

  // Luna is purpose-specific and is not exposed as a general user inference option.
  assert.equal(normalizeInferenceModel('gpt-5.6-luna'), DEFAULT_INFERENCE_MODEL);
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
