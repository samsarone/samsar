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

test('bills GPT 5.6 Luna metadata usage with the standard 50 percent markup', () => {
  const result = calculateAssistantCreditsFromUsage({
    model: 'gpt-5.6-luna',
    usage: {
      input_tokens: 100_000,
      input_tokens_details: { cached_tokens: 20_000 },
      output_tokens: 10_000,
    },
  });

  assert.equal(result.pricingModel, 'gpt-5.6-luna');
  assert.equal(result.costUsd, 0.142);
  assert.equal(result.credits, 21.3);
  assert.equal(result.pricingMultiplier, 1.5);
  assert.deepEqual(result.tokenPricingUsdPerMillion, {
    input: 1,
    cachedInput: 0.1,
    output: 6,
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

test('bills Qwen 3.8 Max usage at the Max rate', () => {
  const result = calculateAssistantCreditsFromUsage({
    model: 'qwen3.8-max',
    usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
  });

  assert.equal(DEFAULT_ASSISTANT_PRICING_MULTIPLIER, 1.5);
  assert.equal(result.pricingModel, 'qwen3.8-max');
  assert.equal(result.costUsd, 10);
  assert.equal(result.credits, 1_500);
  assert.deepEqual(result.tokenPricingUsdPerMillion, {
    input: 2.5,
    cachedInput: 2.5,
    output: 7.5,
  });
});

test('bills Qwen 3.8 Max cached tokens at the regular input rate', () => {
  const result = calculateAssistantCreditsFromUsage({
    model: 'qwen3.8-max',
    usage: {
      input_tokens: 1_000_000,
      input_tokens_details: { cached_tokens: 1_000_000 },
      output_tokens: 0,
    },
  });

  assert.equal(result.costUsd, 2.5);
  assert.equal(result.credits, 375);
  assert.equal(result.tokenPricingUsdPerMillion.cachedInput, 2.5);
});

test('prices provider-qualified OpenRouter model identifiers', () => {
  const gpt = calculateAssistantCreditsFromUsage({
    model: 'openai/gpt-5.6-sol',
    usage: { input_tokens: 1_000, output_tokens: 100 },
    pricingMultiplier: 1,
  });
  const gemini = calculateAssistantCreditsFromUsage({
    model: 'google/gemini-3.1-pro-preview',
    usage: { input_tokens: 1_000, output_tokens: 100 },
    pricingMultiplier: 1,
  });
  const qwen = calculateAssistantCreditsFromUsage({
    model: 'qwen/qwen3.8-max',
    usage: { input_tokens: 1_000, output_tokens: 100 },
    pricingMultiplier: 1,
  });

  assert.equal(gpt.pricingModel, 'gpt-5.6-sol');
  assert.equal(gemini.pricingModel, 'gemini-3.1-pro');
  assert.equal(qwen.pricingModel, 'qwen3.8-max');
  assert.ok(gpt.credits > 0);
  assert.ok(gemini.credits > 0);
  assert.ok(qwen.credits > 0);
});

test('does not silently price an unknown Gemini deployment as Gemini 3.1 Pro', () => {
  const result = calculateAssistantCreditsFromUsage({
    model: 'google/gemini-2.5-flash',
    usage: { input_tokens: 1000, output_tokens: 100 },
    pricingMultiplier: 1,
  });

  assert.equal(result.pricingModel, null);
  assert.equal(result.costUsd, 0);
  assert.equal(result.credits, 0);
});

test('bills Kimi K3 cached, uncached, and reasoning-inclusive output at 1.5x native cost', () => {
  const result = calculateAssistantCreditsFromUsage({
    model: 'kimi-k3',
    usage: {
      prompt_tokens: 1_000_000,
      prompt_tokens_details: { cached_tokens: 200_000 },
      completion_tokens: 100_000,
      completion_tokens_details: { reasoning_tokens: 60_000 },
    },
  });

  assert.equal(DEFAULT_ASSISTANT_PRICING_MULTIPLIER, 1.5);
  assert.equal(result.pricingModel, 'kimi-k3');
  assert.equal(result.costUsd, 3.96);
  assert.equal(result.credits, 594);
  assert.deepEqual(result.tokenPricingUsdPerMillion, {
    input: 3,
    cachedInput: 0.3,
    output: 15,
  });
  assert.equal(result.usage.reasoningTokens, 60_000);
});
