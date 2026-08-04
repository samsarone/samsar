import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateNarrativeBilling,
  NARRATIVE_PRICING_MULTIPLIER,
  validateNarrativeBilling,
} from './NarrativeBilling.js';

test('aggregates mixed GPT, Gemini, and Qwen inference receipts at 1.5x', () => {
  const result = calculateNarrativeBilling([
    {
      stage: 'theme_generation',
      attempt: 1,
      model: 'gpt-5.6-sol',
      provider: 'openai',
      usage: {
        input_tokens: 100_000,
        output_tokens: 10_000,
        input_tokens_details: { cached_tokens: 20_000 },
        output_tokens_details: { reasoning_tokens: 3_000 },
      },
    },
    {
      stage: 'narrative_generation',
      attempt: 2,
      model: 'gemini-3.1-pro',
      provider: 'google',
      usageMetadata: {
        promptTokenCount: 100_000,
        candidatesTokenCount: 20_000,
        cachedContentTokenCount: 50_000,
        thoughtsTokenCount: 4_000,
      },
    },
    {
      stage: 'narrative_validation',
      attempt: 1,
      model: 'qwen3.8-max',
      provider: 'alibaba',
      usage: {
        prompt_tokens: 100_000,
        completion_tokens: 40_000,
        prompt_tokens_details: { cached_tokens: 10_000 },
        completion_tokens_details: { reasoning_tokens: 2_000 },
      },
    },
  ]);

  assert.equal(NARRATIVE_PRICING_MULTIPLIER, 1.5);
  assert.equal(result.underlyingCostUsd, 1.658);
  assert.equal(result.costUsd, 1.658);
  assert.equal(result.underlyingCredits, 165.8);
  assert.equal(result.credits, 248.7);
  assert.equal(result.pricingMultiplier, 1.5);
  assert.equal(result.creditsPerDollar, 100);
  assert.deepEqual(result.usage, {
    inputTokens: 300_000,
    outputTokens: 74_000,
    cachedInputTokens: 80_000,
    reasoningTokens: 9_000,
  });
  assert.deepEqual(
    result.receipts.map((receipt) => receipt.underlyingCostUsd),
    [0.71, 0.398, 0.55],
  );
  assert.deepEqual(
    result.receipts.map((receipt) => receipt.underlyingCredits),
    [71, 39.8, 55],
  );
  assert.deepEqual(result.receipts[1].usage, {
    inputTokens: 100_000,
    outputTokens: 24_000,
    cachedInputTokens: 50_000,
    reasoningTokens: 4_000,
  });
});

test('requires every inference receipt to have usage and a recognized pricing model', () => {
  const billing = calculateNarrativeBilling([
    { model: 'gpt-5.6-sol', usage: { input_tokens: 10, output_tokens: 2 } },
    { model: 'unknown-provider/model', usage: { input_tokens: 10, output_tokens: 2 } },
    { model: 'QWEN3.8', usage: null },
  ]);
  const validation = validateNarrativeBilling(billing, 3);

  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(' '), /unsupported pricing model/);
  assert.match(validation.errors.join(' '), /no billable token usage/);
  assert.deepEqual(validateNarrativeBilling(
    calculateNarrativeBilling([
      { model: 'gpt-5.6-sol', usage: { input_tokens: 10, output_tokens: 2 } },
    ]),
    1,
  ), { valid: true, errors: [] });
});

test('applies the multiplier after summing underlying cost instead of rounded call credits', () => {
  const result = calculateNarrativeBilling([
    { model: 'qwen3.8-max', usage: { input_tokens: 1 } },
    { model: 'qwen3.8-max', usage: { input_tokens: 1 } },
  ]);

  assert.equal(result.underlyingCostUsd, 0.000005);
  assert.deepEqual(
    result.receipts.map((receipt) => receipt.underlyingCredits),
    [0.0003, 0.0003],
  );
  assert.equal(result.underlyingCredits, 0.0005);
  assert.equal(result.credits, 0.0008);
});

test('retains only safe per-call metadata and returns zero billing for invalid input', () => {
  const result = calculateNarrativeBilling([
    null,
    'not-a-receipt',
    {
      stage: ' narrative_generation ',
      attempt: '3',
      provider: ' openai ',
      response: {
        model: 'gpt-5.6-sol',
        usage: { input_tokens: 10, output_tokens: 5 },
        secretPayload: 'must not be retained',
      },
      prompt: 'must not be retained',
    },
  ]);

  assert.equal(result.receipts.length, 1);
  assert.deepEqual(Object.keys(result.receipts[0]).sort(), [
    'attempt',
    'model',
    'pricingModel',
    'provider',
    'stage',
    'underlyingCostUsd',
    'underlyingCredits',
    'usage',
  ]);
  assert.equal(result.receipts[0].stage, 'narrative_generation');
  assert.equal(result.receipts[0].attempt, 3);
  assert.equal(result.receipts[0].provider, 'openai');
  assert.equal(result.receipts[0].model, 'gpt-5.6-sol');
  assert.equal('response' in result.receipts[0], false);
  assert.equal('prompt' in result.receipts[0], false);

  assert.deepEqual(calculateNarrativeBilling({}), {
    credits: 0,
    costUsd: 0,
    underlyingCostUsd: 0,
    underlyingCredits: 0,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
    },
    receipts: [],
    pricingMultiplier: 1.5,
    creditsPerDollar: 100,
  });
});

test('re-prices normalized persisted receipts after an async worker restart', () => {
  const firstPass = calculateNarrativeBilling([{
    stage: 'theme_generation',
    validationAttempt: 2,
    requestKey: 'narrative:create_single:theme',
    model: 'gpt-5.6-sol',
    usage: {
      input_tokens: 1_000,
      output_tokens: 100,
      input_tokens_details: { cached_tokens: 200 },
      output_tokens_details: { reasoning_tokens: 20 },
    },
  }]);
  const recovered = calculateNarrativeBilling(firstPass.receipts);

  assert.equal(recovered.underlyingCostUsd, firstPass.underlyingCostUsd);
  assert.equal(recovered.credits, firstPass.credits);
  assert.deepEqual(recovered.usage, firstPass.usage);
  assert.equal(recovered.receipts[0].validationAttempt, 2);
  assert.equal(recovered.receipts[0].requestKey, 'narrative:create_single:theme');
});
