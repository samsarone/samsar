import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import OpenAI from 'openai';

import {
  DOCKER_INFERENCE_PROVIDER,
  createOpenRouterChatCompletion,
  resolveConfiguredInferenceProvider,
} from './SamsarExternalInferenceAdapter.js';

test('Qwen uses GMICloud through GenBlaze before Samsar and OpenRouter', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-genblaze-inference-'));
  const catalogPath = path.join(directory, 'genblaze-model-catalog.json');
  fs.writeFileSync(catalogPath, JSON.stringify({
    version: 1,
    provider: 'gmicloud',
    models: {
      'QWEN3.8': {
        text: { modelId: 'Qwen/Qwen3.8-Max', operation: 'chat.completions' },
        vision: { modelId: 'Qwen/Qwen3.8-Max', operation: 'chat.completions' },
      },
    },
  }));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const keys = ['CURRENT_ENV', 'SAMSAR_GENBLAZE_ENABLED', 'SAMSAR_GENBLAZE_MODEL_CATALOG_PATH', 'OPENROUTER_API_KEY', 'SAMSAR_API_KEY', 'ALIBABA_API_KEY'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  for (const key of keys) delete process.env[key];
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_GENBLAZE_ENABLED = 'true';
  process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH = catalogPath;
  process.env.SAMSAR_API_KEY = 'samsar-key';
  process.env.OPENROUTER_API_KEY = 'openrouter-key';

  assert.equal(resolveConfiguredInferenceProvider('QWEN3.8'), DOCKER_INFERENCE_PROVIDER.GMICLOUD);
});

test('Qwen OpenRouter applies Qwen 3.8 Max to text and vision with bounded settings', async (t) => {
  const keys = ['CURRENT_ENV', 'OPENROUTER_API_KEY', 'OPENROUTER_QWEN_MAX_TOKENS'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  process.env.CURRENT_ENV = 'production';
  process.env.OPENROUTER_API_KEY = 'openrouter-key';
  process.env.OPENROUTER_QWEN_MAX_TOKENS = '50000';
  const payloads = [];
  const options = [];
  t.mock.method(OpenAI.Chat.Completions.prototype, 'create', async (payload, requestOptions) => {
    payloads.push(payload);
    options.push(requestOptions);
    return { choices: [{ message: { content: 'ok' } }] };
  });

  await createOpenRouterChatCompletion({
    model: 'QWEN3.8',
    messages: [{ role: 'user', content: 'hello' }],
    reasoning: { effort: 'xhigh' },
    max_completion_tokens: 20000,
  });
  await createOpenRouterChatCompletion({
    model: 'QWEN3.8',
    messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'x' } }] }],
  });
  await createOpenRouterChatCompletion({
    model: 'QWEN3.8',
    messages: [{ role: 'user', content: 'return JSON' }],
    reasoning: { effort: 'low' },
    max_tokens: 16384,
    response_format: { type: 'json_object' },
    provider: { data_collection: 'deny' },
    plugins: [{ id: 'existing-plugin' }],
  });
  await createOpenRouterChatCompletion({
    model: 'QWEN3.8',
    messages: [{ role: 'user', content: 'large structured response' }],
    max_tokens: 50000,
  });
  await createOpenRouterChatCompletion({
    model: 'gemini-3.1-pro',
    messages: [{ role: 'user', content: 'hello' }],
  });
  await createOpenRouterChatCompletion({
    model: 'gpt-5.6-sol',
    messages: [{ role: 'user', content: 'hello' }],
  });

  assert.equal(payloads[0].model, 'qwen/qwen3.8-max');
  assert.equal(payloads[0].reasoning.effort, 'high');
  assert.equal(payloads[0].max_tokens, 20000);
  assert.equal(payloads[1].model, 'qwen/qwen3.8-max');
  assert.equal(payloads[1].max_tokens, 131072);
  assert.equal(payloads[2].model, 'qwen/qwen3.8-max');
  assert.equal(payloads[2].reasoning.effort, 'high');
  assert.equal(payloads[2].max_tokens, 16384);
  assert.deepEqual(payloads[2].provider, { data_collection: 'deny', require_parameters: true });
  assert.deepEqual(payloads[2].plugins, [{ id: 'existing-plugin' }, { id: 'response-healing' }]);
  assert.equal(payloads[3].model, 'qwen/qwen3.8-max');
  assert.equal(payloads[3].max_tokens, 50000);
  assert.equal(payloads[4].max_tokens, 65536);
  assert.equal(payloads[5].max_completion_tokens, 128000);
  assert.equal(options[0].maxRetries, 0);
  assert.equal(options[0].signal instanceof AbortSignal, true);
});
