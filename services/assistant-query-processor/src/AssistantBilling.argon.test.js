import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateAssistantCreditsFromUsage } from './AssistantBilling.js';

test('Carbon provider receipts use published global rates across December 1 UTC without a long-context surcharge', () => {
  const usage = {
    input_tokens: 300_000,
    input_tokens_details: { cached_tokens: 100_000 },
    output_tokens: 200_000,
  };
  const before = calculateAssistantCreditsFromUsage({
    model: 'google/gemini-4-carbon', usage, pricingMultiplier: 1,
    pricingTimestampMs: Date.UTC(2026, 10, 30, 23, 59, 59, 999),
  });
  const after = calculateAssistantCreditsFromUsage({
    model: 'gemini-4-carbon-20261110', usage, pricingMultiplier: 1,
    pricingTimestampMs: Date.UTC(2026, 11, 1),
  });

  assert.equal(before.pricingModel, 'gemini-4-carbon');
  assert.deepEqual(before.tokenPricingUsdPerMillion, { input: 2, cachedInput: 0.1, output: 10 });
  assert.equal(before.costUsd, 2.41);
  assert.equal(before.credits, 241);
  assert.deepEqual(after.tokenPricingUsdPerMillion, { input: 4, cachedInput: 0.2, output: 20 });
  assert.equal(after.costUsd, 4.82);
  assert.equal(after.credits, 482);
});

test('historical Gemini receipts keep their separate long-context pricing', () => {
  const result = calculateAssistantCreditsFromUsage({
    model: 'gemini-3.1-pro-preview',
    usage: { input_tokens: 300_000, output_tokens: 100_000 },
    pricingMultiplier: 1,
    pricingTimestampMs: Date.UTC(2026, 11, 1),
  });

  assert.equal(result.pricingModel, 'gemini-3.1-pro');
  assert.deepEqual(result.tokenPricingUsdPerMillion, {
    input: 4, cachedInput: 0.4, output: 18,
    longContext: true, longContextInputThreshold: 200_000,
  });
  assert.equal(result.costUsd, 3);
});
