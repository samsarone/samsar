import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAssistantCreditsFromUsage, calculateAssistantRequestBilling } from './AssistantBilling.js';

for (const model of ['gpt-6.2-astra', 'openai/gpt-6.2-astra', 'gpt-6.2-astra-high', 'gpt-6.2-astra-xhigh']) {
  test(`${model}: assistant uses the Astra 6.2 tariff with one twenty percent markup`, () => {
    const result = calculateAssistantRequestBilling({ model, usage: {
      input_tokens: 100_000, input_tokens_details: { cached_tokens: 20_000 }, output_tokens: 10_000,
      cost: 999,
    }, samsarBilling: { adapter: 'openrouter', costUsd: 999 } });
    assert.equal(result.pricingModel, 'gpt-6.2-astra');
    assert.equal(result.costUsd, 1.048);
    assert.equal(result.pricingMultiplier, 1.2);
    assert.equal(result.credits, 125.76);
    assert.deepEqual(result.tokenPricingUsdPerMillion, { input: 8, cachedInput: 0.4, output: 40 });
  });
}

test('Astra 6.2 long context applies above 272K input tokens to the full request', () => {
  const boundary = calculateAssistantCreditsFromUsage({ model: 'gpt-6.2-astra', usage: {
    input_tokens: 272_000, output_tokens: 0,
  } });
  assert.equal(boundary.costUsd, 2.176);
  assert.equal(boundary.tokenPricingUsdPerMillion.longContext, undefined);
  const long = calculateAssistantCreditsFromUsage({ model: 'gpt-6.2-astra-xhigh', usage: {
    input_tokens: 300_000, input_tokens_details: { cached_tokens: 100_000 }, output_tokens: 100_000,
  } });
  assert.equal(long.costUsd, 9.28);
  assert.equal(long.credits, 1113.6);
  assert.equal(long.tokenPricingUsdPerMillion.longContext, true);
  assert.equal(long.tokenPricingUsdPerMillion.longContextInputThreshold, 272_000);
});

test('Astra 6.2 cache writes use base and long-context rates with the same markup', () => {
  const result = calculateAssistantCreditsFromUsage({ model: 'gpt-6.2-astra', usage: {
    input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 100_000,
  } });
  assert.equal(result.costUsd, 1);
  assert.equal(result.credits, 120);
  const long = calculateAssistantCreditsFromUsage({ model: 'gpt-6.2-astra', usage: {
    input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 300_000,
    cache_creation: { ephemeral_1h_input_tokens: 100_000 },
  } });
  assert.equal(long.costUsd, 8);
  assert.equal(long.credits, 960);
});

test('historical Astra and Sol receipts retain their original tariffs', () => {
  for (const [model, expected] of [['gpt-6-astra', 6], ['openai/gpt-6-astra-xhigh', 6],
    ['gpt-5.6-sol', 3.5], ['gpt-6.1-sol', 1.2]]) {
    const result = calculateAssistantCreditsFromUsage({ model, usage: {
      input_tokens: 100_000, output_tokens: 100_000,
    }, pricingMultiplier: 1 });
    assert.equal(result.costUsd, expected, model);
  }
});

test('published Astra 6.2 assistant prices match standard token tariffs with twenty percent markup', async () => {
  const { ASSISTANT_MODEL_PRICES } = await import('./constants/ModelPrices.js');
  const row = ASSISTANT_MODEL_PRICES.find(item => item.key === 'gpt-6.2-astra');
  assert.equal(row.billing, 'token_usage');
  assert.deepEqual(row.prices, [
    { operationType: 'input_tokens', tokens: 1_000_000, price: 960 },
    { operationType: 'cached_input_tokens', tokens: 1_000_000, price: 48 },
    { operationType: 'output_tokens', tokens: 1_000_000, price: 4800 },
  ]);
});
