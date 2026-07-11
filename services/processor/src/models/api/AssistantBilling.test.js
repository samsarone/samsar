import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateAssistantCreditsFromUsage } from './AssistantBilling.js';

test('bills GPT 5.6 Sol assistant usage at standard context rates', () => {
  const result = calculateAssistantCreditsFromUsage({
    model: 'gpt-5.6-sol',
    usage: { input_tokens: 100_000, output_tokens: 100_000 },
    pricingMultiplier: 1,
  });

  assert.equal(result.pricingModel, 'gpt-5.6-sol');
  assert.equal(result.costUsd, 3.5);
  assert.equal(result.credits, 350);
  assert.deepEqual(result.tokenPricingUsdPerMillion, {
    input: 5,
    cachedInput: 0.5,
    output: 30,
  });
});

test('bills GPT 5.6 Sol assistant usage at long-context rates above 272K input tokens', () => {
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
