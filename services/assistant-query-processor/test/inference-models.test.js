import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_INFERENCE_MODEL,
  DEFAULT_GEMINI_4_CARBON_VERTEX_MODEL,
  GEMINI_4_CARBON_INFERENCE_MODEL,
  GPT_56_SOL_INFERENCE_MODEL,
  GPT_56_SOL_REASONING_EFFORT,
  KIMI_K3_INFERENCE_MODEL,
  KIMI_K3_PROVIDER_MODEL,
  QWEN_38_INFERENCE_MODEL,
  QWEN_38_MAX_MODEL,
  getProviderModelForInferenceModel,
  isKimiK3InferenceModel,
  isQwenInferenceModel,
  normalizeGeminiProviderModel,
  normalizeInferenceModel,
} from '../src/InferenceModels.js';
import {
  calculateAssistantCreditsFromUsage,
  DEFAULT_ASSISTANT_PRICING_MULTIPLIER,
} from '../src/AssistantBilling.js';
import { getAssistantReasoningEffort } from '../src/OpenAI.js';

test('defaults assistant inference to GPT 6 Astra', () => {
  assert.equal(GPT_56_SOL_INFERENCE_MODEL, 'gpt-6-astra');
  assert.equal(DEFAULT_INFERENCE_MODEL, GPT_56_SOL_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('GPT 6 Astra'), DEFAULT_INFERENCE_MODEL);
  assert.equal(getProviderModelForInferenceModel('gpt-6-astra'), 'gpt-6-astra');
  assert.equal(GPT_56_SOL_REASONING_EFFORT, 'high');
  assert.equal(
    getAssistantReasoningEffort('gpt-6-astra', { reasoningEffort: 'low' }),
    'high',
  );
});

test('keeps Gemini reasoning settings separate from the GPT 6 Astra default', () => {
  assert.equal(
    getAssistantReasoningEffort('gemini-4-carbon', {
      reasoningEffort: 'medium',
      effort: 'xhigh',
    }),
    'medium',
  );
});

test('bills GPT 6 Astra usage at the configured model rates', () => {
  const result = calculateAssistantCreditsFromUsage({
    model: 'gpt-6-astra',
    usage: { input_tokens: 100_000, output_tokens: 100_000 },
    pricingMultiplier: 1,
  });

  assert.equal(result.pricingModel, 'gpt-6-astra');
  assert.equal(result.costUsd, 6);
  assert.equal(result.credits, 600);
});

test('bills GPT 6 Astra usage at long-context rates above 272K input tokens', () => {
  const result = calculateAssistantCreditsFromUsage({
    model: 'gpt-6-astra',
    usage: { input_tokens: 300_000, output_tokens: 100_000 },
    pricingMultiplier: 1,
  });

  assert.equal(result.costUsd, 13.5);
  assert.equal(result.credits, 1350);
  assert.equal(result.tokenPricingUsdPerMillion.longContext, true);
  assert.equal(result.tokenPricingUsdPerMillion.longContextInputThreshold, 272_000);
});

test('normalizes Gemini 4 Carbon label to the assistant inference model', () => {
  assert.equal(normalizeInferenceModel('gemini-4-carbon'), GEMINI_4_CARBON_INFERENCE_MODEL);
  assert.equal(DEFAULT_GEMINI_4_CARBON_VERTEX_MODEL, 'gemini-4-carbon');
  assert.equal(getProviderModelForInferenceModel('gemini-4-carbon'), DEFAULT_GEMINI_4_CARBON_VERTEX_MODEL);
});

test('maps stale Gemini 3 provider aliases to the current Vertex model', () => {
  assert.equal(normalizeInferenceModel('gemini-4-carbon'), GEMINI_4_CARBON_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('gemini-4'), GEMINI_4_CARBON_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('gemini-4-carbon'), GEMINI_4_CARBON_INFERENCE_MODEL);

  assert.equal(normalizeGeminiProviderModel('gemini-4-carbon'), DEFAULT_GEMINI_4_CARBON_VERTEX_MODEL);
  assert.equal(normalizeGeminiProviderModel('gemini-4'), DEFAULT_GEMINI_4_CARBON_VERTEX_MODEL);
  assert.equal(normalizeGeminiProviderModel('gemini-4-carbon'), DEFAULT_GEMINI_4_CARBON_VERTEX_MODEL);
});

test('passes through explicit custom Gemini provider models', () => {
  assert.equal(
    getProviderModelForInferenceModel('gemini-4-carbon-custom'),
    'gemini-4-carbon-custom',
  );
});

