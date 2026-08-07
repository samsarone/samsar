import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import OpenAI from 'openai';

import {
  sendAssistantMessageRequest as sendAlternatePromptRequest,
} from './AIUtils.js';
import {
  sendAssistantMessageRequest,
  sendAssistantStructuredMessageRequest,
} from './OpenAI.js';

const ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_DEPLOYMENT_EDITION',
  'SAMSAR_EDITION',
  'SAMSAR_RUNTIME',
  'SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH',
  'SAMSAR_PROVIDER_USAGE_AUDIT_ENABLED',
  'SAMSAR_EXTERNAL_INFERENCE_MAX_RETRIES',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'SAMSAR_API_KEY',
];
const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

function resetEnv() {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
}

function configureStandalonePreferences(t, modelProviderPriority) {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-inference-dispatch-'));
  const preferencesPath = path.join(temporaryDirectory, 'model-adapter-preferences.json');
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  fs.writeFileSync(preferencesPath, JSON.stringify({ modelProviderPriority }));
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH = preferencesPath;
  process.env.SAMSAR_PROVIDER_USAGE_AUDIT_ENABLED = 'false';
  process.env.SAMSAR_EXTERNAL_INFERENCE_MAX_RETRIES = '0';
}

test.afterEach(resetEnv);

test('OpenAI prompt dispatch starts with the saved standalone adapter', async (t) => {
  ENV_KEYS.forEach((key) => delete process.env[key]);
  configureStandalonePreferences(t, {
    'gpt-5.6-sol': ['openrouter', 'openai'],
  });
  process.env.OPENAI_API_KEY = 'openai-test-key';
  process.env.OPENROUTER_API_KEY = 'openrouter-test-key';

  let nativeCalls = 0;
  const openRouterPayloads = [];
  t.mock.method(OpenAI.prototype, 'post', async () => {
    nativeCalls += 1;
    throw new Error('native OpenAI should not be selected first');
  });
  t.mock.method(OpenAI.Chat.Completions.prototype, 'create', async (payload) => {
    openRouterPayloads.push(payload);
    return {
      choices: [{ message: { role: 'assistant', content: 'OpenRouter response' } }],
    };
  });

  const response = await sendAssistantMessageRequest(
    [{ role: 'user', content: 'Generate a prompt.' }],
    'gpt-5.6-sol',
  );

  assert.equal(response.content, 'OpenRouter response');
  assert.equal(nativeCalls, 0);
  assert.equal(openRouterPayloads.length, 1);
  assert.equal(openRouterPayloads[0].model, 'openai/gpt-5.6-sol');
});

test('OpenAI prompt dispatch advances to the next adapter after a retryable failure', async (t) => {
  ENV_KEYS.forEach((key) => delete process.env[key]);
  configureStandalonePreferences(t, {
    'gpt-5.6-sol': ['openai', 'openrouter'],
  });
  process.env.OPENAI_API_KEY = 'openai-test-key';
  process.env.OPENROUTER_API_KEY = 'openrouter-test-key';

  let nativeCalls = 0;
  let openRouterCalls = 0;
  t.mock.method(OpenAI.prototype, 'post', async () => {
    nativeCalls += 1;
    const error = new Error('native rate limit');
    error.status = 429;
    throw error;
  });
  t.mock.method(OpenAI.Chat.Completions.prototype, 'create', async () => {
    openRouterCalls += 1;
    return {
      choices: [{ message: { role: 'assistant', content: 'Fallback response' } }],
    };
  });

  const response = await sendAssistantMessageRequest(
    [{ role: 'user', content: 'Generate a prompt.' }],
    'gpt-5.6-sol',
  );

  assert.equal(response.content, 'Fallback response');
  assert.equal(nativeCalls, 1);
  assert.equal(openRouterCalls, 1);
});

test('alternate prompt dispatch uses the same ordered retryable fallback', async (t) => {
  ENV_KEYS.forEach((key) => delete process.env[key]);
  configureStandalonePreferences(t, {
    'gpt-5.6-sol': ['openai', 'openrouter'],
  });
  process.env.OPENAI_API_KEY = 'openai-test-key';
  process.env.OPENROUTER_API_KEY = 'openrouter-test-key';

  const attemptedModels = [];
  t.mock.method(OpenAI.Chat.Completions.prototype, 'create', async (payload) => {
    attemptedModels.push(payload.model);
    if (payload.model === 'gpt-4.1-2025-04-14') {
      const error = new Error('native rate limited before acceptance');
      error.status = 429;
      throw error;
    }
    return {
      choices: [{ message: { role: 'assistant', content: 'Alternate fallback' } }],
    };
  });

  const response = await sendAlternatePromptRequest(
    [{ role: 'user', content: 'Rewrite this prompt.' }],
    'gpt-5.6-sol',
  );

  assert.equal(response.content, 'Alternate fallback');
  assert.deepEqual(attemptedModels, [
    'gpt-4.1-2025-04-14',
    'openai/gpt-5.6-sol',
  ]);
});

test('structured prompt dispatch also advances through configured adapters', async (t) => {
  ENV_KEYS.forEach((key) => delete process.env[key]);
  configureStandalonePreferences(t, {
    'gpt-5.6-sol': ['openai', 'openrouter'],
  });
  process.env.OPENAI_API_KEY = 'openai-test-key';
  process.env.OPENROUTER_API_KEY = 'openrouter-test-key';

  const attemptedModels = [];
  t.mock.method(OpenAI.Chat.Completions.prototype, 'create', async (payload) => {
    attemptedModels.push(payload.model);
    if (payload.model === 'gpt-4o-2024-11-20') {
      const error = new Error('native connection refused');
      error.code = 'ECONNREFUSED';
      throw error;
    }
    return {
      choices: [{
        message: {
          role: 'assistant',
          content: JSON.stringify({ useEndFrame: true }),
        },
      }],
    };
  });

  const response = await sendAssistantStructuredMessageRequest(
    [{ role: 'user', content: 'Should this shot use an end frame?' }],
    'gpt-5.6-sol',
  );

  assert.deepEqual(response, { useEndFrame: true });
  assert.deepEqual(attemptedModels, [
    'gpt-4o-2024-11-20',
    'openai/gpt-5.6-sol',
  ]);
});
