import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_GEMINI_31_PRO_VERTEX_MODEL,
  GEMINI_31_PRO_INFERENCE_MODEL,
  getProviderModelForInferenceModel,
  normalizeGeminiProviderModel,
  normalizeInferenceModel,
} from '../src/InferenceModels.js';

test('normalizes Gemini 3.1 Pro label to the assistant inference model', () => {
  assert.equal(normalizeInferenceModel('gemini-3.1-pro'), GEMINI_31_PRO_INFERENCE_MODEL);
  assert.equal(DEFAULT_GEMINI_31_PRO_VERTEX_MODEL, 'gemini-3.1-pro-preview');
  assert.equal(getProviderModelForInferenceModel('gemini-3.1-pro'), DEFAULT_GEMINI_31_PRO_VERTEX_MODEL);
});

test('maps stale Gemini 3 provider aliases to the current Vertex model', () => {
  assert.equal(normalizeInferenceModel('gemini-3.1-pro-preview'), GEMINI_31_PRO_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('gemini-3-pro'), GEMINI_31_PRO_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('gemini-3-pro-preview'), GEMINI_31_PRO_INFERENCE_MODEL);

  assert.equal(normalizeGeminiProviderModel('gemini-3.1-pro-preview'), DEFAULT_GEMINI_31_PRO_VERTEX_MODEL);
  assert.equal(normalizeGeminiProviderModel('gemini-3-pro'), DEFAULT_GEMINI_31_PRO_VERTEX_MODEL);
  assert.equal(normalizeGeminiProviderModel('gemini-3-pro-preview'), DEFAULT_GEMINI_31_PRO_VERTEX_MODEL);
});

test('passes through explicit custom Gemini provider models', () => {
  assert.equal(
    getProviderModelForInferenceModel('gemini-3.1-pro-preview-custom'),
    'gemini-3.1-pro-preview-custom',
  );
});

test('uses the processor Gemini provider model for Gemini 3.1 Pro even with stale env override', () => {
  const previousModel = process.env.GOOGLE_GEMINI_31_PRO_MODEL;
  process.env.GOOGLE_GEMINI_31_PRO_MODEL = 'gemini-3.1-pro';
  try {
    assert.equal(getProviderModelForInferenceModel('gemini-3.1-pro'), DEFAULT_GEMINI_31_PRO_VERTEX_MODEL);
  } finally {
    if (previousModel === undefined) {
      delete process.env.GOOGLE_GEMINI_31_PRO_MODEL;
    } else {
      process.env.GOOGLE_GEMINI_31_PRO_MODEL = previousModel;
    }
  }
});
