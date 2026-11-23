import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import OpenAI from 'openai';

import {
  buildRequestOptions,
  createCompatibleChatCompletion,
  getInferenceAdapterProvider,
  isRetryableInferenceAdapterError,
  runInferenceAdapterFallback,
} from './OpenAICompat.js';

test('native Gemini dispatch forwards its deadline and never retries an unresolved body', async (t) => {
  const settings = {
    SAMSAR_DEPLOYMENT_EDITION: 'production', CURRENT_ENV: 'production',
    GOOGLE_GEMINI_API_KEY: 'test-native-key',
  };
  const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  let dispatches = 0;
  let signal;
  t.mock.method(globalThis, 'fetch', async (_url, request) => {
    dispatches++;
    signal = request.signal;
    return { ok: true, status: 200, text: () => new Promise(() => {}) };
  });
  await assert.rejects(createCompatibleChatCompletion({}, {
    model: 'gemini-4-carbon', messages: [{ role: 'user', content: 'private speech' }],
    timeout: 15, maxRetries: 0, bypassSamsarExternalInference: true,
    logger: { info() {}, warn() {}, error() {} },
  }), error => error.code === 'ETIMEDOUT' && error.providerOutcomeUncertain === true);
  assert.equal(dispatches, 1);
  assert.equal(signal.aborted, true);
});

test('OpenAI-compatible dispatch disables hidden SDK retries after media normalization', () => {
  assert.deepEqual(
    buildRequestOptions({ timeout: 2500, maxRetries: 7 }),
    { timeout: 2500, maxRetries: 0 },
  );
});

test('responses dispatch passes maxRetries zero to the SDK', async () => {
  let receivedOptions;
  const openaiClient = {
    post: async (_path, options) => {
      receivedOptions = options;
      return { output_text: 'ok' };
    },
  };

  await createCompatibleChatCompletion(openaiClient, {
    model: 'gpt-6.2-astra-xhigh',
    messages: [{ role: 'user', content: 'hello' }],
    maxRetries: 9,
  });

  assert.equal(receivedOptions.maxRetries, 0);
  assert.equal(receivedOptions.body.model, 'gpt-6.2-astra');
  assert.deepEqual(receivedOptions.body.reasoning, { effort: 'xhigh' });
});

test('adapter fallback follows preference order after retryable adapter errors', async () => {
  const attempts = [];
  const response = await runInferenceAdapterFallback(
    ['openai', 'openrouter', 'samsar'],
    async (provider) => {
      attempts.push(provider);
      if (provider === 'openai') {
        const error = new Error('unauthorized');
        error.status = 401;
        throw error;
      }
      if (provider === 'openrouter') {
        throw new Error('connection refused', { cause: { code: 'ECONNREFUSED' } });
      }
      return { provider };
    },
  );

  assert.deepEqual(attempts, ['openai', 'openrouter', 'samsar']);
  assert.deepEqual(response, { provider: 'samsar' });
  assert.equal(isRetryableInferenceAdapterError({ status: 503 }), false);
});

test('adapter fallback stops on a non-retryable 4xx error', async () => {
  const attempts = [];
  await assert.rejects(
    runInferenceAdapterFallback(
      ['openai', 'samsar'],
      async (provider) => {
        attempts.push(provider);
        const error = new Error('invalid request');
        error.status = 400;
        throw error;
      },
    ),
    /invalid request/,
  );

  assert.deepEqual(attempts, ['openai']);
  assert.equal(isRetryableInferenceAdapterError({ status: 403 }), true);
  assert.equal(isRetryableInferenceAdapterError({ status: 404 }), false);
  assert.equal(isRetryableInferenceAdapterError({
    status: 404,
    code: 'GENBLAZE_MODEL_UNSUPPORTED',
  }), true);
});

test('completion dispatch retries the next saved adapter after a retryable failure', async (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-express-dispatch-'));
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
      'gpt-6.2-astra': ['openai', 'openrouter'],
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
  const openaiClient = {
    post: async () => {
      attempts.push('openai');
      const error = new Error('native key rejected');
      error.status = 401;
      throw error;
    },
  };
  t.mock.method(OpenAI.Chat.Completions.prototype, 'create', async () => {
    attempts.push('openrouter');
    return {
      model: 'openai/gpt-6.2-astra',
      choices: [{ message: { content: 'fallback ok' } }],
    };
  });

  const response = await createCompatibleChatCompletion(openaiClient, {
    model: 'gpt-6.2-astra',
    messages: [{ role: 'user', content: 'hello' }],
    authorization: 'native',
    maxRetries: 0,
  });

  assert.deepEqual(attempts, ['openai', 'openrouter']);
  assert.equal(response.choices[0].message.content, 'fallback ok');
  assert.equal(getInferenceAdapterProvider(response), 'openrouter');
});

test('compat dispatch does not leak external retry controls into native Qwen', async (t) => {
  const envKeys = [
    'CURRENT_ENV',
    'DASHSCOPE_API_KEY',
    'OPENROUTER_API_KEY',
    'SAMSAR_API_KEY',
    'SAMSAR_DEPLOYMENT_EDITION',
  ];
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  Object.assign(process.env, {
    CURRENT_ENV: 'docker',
    DASHSCOPE_API_KEY: 'qwen-native-key',
    SAMSAR_DEPLOYMENT_EDITION: 'standalone',
  });
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.SAMSAR_API_KEY;

  let capturedPayload;
  t.mock.method(OpenAI.Chat.Completions.prototype, 'create', async (payload) => {
    capturedPayload = payload;
    return {
      model: 'qwen3.8-max',
      choices: [{ message: { content: 'native qwen' } }],
    };
  });

  await createCompatibleChatCompletion({}, {
    model: 'QWEN3.8',
    messages: [{ role: 'user', content: 'hello' }],
    authorization: 'native',
    bypassSamsarExternalInference: true,
    externalMaxRetries: 9,
    maxRetries: 7,
  });

  assert.equal(Object.hasOwn(capturedPayload, 'externalMaxRetries'), false);
  assert.equal(Object.hasOwn(capturedPayload, 'maxRetries'), false);
});
