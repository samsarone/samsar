import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import OpenAI from 'openai';

import { getDescriptionForImage } from './Vision.js';
import {
  sendAssistantMessageRequest,
} from '../ai_video/assistant/OpenAi.js';

const ENV_KEYS = [
  'CURRENT_ENV',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'SAMSAR_API_KEY',
  'SAMSAR_DEPLOYMENT_EDITION',
  'SAMSAR_EDITION',
  'SAMSAR_EXTERNAL_INFERENCE_MAX_RETRIES',
  'SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH',
  'SAMSAR_PROVIDER_USAGE_AUDIT_ENABLED',
  'SAMSAR_RUNTIME',
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

function configurePreferences(t, {
  edition = 'standalone',
  providers = ['openrouter', 'openai'],
} = {}) {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-express-entry-'));
  const preferencePath = path.join(temporaryDirectory, 'model-adapter-preferences.json');
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  fs.writeFileSync(preferencePath, JSON.stringify({
    modelProviderPriority: {
      'gpt-5.6-sol': providers,
    },
  }));
  Object.assign(process.env, {
    CURRENT_ENV: edition === 'standalone' ? 'docker' : edition,
    OPENAI_API_KEY: `openai-${edition}-key`,
    OPENROUTER_API_KEY: `openrouter-${edition}-key`,
    SAMSAR_DEPLOYMENT_EDITION: edition,
    SAMSAR_EXTERNAL_INFERENCE_MAX_RETRIES: '0',
    SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH: preferencePath,
    SAMSAR_PROVIDER_USAGE_AUDIT_ENABLED: 'false',
  });
  delete process.env.SAMSAR_API_KEY;
}

test.afterEach(resetEnv);

test('assistant entry point advances from reordered OpenRouter to native OpenAI', async (t) => {
  ENV_KEYS.forEach((key) => delete process.env[key]);
  configurePreferences(t);
  const attempts = [];

  t.mock.method(OpenAI.Chat.Completions.prototype, 'create', async () => {
    attempts.push('openrouter');
    const error = new Error('OpenRouter rate limited');
    error.status = 429;
    throw error;
  });
  t.mock.method(OpenAI.prototype, 'post', async () => {
    attempts.push('openai');
    return {
      id: 'native-response',
      model: 'gpt-5.6-sol',
      output_text: 'native assistant response',
    };
  });

  const response = await sendAssistantMessageRequest(
    [{ role: 'user', content: 'Generate a prompt.' }],
    'gpt-5.6-sol',
  );

  assert.equal(response.content, 'native assistant response');
  assert.deepEqual(attempts, ['openrouter', 'openai']);
});

test('vision entry point advances through the saved standalone adapter order', async (t) => {
  ENV_KEYS.forEach((key) => delete process.env[key]);
  configurePreferences(t);
  const attempts = [];

  t.mock.method(OpenAI.Chat.Completions.prototype, 'create', async () => {
    attempts.push('openrouter');
    const error = new Error('OpenRouter connection refused');
    error.code = 'ECONNREFUSED';
    throw error;
  });
  t.mock.method(OpenAI.prototype, 'post', async () => {
    attempts.push('openai');
    return {
      id: 'native-vision-response',
      model: 'gpt-5.6-sol',
      output_text: 'native vision description',
    };
  });

  const response = await getDescriptionForImage(
    'data:image/png;base64,aW1hZ2U=',
    'gpt-5.6-sol',
  );

  assert.equal(response, 'native vision description');
  assert.deepEqual(attempts, ['openrouter', 'openai']);
});

test('assistant and vision entry points ignore standalone preferences in production and staging', async (t) => {
  ENV_KEYS.forEach((key) => delete process.env[key]);
  const attempts = [];

  t.mock.method(OpenAI.Chat.Completions.prototype, 'create', async () => {
    attempts.push('openrouter');
    throw new Error('production must not select saved OpenRouter preference');
  });
  t.mock.method(OpenAI.prototype, 'post', async () => {
    attempts.push('openai');
    return {
      id: `native-${attempts.length}`,
      model: 'gpt-5.6-sol',
      output_text: 'production native response',
    };
  });

  for (const edition of ['production', 'staging']) {
    configurePreferences(t, { edition });
    const assistantResponse = await sendAssistantMessageRequest(
      [{ role: 'user', content: 'Generate a prompt.' }],
      'gpt-5.6-sol',
    );
    const visionResponse = await getDescriptionForImage(
      'data:image/png;base64,aW1hZ2U=',
      'gpt-5.6-sol',
    );

    assert.equal(assistantResponse.content, 'production native response');
    assert.equal(visionResponse, 'production native response');
  }
  assert.deepEqual(attempts, ['openai', 'openai', 'openai', 'openai']);
});
