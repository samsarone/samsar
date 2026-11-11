import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateAssistantCreditsFromUsage,
  DEFAULT_ASSISTANT_PRICING_MULTIPLIER,
} from './AssistantBilling.js';

test('Claude assistant usage uses its configured model price for native and OpenRouter IDs', () => {
  for (const model of ['claude-opus-5.5', 'claude-opus-5-5', 'anthropic/claude-opus-5.5']) {
    const result = calculateAssistantCreditsFromUsage({
      model,
      usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
    });
    assert.equal(result.pricingModel, 'claude-opus-5.5');
    assert.equal(result.pricingMultiplier, 1.2);
    assert.equal(result.costUsd, 24);
    assert.equal(result.credits, 2880);
  }
});

test('bills GPT 6.1 Sol assistant usage at standard context rates', () => {
  const result = calculateAssistantCreditsFromUsage({
    model: 'gpt-6.1-sol',
    usage: { input_tokens: 100_000, output_tokens: 100_000 },
    pricingMultiplier: 1,
  });

  assert.equal(result.pricingModel, 'gpt-6.1-sol');
  assert.equal(result.costUsd, 1.2);
  assert.equal(result.credits, 120);
  assert.deepEqual(result.tokenPricingUsdPerMillion, {
    input: 2,
    cachedInput: 0.1,
    output: 10,
  });
});

test('bills GPT 5.6 Luna metadata usage with the standard 20 percent markup', () => {
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
  assert.equal(result.credits, 17.04);
  assert.equal(result.pricingMultiplier, 1.2);
  assert.deepEqual(result.tokenPricingUsdPerMillion, {
    input: 1,
    cachedInput: 0.1,
    output: 6,
  });
});

test('bills GPT 6.1 Sol assistant usage at long-context rates above 272K input tokens', () => {
  const result = calculateAssistantCreditsFromUsage({
    model: 'gpt-6.1-sol',
    usage: { input_tokens: 300_000, output_tokens: 100_000 },
    pricingMultiplier: 1,
  });

  assert.equal(result.costUsd, 2.7);
  assert.equal(result.credits, 270);
  assert.equal(result.tokenPricingUsdPerMillion.longContext, true);
  assert.equal(result.tokenPricingUsdPerMillion.longContextInputThreshold, 272_000);
});

test('bills Qwen 3.8 Max usage at the Max rate', () => {
  const result = calculateAssistantCreditsFromUsage({
    model: 'qwen3.8-max',
    usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
  });

  assert.equal(DEFAULT_ASSISTANT_PRICING_MULTIPLIER, 1.2);
  assert.equal(result.pricingModel, 'qwen3.8-max');
  assert.equal(result.costUsd, 8);
  assert.equal(result.credits, 960);
  assert.deepEqual(result.tokenPricingUsdPerMillion, {
    input: 2,
    cachedInput: 0.25,
    output: 6,
  });
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

test('prices provider-qualified OpenRouter model identifiers', () => {
  const gpt = calculateAssistantCreditsFromUsage({
    model: 'openai/gpt-6.1-sol',
    usage: { input_tokens: 1_000, output_tokens: 100 },
    pricingMultiplier: 1,
  });
  const gemini = calculateAssistantCreditsFromUsage({
    model: 'google/gemini-4-carbon',
    usage: { input_tokens: 1_000, output_tokens: 100 },
    pricingMultiplier: 1,
  });
  const qwen = calculateAssistantCreditsFromUsage({
    model: 'qwen/qwen3.8-max',
    usage: { input_tokens: 1_000, output_tokens: 100 },
    pricingMultiplier: 1,
  });

  assert.equal(gpt.pricingModel, 'gpt-6.1-sol');
  assert.equal(gemini.pricingModel, 'gemini-4-carbon');
  assert.equal(qwen.pricingModel, 'qwen3.8-max');
  assert.ok(gpt.credits > 0);
  assert.ok(gemini.credits > 0);
  assert.ok(qwen.credits > 0);
});

test('does not silently price an unknown Gemini deployment as Gemini 4 Carbon', () => {
  const result = calculateAssistantCreditsFromUsage({
    model: 'google/gemini-2.5-flash',
    usage: { input_tokens: 1000, output_tokens: 100 },
    pricingMultiplier: 1,
  });

  assert.equal(result.pricingModel, null);
  assert.equal(result.costUsd, 0);
  assert.equal(result.credits, 0);
});

test('versioned and provider-qualified Carbon receipts use Gemini 4 billing', () => {
  for (const model of ['gemini-4-carbon-20261110', 'google/gemini-4-carbon']) {
    const result = calculateAssistantCreditsFromUsage({
      model, usage: { input_tokens: 1000, output_tokens: 100 }, pricingMultiplier: 1,
      pricingTimestampMs: Date.UTC(2026, 10, 30),
    });
    assert.equal(result.pricingModel, 'gemini-4-carbon');
    assert.ok(result.credits > 0);
  }
});

test('Carbon billing uses published global rates across the December 1 UTC boundary without a long-context surcharge', () => {
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
    model: 'google/gemini-4-carbon', usage, pricingMultiplier: 1,
    pricingTimestampMs: Date.UTC(2026, 11, 1),
  });

  assert.deepEqual(before.tokenPricingUsdPerMillion, { input: 2, cachedInput: 0.1, output: 10 });
  assert.equal(before.costUsd, 2.41);
  assert.equal(before.credits, 241);
  assert.deepEqual(after.tokenPricingUsdPerMillion, { input: 4, cachedInput: 0.2, output: 20 });
  assert.equal(after.costUsd, 4.82);
  assert.equal(after.credits, 482);
});

test('historical Gemini 3.1 receipts retain their separate long-context rates', () => {
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

test('bills Kimi K3 cached, uncached, and reasoning-inclusive output at 1.2x native cost', () => {
  const result = calculateAssistantCreditsFromUsage({
    model: 'kimi-k3',
    usage: {
      prompt_tokens: 1_000_000,
      prompt_tokens_details: { cached_tokens: 200_000 },
      completion_tokens: 100_000,
      completion_tokens_details: { reasoning_tokens: 60_000 },
    },
  });

  assert.equal(DEFAULT_ASSISTANT_PRICING_MULTIPLIER, 1.2);
  assert.equal(result.pricingModel, 'kimi-k3');
  assert.equal(result.costUsd, 3.96);
  assert.equal(result.credits, 475.2);
  assert.deepEqual(result.tokenPricingUsdPerMillion, {
    input: 3,
    cachedInput: 0.3,
    output: 15,
  });
  assert.equal(result.usage.reasoningTokens, 60_000);
});
