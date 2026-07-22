import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_INFERENCE_MODEL,
  DEFAULT_GEMINI_31_PRO_VERTEX_MODEL,
  GEMINI_31_PRO_INFERENCE_MODEL,
  GPT_56_SOL_INFERENCE_MODEL,
  GPT_56_SOL_REASONING_EFFORT,
  QWEN_37_INFERENCE_MODEL,
  QWEN_37_MAX_MODEL,
  QWEN_37_PLUS_MODEL,
  QWEN_38_MAX_PREVIEW_MODEL,
  getProviderModelForInferenceModel,
  isQwenInferenceModel,
  normalizeGeminiProviderModel,
  normalizeInferenceModel,
} from '../src/InferenceModels.js';
import {
  calculateAssistantCreditsFromUsage,
  DEFAULT_ASSISTANT_PRICING_MULTIPLIER,
} from '../src/AssistantBilling.js';
import { getAssistantReasoningEffort } from '../src/OpenAI.js';

test('defaults assistant inference to GPT 5.6 Sol', () => {
  assert.equal(GPT_56_SOL_INFERENCE_MODEL, 'gpt-5.6-sol');
  assert.equal(DEFAULT_INFERENCE_MODEL, GPT_56_SOL_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('GPT 5.6 Sol'), DEFAULT_INFERENCE_MODEL);
  assert.equal(getProviderModelForInferenceModel('gpt-5.6-sol'), 'gpt-5.6-sol');
  assert.equal(GPT_56_SOL_REASONING_EFFORT, 'high');
  assert.equal(
    getAssistantReasoningEffort('gpt-5.6-sol', { reasoningEffort: 'low' }),
    'high',
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
    usage: { input_tokens: 100_000, output_tokens: 100_000 },
    pricingMultiplier: 1,
  });

  assert.equal(result.pricingModel, 'gpt-5.6-sol');
  assert.equal(result.costUsd, 3.5);
  assert.equal(result.credits, 350);
});

test('bills GPT 5.6 Sol usage at long-context rates above 272K input tokens', () => {
  const result = calculateAssistantCreditsFromUsage({
    model: 'gpt-5.6-sol',
    usage: { input_tokens: 300_000, output_tokens: 100_000 },
    pricingMultiplier: 1,
  });

  assert.equal(result.costUsd, 7.5);
  assert.equal(result.credits, 750);
  assert.equal(result.tokenPricingUsdPerMillion.longContext, true);
  assert.equal(result.tokenPricingUsdPerMillion.longContextInputThreshold, 272_000);
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

test('normalizes Qwen 3.7 and 3.8 aliases while defaulting native inference to Plus', () => {
  assert.equal(normalizeInferenceModel('Qwen 3.7'), QWEN_37_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('qwen3.7-max'), QWEN_37_INFERENCE_MODEL);
  assert.equal(isQwenInferenceModel('qwen3.7-plus'), true);
  assert.equal(normalizeInferenceModel('qwen3.8-max-preview'), QWEN_37_INFERENCE_MODEL);
  assert.equal(QWEN_38_MAX_PREVIEW_MODEL, 'qwen3.8-max-preview');
  assert.equal(getProviderModelForInferenceModel('QWEN3.7'), QWEN_37_PLUS_MODEL);
  assert.equal(
    getProviderModelForInferenceModel('QWEN3.7', { vision: true }),
    QWEN_37_PLUS_MODEL,
  );
  assert.equal(getAssistantReasoningEffort('QWEN3.7'), null);
});

test('bills Qwen assistant usage with the configured credit conversion', () => {
  const max = calculateAssistantCreditsFromUsage({
    model: 'qwen3.7-max',
    usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
  });
  const plus = calculateAssistantCreditsFromUsage({
    model: 'qwen3.7-plus',
    usage: { input_tokens: 100_000, output_tokens: 100_000 },
  });

  assert.equal(DEFAULT_ASSISTANT_PRICING_MULTIPLIER, 1.5);
  assert.equal(max.credits, 1_500);
  assert.equal(plus.credits, 30);
});

test('bills Qwen cached tokens at regular input rates across Max and Plus tiers', () => {
  const max = calculateAssistantCreditsFromUsage({
    model: 'qwen3.7-max',
    usage: {
      input_tokens: 1_000_000,
      input_tokens_details: { cached_tokens: 1_000_000 },
      output_tokens: 0,
    },
  });
  const plusStandard = calculateAssistantCreditsFromUsage({
    model: 'qwen3.7-plus',
    usage: {
      input_tokens: 100_000,
      input_tokens_details: { cached_tokens: 100_000 },
      output_tokens: 100_000,
    },
  });
  const plusLongContext = calculateAssistantCreditsFromUsage({
    model: 'qwen3.7-plus',
    usage: {
      input_tokens: 300_000,
      input_tokens_details: { cached_tokens: 300_000 },
      output_tokens: 100_000,
    },
  });

  assert.equal(max.costUsd, 2.5);
  assert.equal(max.credits, 375);
  assert.equal(max.tokenPricingUsdPerMillion.cachedInput, 2.5);

  assert.equal(plusStandard.costUsd, 0.2);
  assert.equal(plusStandard.credits, 30);
  assert.equal(plusStandard.tokenPricingUsdPerMillion.cachedInput, 0.4);

  assert.equal(plusLongContext.costUsd, 0.84);
  assert.equal(plusLongContext.credits, 126);
  assert.equal(plusLongContext.tokenPricingUsdPerMillion.cachedInput, 1.2);
  assert.equal(plusLongContext.tokenPricingUsdPerMillion.longContext, true);
});
