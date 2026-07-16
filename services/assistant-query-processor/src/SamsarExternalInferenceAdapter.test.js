import assert from 'node:assert/strict';
import test from 'node:test';
import OpenAI from 'openai';

import { createOpenRouterChatCompletion } from './SamsarExternalInferenceAdapter.js';

test('Qwen OpenRouter applies Plus routing, bounded settings, and abort support', async (t) => {
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
  delete process.env.OPENROUTER_QWEN_MAX_TOKENS;
  const payloads = [];
  const options = [];
  t.mock.method(OpenAI.Chat.Completions.prototype, 'create', async (payload, requestOptions) => {
    payloads.push(payload);
    options.push(requestOptions);
    return { choices: [{ message: { content: 'ok' } }] };
  });

  await createOpenRouterChatCompletion({
    model: 'QWEN3.7',
    messages: [{ role: 'user', content: 'hello' }],
    reasoning: { effort: 'xhigh' },
    max_completion_tokens: 20000,
  });
  await createOpenRouterChatCompletion({
    model: 'QWEN3.7',
    messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'x' } }] }],
  });
  await createOpenRouterChatCompletion({
    model: 'QWEN3.7',
    messages: [{ role: 'user', content: 'return JSON' }],
    reasoning: { effort: 'low' },
    max_tokens: 16384,
    response_format: { type: 'json_object' },
    provider: { data_collection: 'deny' },
    plugins: [{ id: 'existing-plugin' }],
  });

  assert.equal(payloads[0].model, 'qwen/qwen3.7-plus');
  assert.equal(payloads[0].reasoning.effort, 'high');
  assert.equal(payloads[0].max_tokens, 20000);
  assert.equal(payloads[1].model, 'qwen/qwen3.7-plus');
  assert.equal(payloads[1].max_tokens, 65536);
  assert.equal(payloads[2].reasoning.effort, 'high');
  assert.equal(payloads[2].max_tokens, 16384);
  assert.deepEqual(payloads[2].provider, { data_collection: 'deny', require_parameters: true });
  assert.deepEqual(payloads[2].plugins, [{ id: 'existing-plugin' }, { id: 'response-healing' }]);
  assert.equal(options[0].maxRetries, 0);
  assert.equal(options[0].signal instanceof AbortSignal, true);
});
