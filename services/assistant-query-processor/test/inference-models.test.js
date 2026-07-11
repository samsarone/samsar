import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_INFERENCE_MODEL,
  DEFAULT_GEMINI_31_PRO_VERTEX_MODEL,
  GEMINI_31_PRO_INFERENCE_MODEL,
  GPT_56_SOL_INFERENCE_MODEL,
  GPT_56_SOL_REASONING_EFFORT,
  getProviderModelForInferenceModel,
  normalizeGeminiProviderModel,
  normalizeInferenceModel,
} from '../src/InferenceModels.js';
import { calculateAssistantCreditsFromUsage } from '../src/AssistantBilling.js';
import { getAssistantReasoningEffort } from '../src/OpenAI.js';

test('defaults assistant inference to GPT 5.6 Sol', () => {
  assert.equal(GPT_56_SOL_INFERENCE_MODEL, 'gpt-5.6-sol');
  assert.equal(DEFAULT_INFERENCE_MODEL, GPT_56_SOL_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('GPT 5.6 Sol'), DEFAULT_INFERENCE_MODEL);
  assert.equal(getProviderModelForInferenceModel('gpt-5.6-sol'), 'gpt-5.6-sol');
  assert.equal(GPT_56_SOL_REASONING_EFFORT, 'xhigh');
  assert.equal(
    getAssistantReasoningEffort('gpt-5.6-sol', { reasoningEffort: 'low' }),
    'xhigh',
  );
});

test('keeps Gemini reasoning settings separate from the GPT 5.6 Sol default', () => {
  assert.equal(
    getAssistantReasoningEffort('gemini-3.1-pro', { reasoningEffort: 'medium' }),
    'medium',
  );
});

test('bills GPT 5.6 Sol usage at the configured model rates', () => {
  const result = calculateAssistantCreditsFromUsage({
    model: 'gpt-5.6-sol',
    usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
    pricingMultiplier: 1,
  });

  assert.equal(result.pricingModel, 'gpt-5.6-sol');
  assert.equal(result.costUsd, 35);
  assert.equal(result.credits, 3_500);
});

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
