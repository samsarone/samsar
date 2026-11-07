import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpenRouterChatCompletion, shouldUseSamsarExternalInference,
  unwrapSamsarExternalChatCompletionResponse } from './SamsarExternalInferenceAdapter.js';
import { calculateAssistantRequestBilling } from '../api/AssistantBilling.js';

for (const [model, credits] of [['gpt-6-astra', 0.951], ['gemini-4-argon', 0.1776], ['qwen3.8-max', 0.147], ['claude-opus-5.5', 0.3612]]) {
  test(`OpenRouter ${model} retains reported costs for audit and prices measured cache usage at the fixed tariff`, async () => {
    const response = await createOpenRouterChatCompletion({ model, maxRetries: 0,
      messages: [{ role: 'user', content: 'Hello' }], assistantBillingRequestId: 'request' }, {
      openRouterClient: { chat: { completions: { create: async (payload, options) => {
        assert.equal(payload.assistantBillingRequestId, undefined);
        assert.equal(options.maxRetries, 0);
        return { model, choices: [], usage: { cost: 0.0325, prompt_tokens: 1000,
          prompt_tokens_details: { cached_tokens: 800, cache_write_tokens: 50 },
          completion_tokens: 100, completion_tokens_details: { reasoning_tokens: 80 } } };
      } } } },
    });
    assert.equal(response.samsarBilling.costUsd, 0.0325);
    assert.equal(response.usage.prompt_tokens_details.cached_tokens, 800);
    assert.equal(calculateAssistantRequestBilling(response, { pricingTimestampMs: Date.UTC(2026, 10, 7) }).credits, credits);
  });
}

test('the public assistant routing bypass permits an explicit third-party adapter and prevents Samsar recursion', () => {
  assert.equal(shouldUseSamsarExternalInference({ model: 'gpt-6-astra', authorization: 'openrouter',
    bypassSamsarExternalInference: true, assistantBillingRequestId: 'request' }), true);
  assert.equal(shouldUseSamsarExternalInference({ model: 'gpt-6-astra', authorization: 'openrouter',
    bypassSamsarExternalInference: true }), false);
  assert.equal(shouldUseSamsarExternalInference({ model: 'gpt-6-astra', authorization: 'deployed',
    bypassSamsarExternalInference: true }), false);
});

test('Samsar SDK envelopes preserve audit cost but never apply another markup to a hosted charge', () => {
  const completion = { id: 'chat', model: 'gpt-6-astra', choices: [], usage: { prompt_tokens: 1000, completion_tokens: 100 } };
  for (const envelope of [
    { data: completion, headers: { 'x-credits-charged': '3.25' } },
    { data: { response: completion, creditsCharged: 3.25 } },
    { response: completion, creditsCharged: 3.25 },
  ]) {
    assert.equal(calculateAssistantRequestBilling(unwrapSamsarExternalChatCompletionResponse(envelope)).credits, 1.8);
  }
  assert.equal(calculateAssistantRequestBilling(unwrapSamsarExternalChatCompletionResponse({
    data: { ...completion, usage: { prompt_tokens: 0, completion_tokens: 0 } },
    headers: { 'x-credits-charged': '999' },
  })).credits, 0);
});
