import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import OpenAI from 'openai';

import {
  isRetryableInferenceAdapterError,
  runInferenceAdapterFallback,
  sendAssistantCompletionRequest,
} from '../src/OpenAI.js';

test('assistant adapter fallback follows preference order after retryable errors', async () => {
  const attempts = [];
  const response = await runInferenceAdapterFallback(
    ['openai', 'openrouter', 'samsar'],
    async (provider) => {
      attempts.push(provider);
      if (provider === 'openai') {
        const error = new Error('forbidden');
        error.status = 403;
        throw error;
      }
      if (provider === 'openrouter') {
        throw new Error('connection reset', { cause: { code: 'ECONNRESET' } });
      }
      return { provider };
    },
  );

  assert.deepEqual(attempts, ['openai', 'openrouter', 'samsar']);
  assert.deepEqual(response, { provider: 'samsar' });
  assert.equal(isRetryableInferenceAdapterError({ status: 429 }), true);
});

test('assistant adapter fallback stops on a non-retryable 4xx error', async () => {
  const attempts = [];
  await assert.rejects(
    runInferenceAdapterFallback(
      ['openai', 'samsar'],
      async (provider) => {
        attempts.push(provider);
        const error = new Error('invalid request');
        error.status = 422;
        throw error;
      },
    ),
    /invalid request/,
  );

  assert.deepEqual(attempts, ['openai']);
  assert.equal(isRetryableInferenceAdapterError({ status: 401 }), true);
  assert.equal(isRetryableInferenceAdapterError({ status: 404 }), false);
  assert.equal(isRetryableInferenceAdapterError({
    status: 404,
    code: 'GENBLAZE_MODEL_UNSUPPORTED',
  }), true);
});

test('assistant completion retries the next saved adapter after a retryable failure', async (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-assistant-dispatch-'));
  const preferencePath = path.join(temporaryDirectory, 'model-adapter-preferences.json');
  const envKeys = [
    'CURRENT_ENV',
    'OPENAI_API_KEY',
    'OPENROUTER_API_KEY',
    'SAMSAR_API_KEY',
    'SAMSAR_DEPLOYMENT_EDITION',
    'SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH',
  ];
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  t.after(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  fs.writeFileSync(preferencePath, JSON.stringify({
    modelProviderPriority: {
      'gpt-5.6-sol': ['openai', 'openrouter'],
    },
  }));
  Object.assign(process.env, {
    CURRENT_ENV: 'docker',
    OPENAI_API_KEY: 'openai-key',
    OPENROUTER_API_KEY: 'openrouter-key',
    SAMSAR_DEPLOYMENT_EDITION: 'standalone',
    SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH: preferencePath,
  });
  delete process.env.SAMSAR_API_KEY;

  const attempts = [];
  t.mock.method(OpenAI.prototype, 'post', async () => {
    attempts.push('openai');
    const error = new Error('native key rejected');
    error.status = 401;
    throw error;
  });
  t.mock.method(OpenAI.Chat.Completions.prototype, 'create', async () => {
    attempts.push('openrouter');
    return {
      model: 'openai/gpt-5.6-sol',
      choices: [{ message: { content: 'fallback ok' } }],
    };
  });

  const response = await sendAssistantCompletionRequest(
    [{ role: 'user', content: 'hello' }],
    'gpt-5.6-sol',
    { authorization: 'native' },
  );

  assert.deepEqual(attempts, ['openai', 'openrouter']);
  assert.equal(response.outputText, 'fallback ok');
  assert.equal(response.externalProvider, 'openrouter');
});
