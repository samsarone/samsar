import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXTERNAL_MODERATION_DEFAULT_MODEL,
  EXTERNAL_MODERATION_MAX_INPUTS,
  createExternalModeration,
  getExternalModerationTimeoutMs,
  mapExternalModerationError,
  normalizeExternalModerationInput,
} from './ExternalModerationAPI.js';

function moderationResult({
  flagged = false,
  categories = {},
  categoryScores = {},
} = {}) {
  return {
    flagged,
    categories,
    category_scores: categoryScores,
    category_applied_input_types: {},
  };
}

test('external moderation validates the actor and OpenAI-compatible body', async () => {
  await assert.rejects(
    createExternalModeration({
      payload: { input: 'hello' },
      moderationCall: async () => ({ results: [moderationResult()] }),
    }),
    (error) => error.statusCode === 401 && /User ID is required/.test(error.message),
  );

  await assert.rejects(
    createExternalModeration({
      userId: 'user-1',
      payload: { input: '' },
      moderationCall: async () => ({ results: [moderationResult()] }),
    }),
    (error) => error.statusCode === 400 && /non-empty string/.test(error.message),
  );

  await assert.rejects(
    createExternalModeration({
      userId: 'user-1',
      payload: { input: 'hello', model: 'unapproved-model' },
      moderationCall: async () => ({ results: [moderationResult()] }),
    }),
    (error) => error.statusCode === 400 && /model must be one of/.test(error.message),
  );
});

test('external moderation forwards only whitelisted input and model fields', async () => {
  let observedInput;
  let observedOptions;
  const result = await createExternalModeration({
    userId: 'user-1',
    payload: {
      input: 'a calm landscape',
      ignored: 'must not reach OpenAI',
    },
    moderationCall: async (input, options) => {
      observedInput = input;
      observedOptions = options;
      return {
        id: 'modr-test',
        model: EXTERNAL_MODERATION_DEFAULT_MODEL,
        results: [moderationResult()],
      };
    },
  });

  assert.equal(observedInput, 'a calm landscape');
  assert.equal(observedOptions.model, EXTERNAL_MODERATION_DEFAULT_MODEL);
  assert.equal(observedOptions.signal instanceof AbortSignal, true);
  assert.deepEqual(Object.keys(observedOptions).sort(), ['model', 'signal']);
  assert.equal(result.response.id, 'modr-test');
  assert.deepEqual(result.response.decision, { safe: true, reason: 'passed' });
  assert.equal('creditsCharged' in result, false);
  assert.equal('remainingCredits' in result, false);
});

test('external moderation accepts bounded multimodal input without changing its schema', async () => {
  const input = [
    { type: 'text', text: 'A watercolor illustration' },
    { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
  ];
  const normalized = normalizeExternalModerationInput(input);

  assert.deepEqual(normalized, input);
  assert.notEqual(normalized, input);
  assert.throws(
    () => normalizeExternalModerationInput(['valid', { type: 'text', text: 'not mixed' }]),
    /cannot mix strings and moderation input objects/,
  );
  assert.throws(
    () => normalizeExternalModerationInput(Array(EXTERNAL_MODERATION_MAX_INPUTS + 1).fill('text')),
    (error) => error.statusCode === 413 && /at most/.test(error.message),
  );
  assert.throws(
    () => normalizeExternalModerationInput([
      { type: 'image_url', image_url: { url: 'file:///tmp/private.png' } },
    ]),
    /must use http, https, or an image data URL/,
  );
});

test('external moderation rejects the whole response if any returned result is unsafe', async () => {
  const result = await createExternalModeration({
    userId: 'user-1',
    payload: { input: ['safe text', 'unsafe text'] },
    moderationCall: async () => ({
      id: 'modr-aggregate',
      results: [
        moderationResult(),
        moderationResult({
          flagged: true,
          categories: { violence: true, harassment: false },
          categoryScores: { violence: 0.99 },
        }),
      ],
    }),
  });

  assert.deepEqual(result.response.decision, {
    safe: false,
    reason: 'flagged',
    categories: ['violence'],
  });
});

test('external moderation treats malformed or incomplete native responses as upstream failures', async () => {
  for (const { input, response } of [
    { input: 'hello', response: null },
    { input: 'hello', response: {} },
    { input: 'hello', response: { results: [] } },
    { input: 'hello', response: { results: [{}] } },
    {
      input: ['first', 'second'],
      response: { results: [moderationResult()] },
    },
  ]) {
    await assert.rejects(
      createExternalModeration({
        userId: 'user-1',
        payload: { input },
        moderationCall: async () => response,
      }),
      (error) => error.statusCode === 502 && error.code === 'INVALID_MODERATION_RESPONSE',
    );
  }
});

test('external moderation has a hard deadline and aborts the native request', async () => {
  let signalWasAborted = false;
  await assert.rejects(
    createExternalModeration({
      userId: 'user-1',
      payload: { input: 'hello' },
      timeoutMs: 1,
      moderationCall: async (input, { signal }) => new Promise(() => {
        signal.addEventListener('abort', () => {
          signalWasAborted = true;
        }, { once: true });
      }),
    }),
    (error) => error.statusCode === 504 && error.code === 'EXTERNAL_MODERATION_TIMEOUT',
  );
  assert.equal(signalWasAborted, true);
});

test('external moderation timeout configuration is clamped to production-safe bounds', () => {
  assert.equal(getExternalModerationTimeoutMs({}), 95_000);
  assert.equal(getExternalModerationTimeoutMs({ SAMSAR_EXTERNAL_MODERATION_TIMEOUT_MS: '10' }), 1_000);
  assert.equal(getExternalModerationTimeoutMs({ SAMSAR_EXTERNAL_MODERATION_TIMEOUT_MS: '999999' }), 120_000);
});

test('external moderation errors do not expose native provider details', () => {
  assert.deepEqual(
    mapExternalModerationError(Object.assign(new Error('sk-secret leaked in auth error'), { status: 401 })),
    {
      statusCode: 503,
      message: 'The production moderation provider is not configured.',
    },
  );
  assert.deepEqual(
    mapExternalModerationError(Object.assign(new Error('missing server key'), {
      status: 503,
      code: 'MODERATION_PROVIDER_UNAVAILABLE',
    })),
    {
      statusCode: 503,
      message: 'The production moderation provider is not configured.',
    },
  );
  assert.deepEqual(
    mapExternalModerationError(Object.assign(new Error('provider internals'), { status: 429 })),
    {
      statusCode: 503,
      message: 'The production moderation provider is temporarily unavailable.',
    },
  );
  assert.deepEqual(
    mapExternalModerationError(Object.assign(new Error('provider internals'), { status: 400 })),
    {
      statusCode: 400,
      message: 'The production moderation provider rejected the request.',
    },
  );
});
