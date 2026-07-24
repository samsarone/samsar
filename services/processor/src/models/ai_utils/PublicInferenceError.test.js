import assert from 'node:assert/strict';
import test from 'node:test';

import { createPublicInferenceError } from './PublicInferenceError.js';

test('surfaces a safe Qwen quota error with the provider reset time', () => {
  const providerError = new Error(
    '429 Your token-plan 1-week quota has been exhausted. The quota will reset at 07-27 13:23:00 UTC.',
  );
  providerError.status = 429;
  providerError.code = 'insufficient_quota';

  const result = createPublicInferenceError(providerError, { model: 'QWEN3.7' });

  assert.equal(
    result.message,
    'Qwen inference quota has been exhausted. The quota will reset at 07-27 13:23:00 UTC.',
  );
  assert.equal(result.code, 'INFERENCE_PROVIDER_QUOTA_EXHAUSTED');
  assert.equal(result.status, 429);
  assert.equal(result.retryable, false);
  assert.equal(result.cause, providerError);
});

test('recognizes nested OpenAI-compatible quota errors', () => {
  const result = createPublicInferenceError({
    response: {
      status: 429,
      data: {
        error: {
          code: 'insufficient_quota',
          message: 'Insufficient quota for this request.',
        },
      },
    },
  }, { model: 'gemini-3.1-pro' });

  assert.equal(result.message, 'Gemini inference quota has been exhausted.');
});

test('recognizes OpenRouter Qwen max-token affordability errors', () => {
  const providerError = new Error(
    '402 This request requires more credits, or fewer max_tokens. ' +
    'You requested up to 16000 tokens, but can only afford 2353.',
  );
  providerError.status = 402;
  providerError.code = 402;

  const result = createPublicInferenceError(providerError, {
    model: 'qwen/qwen3.7-max',
  });

  assert.equal(result.message, 'Qwen inference quota has been exhausted.');
  assert.equal(result.code, 'INFERENCE_PROVIDER_QUOTA_EXHAUSTED');
  assert.equal(result.retryable, false);
  assert.equal(result.cause, providerError);
});

test('limits OpenRouter max-token affordability handling to Qwen 3.7 Max', () => {
  const providerError = new Error(
    '402 This request requires more credits, or fewer max_tokens.',
  );
  providerError.status = 402;

  assert.equal(
    createPublicInferenceError(providerError, { model: 'qwen/qwen3.7-plus' }),
    null,
  );
});

test('does not expose unrelated provider failures', () => {
  const providerError = new Error('Internal database hostname db.internal.local failed');
  providerError.status = 500;

  assert.equal(createPublicInferenceError(providerError, { model: 'QWEN3.7' }), null);
});

test('does not treat a temporary 429 rate limit as exhausted quota', () => {
  const providerError = new Error('Rate limit exceeded. Retry after 30 seconds.');
  providerError.status = 429;
  providerError.code = 'rate_limit_exceeded';

  assert.equal(createPublicInferenceError(providerError, { model: 'QWEN3.7' }), null);
});
