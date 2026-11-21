import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAssistantRequestBilling } from './AssistantBilling.js';
import { ASSISTANT_MODEL_PRICES } from './constants/ModelPrices.js';

for (const pricingTimestampMs of [Date.UTC(2026, 10, 21), Date.UTC(2026, 11, 1)]) {
  test(`Neon retains its own tariff and counts cached input plus thinking at ${pricingTimestampMs}`, () => {
    const result = calculateAssistantRequestBilling({
      model: 'google/gemini-4-neon',
      usage: { google_usage_metadata: { promptTokenCount: 1000000,
        cachedContentTokenCount: 200000, candidatesTokenCount: 100000,
        thoughtsTokenCount: 400000, totalTokenCount: 1500000 } },
      samsarBilling: { adapter: 'google', region: 'global' },
    }, { pricingTimestampMs });
    assert.equal(result.pricingModel, 'gemini-4-neon');
    assert.equal(result.billable, true);
    assert.equal(result.costUsd, 9.93);
    assert.equal(result.credits, 1191.6);
    assert.equal(result.usage.outputTokens, 500000);
  });
}

test('Neon public price metadata agrees with token settlement', () => {
  const prices = ASSISTANT_MODEL_PRICES.find(item => item.key === 'gemini-4-neon');
  assert.equal(prices.billing, 'token_usage');
  assert.deepEqual(prices.prices.map(item => item.price), [360, 18, 1800]);
});


test('unknown model names cannot inherit the Neon tariff by prefix', () => {
  assert.throws(() => calculateAssistantRequestBilling({
    model: 'gemini-4-neonish', usage: { input_tokens: 1000000, output_tokens: 1000 },
  }), { code: 'ASSISTANT_BILLING_TARIFF_UNAVAILABLE' });
});
