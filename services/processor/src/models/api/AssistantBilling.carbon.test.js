import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateAssistantRequestBilling,
  normalizeAssistantResponseUsage,
} from './AssistantBilling.js';

const usageMetadata = {
  promptTokenCount: 1_000_000,
  cachedContentTokenCount: 200_000,
  candidatesTokenCount: 100_000,
  thoughtsTokenCount: 400_000,
  totalTokenCount: 1_500_000,
};
const promotion = Date.UTC(2026, 10, 30, 23, 59, 59, 999);
const standard = Date.UTC(2026, 11, 1);

for (const [name, usage] of [
  ['native', { google_usage_metadata: usageMetadata }],
  ['normalized twice', normalizeAssistantResponseUsage(normalizeAssistantResponseUsage({ google_usage_metadata: usageMetadata }))],
  ['OpenRouter streaming receipt', {
    prompt_tokens: 1_000_000,
    prompt_tokens_details: { cached_tokens: 200_000 },
    completion_tokens: 500_000,
    completion_tokens_details: { reasoning_tokens: 400_000 },
    cost: 999,
  }],
  ['native total-only receipt', { google_usage_metadata: { ...usageMetadata, candidatesTokenCount: undefined } }],
]) {
  for (const [pricingTimestampMs, expectedCost, expectedCredits] of [
    [promotion, 6.62, 794.4],
    [standard, 13.24, 1588.8],
  ]) {
    test(`Carbon ${name}: cached input and thinking receive exactly 20% markup at ${pricingTimestampMs}`, () => {
      const result = calculateAssistantRequestBilling({
        model: 'google/gemini-4-carbon', usage,
        samsarBilling: { adapter: 'google', region: 'global' },
      }, { pricingTimestampMs, pricingMultiplier: 99 });
      assert.equal(result.pricingModel, 'gemini-4-carbon');
      assert.equal(result.costUsd, expectedCost);
      assert.equal(result.credits, expectedCredits);
      assert.equal(result.pricingMultiplier, 1.2);
      assert.equal(result.usage.outputTokens, 500_000);
    });
  }
}

test('Carbon regional requests include the Google regional rate before applying markup', () => {
  const result = calculateAssistantRequestBilling({
    model: 'gemini-4-carbon', usage: { google_usage_metadata: usageMetadata },
    samsarBilling: { adapter: 'google', region: 'eu' },
  }, { pricingTimestampMs: promotion });
  assert.equal(result.costUsd, 7.282);
  assert.equal(result.credits, 873.84);
});

test('historical Argon billing receipts retain their own pricing identity', () => {
  const result = calculateAssistantRequestBilling({
    model: 'google/gemini-4-argon', usage: { google_usage_metadata: usageMetadata },
  }, { pricingTimestampMs: promotion });
  assert.equal(result.pricingModel, 'gemini-4-argon');
  assert.equal(result.costUsd, 6.62);
  assert.equal(result.credits, 794.4);
});


test('public Carbon price metadata matches settlement on both sides of December 1', async (t) => {
  const { ASSISTANT_MODEL_PRICES } = await import('../../consts/ModelPrices.js');
  const model = ASSISTANT_MODEL_PRICES.find(item => item.key === 'gemini-4-carbon');
  assert.equal(model.billing, 'token_usage');
  for (const [now, prices] of [[promotion, [240, 12, 1200]], [standard, [480, 24, 2400]]]) {
    const clock = t.mock.method(Date, 'now', () => now);
    assert.deepEqual(model.prices.map(item => item.price), prices);
    assert.deepEqual(model.prices.map(item => item.operationType), ['input_tokens', 'cached_input_tokens', 'output_tokens']);
    assert.ok(model.prices.every(item => item.tokens === 1_000_000));
    clock.mock.restore();
  }
});
