import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateAssistantCreditsFromUsage,
  DEFAULT_ASSISTANT_PRICING_MULTIPLIER,
} from './AssistantBilling.js';

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

test('uses the requested assistant pricing and bills Qwen 3.7 Max usage', () => {
  const result = calculateAssistantCreditsFromUsage({
    model: 'qwen3.7-max',
    usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
  });

  assert.equal(DEFAULT_ASSISTANT_PRICING_MULTIPLIER, 1.5);
  assert.equal(result.pricingModel, 'qwen3.7-max');
  assert.equal(result.costUsd, 10);
  assert.equal(result.credits, 1_500);
  assert.deepEqual(result.tokenPricingUsdPerMillion, {
    input: 2.5,
    cachedInput: 2.5,
    output: 7.5,
  });
});

test('bills Qwen 3.7 Plus vision usage at standard and long-context rates', () => {
  const standard = calculateAssistantCreditsFromUsage({
    model: 'qwen3.7-plus',
    usage: { input_tokens: 100_000, output_tokens: 100_000 },
  });
  const longContext = calculateAssistantCreditsFromUsage({
    model: 'qwen3.7-plus',
    usage: { input_tokens: 300_000, output_tokens: 100_000 },
  });

  assert.equal(standard.costUsd, 0.2);
  assert.equal(standard.credits, 30);
  assert.equal(longContext.costUsd, 0.84);
  assert.equal(longContext.credits, 126);
  assert.equal(longContext.tokenPricingUsdPerMillion.longContext, true);
  assert.equal(longContext.tokenPricingUsdPerMillion.longContextInputThreshold, 256_000);
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
