import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAssistantCreditsFromUsage, normalizeAssistantResponseUsage } from './AssistantBilling.js';

for (const [model, expectedCost] of [
  ['gpt-6-astra', 0.15], ['gpt-6.1-sol', 0.03], ['google/gemini-4-carbon', 0.03],
  ['qwen/qwen3.8-max', 0.026], ['moonshotai/kimi-k3', 0.045], ['anthropic/claude-opus-5.5', 0.06],
]) {
  test(`${model}: assistant charge is exactly 120% of the checked-in token tariff`, () => {
    const result = calculateAssistantCreditsFromUsage({ model,
      usage: { prompt_tokens: 10000, completion_tokens: 1000, cost: 999 }, adapter: 'openrouter' });
    assert.equal(result.costUsd, expectedCost);
    assert.equal(result.pricingMultiplier, 1.2);
    assert.equal(result.credits, Math.round(expectedCost * 120 * 10000) / 10000);
    assert.equal(result.costSource, 'token_tariff');
  });
}

test('explicit zero token usage remains free instead of falling back to word billing', () => {
  const result = calculateAssistantCreditsFromUsage({ model: 'gpt-6-astra',
    usage: { input_tokens: 0, output_tokens: 0, cost: 999 }, adapter: 'openrouter' });
  assert.equal(result.credits, 0);
  assert.equal(result.billable, true);
});

test('native Claude token receipts separate ordinary input, cache reads and writes', () => {
  const result = calculateAssistantCreditsFromUsage({
    model: 'claude-opus-5-5',
    usage: { input_tokens: 1000, cache_read_input_tokens: 2000,
      cache_creation_input_tokens: 1000, output_tokens: 100 },
  });
  assert.equal(result.costUsd, 0.0114);
  assert.equal(result.credits, 1.368);
});

test('raw Gemini reasoning output is billed once', () => {
  const result = calculateAssistantCreditsFromUsage({
    model: 'gemini-4-carbon', pricingTimestampMs: Date.UTC(2026, 9, 21),
    usage: { promptTokenCount: 1000, candidatesTokenCount: 100, thoughtsTokenCount: 900 },
  });
  assert.equal(result.costUsd, 0.012);
  assert.equal(result.credits, 1.44);
});


test('native Claude bills 5-minute and 1-hour cache writes separately', () => {
  const result = calculateAssistantCreditsFromUsage({ model: 'claude-opus-5-5',
    usage: { input_tokens: 1000, cache_read_input_tokens: 2000,
      cache_creation_input_tokens: 1000, cache_creation: { ephemeral_1h_input_tokens: 400 }, output_tokens: 100 } });
  assert.equal(result.costUsd, 0.0126);
  assert.equal(result.credits, 1.512);
});

test('normalized Gemini receipts include reasoning once and the actual regional premium', () => {
  const usage = normalizeAssistantResponseUsage(normalizeAssistantResponseUsage({ google_usage_metadata: {
    promptTokenCount: 1000, candidatesTokenCount: 100, thoughtsTokenCount: 900 } }));
  const result = calculateAssistantCreditsFromUsage({ model: 'gemini-4-carbon', usage,
    pricingTimestampMs: Date.UTC(2026, 9, 21), region: 'us-central1' });
  assert.equal(result.costUsd, 0.0132);
  assert.equal(result.credits, 1.584);
  assert.equal(result.usage.outputTokens, 1000);
});
