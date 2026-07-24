import test from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import SamsarClient from 'samsar-js';

import {
  __testOnly__,
  assignScoreForTheImage,
  runVisionInferenceWithRetry,
} from './VisionUtils.js';

const silentLogger = {
  error() {},
  warn() {},
};

test('Qwen vision requests use operation-specific bounded output limits', () => {
  assert.equal(__testOnly__.getQwenVisionMaxTokens('QWEN3.7', 'description'), 8192);
  assert.equal(__testOnly__.getQwenVisionMaxTokens('QWEN3.7', 'score'), 1024);
  assert.equal(__testOnly__.getQwenVisionMaxTokens('gpt-5.6-sol', 'description'), undefined);
});

test('Kimi K3 drives both native describe and judge stages in high mode', async (t) => {
  const environmentKeys = [
    'CURRENT_ENV',
    'KIMI_K3_API_KEY',
    'SAMSAR_API_KEY',
    'SAMSAR_DEPLOYMENT_EDITION',
    'SAMSAR_EDITION',
    'SAMSAR_EXTERNAL_INFERENCE_ENABLED',
    'SAMSAR_FORCE_EXTERNAL_INFERENCE',
  ];
  const previous = Object.fromEntries(
    environmentKeys.map((key) => [key, process.env[key]]),
  );
  t.after(() => {
    for (const key of environmentKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  for (const key of environmentKeys) delete process.env[key];
  Object.assign(process.env, {
    CURRENT_ENV: 'docker',
    KIMI_K3_API_KEY: 'native-kimi-key',
  });

  const payloads = [];
  t.mock.method(
    OpenAI.Chat.Completions.prototype,
    'create',
    async (payload) => {
      payloads.push(payload);
      return {
        choices: [{
          message: {
            role: 'assistant',
            content: payloads.length === 1 ? 'Detailed image description.' : '93',
          },
        }],
      };
    },
  );

  const description = await __testOnly__.getDescriptionForImage(
    'data:image/png;base64,AQID',
    'cinematic',
    'Kimi K3',
    '16:9',
    'cinematic theme',
    'native',
  );
  const score = await assignScoreForTheImage(
    'A cinematic image',
    description,
    'cinematic',
    'Kimi K3',
    '16:9',
    'cinematic theme',
    '',
    'native',
  );

  assert.equal(description, 'Detailed image description.');
  assert.equal(score, '93');
  assert.equal(payloads.length, 2);
  for (const payload of payloads) {
    assert.equal(payload.model, 'kimi-k3');
    assert.equal(payload.reasoning_effort, 'high');
    assert.equal(payload.messages[0].role, 'system');
  }
  assert.equal(Array.isArray(payloads[0].messages[1].content), true);
  assert.equal(payloads[0].messages[1].content[1].type, 'image_url');
  assert.equal(
    payloads[0].messages[1].content[1].image_url.url,
    'data:image/png;base64,AQID',
  );
});

test('Kimi K3 describe and judge stages use the Samsar-js fallback without a native key', async (t) => {
  const environmentKeys = [
    'CURRENT_ENV',
    'KIMI_K3_API_KEY',
    'SAMSAR_API_KEY',
    'SAMSAR_DEPLOYMENT_EDITION',
    'SAMSAR_EDITION',
    'SAMSAR_EXTERNAL_INFERENCE_ENABLED',
    'SAMSAR_FORCE_EXTERNAL_INFERENCE',
  ];
  const previous = Object.fromEntries(
    environmentKeys.map((key) => [key, process.env[key]]),
  );
  t.after(() => {
    for (const key of environmentKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  for (const key of environmentKeys) delete process.env[key];
  Object.assign(process.env, {
    CURRENT_ENV: 'docker',
    SAMSAR_API_KEY: 'samsar-fallback-key',
  });

  const payloads = [];
  t.mock.method(
    SamsarClient.prototype,
    'createV2ExternalChatCompletion',
    async (payload) => {
      payloads.push(payload);
      return {
        choices: [{
          message: {
            role: 'assistant',
            content: payloads.length === 1 ? 'Fallback image description.' : '88',
          },
        }],
      };
    },
  );

  const description = await __testOnly__.getDescriptionForImage(
    'data:image/png;base64,AQID',
    'cinematic',
    'kimi-k3',
    '16:9',
    '',
    'native',
  );
  const score = await assignScoreForTheImage(
    'A cinematic image',
    description,
    'cinematic',
    'kimi-k3',
    '16:9',
    '',
    '',
    'native',
  );

  assert.equal(description, 'Fallback image description.');
  assert.equal(score, '88');
  assert.equal(payloads.length, 2);
  for (const payload of payloads) {
    assert.equal(payload.model, 'kimi-k3');
    assert.equal(payload.reasoning_effort, 'high');
  }
  assert.equal(
    payloads[0].messages[1].content[1].image_url.url,
    'data:image/png;base64,AQID',
  );
});

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