test('uses the processor Gemini provider model for Gemini 4 Carbon even with stale env override', () => {
  const previousModel = process.env.GOOGLE_GEMINI_4_CARBON_MODEL;
  process.env.GOOGLE_GEMINI_4_CARBON_MODEL = 'gemini-4-carbon';
  try {
    assert.equal(getProviderModelForInferenceModel('gemini-4-carbon'), DEFAULT_GEMINI_4_CARBON_VERTEX_MODEL);
  } finally {
    if (previousModel === undefined) {
      delete process.env.GOOGLE_GEMINI_4_CARBON_MODEL;
    } else {
      process.env.GOOGLE_GEMINI_4_CARBON_MODEL = previousModel;
    }
  }
});

test('normalizes Qwen 3.8 aliases and uses Max for native text and vision', () => {
  assert.equal(normalizeInferenceModel('Qwen 3.8'), QWEN_38_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('qwen3.8-max'), QWEN_38_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('qwen/qwen3.8-max'), QWEN_38_INFERENCE_MODEL);
  assert.equal(isQwenInferenceModel('qwen3.8-max'), true);
  assert.equal(QWEN_38_MAX_MODEL, 'qwen3.8-max');
  assert.equal(getProviderModelForInferenceModel('QWEN3.8'), QWEN_38_MAX_MODEL);
  assert.equal(
    getProviderModelForInferenceModel('QWEN3.8', { vision: true }),
    QWEN_38_MAX_MODEL,
  );
  assert.equal(
    getProviderModelForInferenceModel('QWEN3.8', {
      env: {
        ALIBABA_QWEN_MODEL: 'qwen3.8-max-shared',
        ALIBABA_QWEN_TEXT_MODEL: 'ignored-text-model',
      },
    }),
    'qwen3.8-max-shared',
  );
  assert.equal(getAssistantReasoningEffort('QWEN3.8'), null);
});

test('normalizes Kimi K3 aliases and always uses high assistant reasoning', () => {
  assert.equal(normalizeInferenceModel('KIMIK3'), KIMI_K3_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('Moonshot K3'), KIMI_K3_INFERENCE_MODEL);
  assert.equal(isKimiK3InferenceModel('Kimi K3'), true);
  assert.equal(
    getProviderModelForInferenceModel('kimi-k3'),
    KIMI_K3_PROVIDER_MODEL,
  );
  assert.equal(
    getAssistantReasoningEffort('kimi-k3', { reasoningEffort: 'low' }),
    'high',
  );
});

test('bills Kimi K3 cached, uncached, and output tokens at native rates with 1.2x billing', () => {
  const result = calculateAssistantCreditsFromUsage({
    model: 'kimi-k3',
    usage: {
      prompt_tokens: 1_000_000,
      prompt_tokens_details: { cached_tokens: 200_000 },
      completion_tokens: 100_000,
    },
  });

  assert.equal(result.pricingModel, 'kimi-k3');
  assert.equal(result.costUsd, 3.96);
  assert.equal(result.credits, 475.2);
  assert.deepEqual(result.tokenPricingUsdPerMillion, {
    input: 3,
    cachedInput: 0.3,
    output: 15,
  });
  assert.equal(result.pricingMultiplier, DEFAULT_ASSISTANT_PRICING_MULTIPLIER);
});

test('bills Qwen assistant usage with the configured credit conversion', () => {
  const result = calculateAssistantCreditsFromUsage({
    model: 'qwen/qwen3.8-max',
    usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
  });

  assert.equal(DEFAULT_ASSISTANT_PRICING_MULTIPLIER, 1.2);
  assert.equal(result.pricingModel, 'qwen3.8-max');
  assert.equal(result.credits, 960);
});

test('bills Qwen 3.8 Max cached tokens at the discounted input rate', () => {
  const result = calculateAssistantCreditsFromUsage({
    model: 'qwen3.8-max',
    usage: {
      input_tokens: 1_000_000,
      input_tokens_details: { cached_tokens: 1_000_000 },
      output_tokens: 0,
    },
  });
  assert.equal(result.costUsd, 0.25);
  assert.equal(result.credits, 30);
  assert.equal(result.tokenPricingUsdPerMillion.cachedInput, 0.25);
});


test('migrates saved Astra selections to GPT 6 Astra and preserves explicit xhigh', () => {
  for (const alias of ['gpt-6-astra', 'GPT 6 Astra High', 'gpt-6-astra', 'GPT 6 Astra High']) {
    assert.equal(normalizeInferenceModel(alias), 'gpt-6-astra');
    assert.equal(getAssistantReasoningEffort(alias), 'high');
  }
  for (const alias of ['gpt-6-astra-xhigh', 'GPT 6 Astra Extra High', 'gpt-6-astra-xhigh']) {
    assert.equal(getAssistantReasoningEffort(alias), 'xhigh');
  }
});
