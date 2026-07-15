import test from 'node:test';
import assert from 'node:assert/strict';

import {
  __testOnly__,
  runVisionInferenceWithRetry,
} from './VisionUtils.js';

const silentLogger = {
  error() {},
  warn() {},
};

test('vision inference retries a 429 three times with exponential backoff', async () => {
  let calls = 0;
  const observedDelays = [];

  const result = await runVisionInferenceWithRetry(async () => {
    calls += 1;
    if (calls <= 3) {
      const error = new Error('Provider returned error');
      error.status = 429;
      throw error;
    }
    return 'ok';
  }, {
    maxRetries: 3,
    sleep: async (delayMs) => observedDelays.push(delayMs),
    logger: silentLogger,
  });

  assert.equal(result, 'ok');
  assert.equal(calls, 4);
  assert.deepEqual(observedDelays, [
    __testOnly__.getVisionInferenceRetryDelayMs(1),
    __testOnly__.getVisionInferenceRetryDelayMs(2),
    __testOnly__.getVisionInferenceRetryDelayMs(3),
  ]);
  assert.ok(observedDelays[1] >= observedDelays[0]);
  assert.ok(observedDelays[2] >= observedDelays[1]);
});

test('vision inference fails immediately for non-retryable authentication errors', async () => {
  let calls = 0;
  const observedDelays = [];

  await assert.rejects(
    runVisionInferenceWithRetry(async () => {
      calls += 1;
      const error = new Error('Unauthorized');
      error.status = 401;
      throw error;
    }, {
      maxRetries: 3,
      sleep: async (delayMs) => observedDelays.push(delayMs),
      logger: silentLogger,
    }),
    (error) => error.status === 401 &&
      error.nonPromptProviderFailure === true &&
      error.preserveExpressImageLayer === true,
  );

  assert.equal(calls, 1);
  assert.deepEqual(observedDelays, []);
});

test('vision inference marks the final exhausted provider error for image recovery', async () => {
  let calls = 0;

  await assert.rejects(
    runVisionInferenceWithRetry(async () => {
      calls += 1;
      const error = new Error('Rate limited');
      error.status = 429;
      throw error;
    }, {
      maxRetries: 3,
      sleep: async () => {},
      logger: silentLogger,
    }),
    (error) => error.status === 429 &&
      error.nonPromptProviderFailure === true &&
      error.preserveExpressImageLayer === true,
  );

  assert.equal(calls, 4);
});
