import assert from 'node:assert/strict';
import test from 'node:test';
import { createCompatibleChatCompletion, runInferenceAdapterFallback } from '../models/ai_utils/OpenAICompat.js';
import { createOpenRouterChatCompletion, createSamsarExternalChatCompletion } from '../models/ai_utils/SamsarExternalInferenceAdapter.js';
import { createAlibabaQwenChatCompletion } from './AlibabaQwen.js';
import { createKimiK3ChatCompletion } from './KimiK3.js';
import { createGoogleGeminiChatCompletion } from './GoogleGemini.js';
import { createAnthropicChatCompletion } from './AnthropicChatAdapter.js';
const messages = [{ role: 'user', content: 'hello' }];
const usage = { prompt_tokens: 10, completion_tokens: 4 };
async function* events(values) { yield* values; }
function sse(values) { return new Response(values.map(data => `data: ${JSON.stringify(data)}\n\n`).join('')); }

for (const [name, create, model] of [
  ['Qwen', createAlibabaQwenChatCompletion, 'qwen3.8-max'],
  ['Kimi', createKimiK3ChatCompletion, 'kimi-k3'],
  ['OpenRouter', createOpenRouterChatCompletion, 'gpt-6-astra'],
]) {
  test(`${name} processor adapter requests usage-bearing streaming without exposing internal callbacks`, async () => {
    const texts = [];
    const client = { chat: { completions: { create: async payload => {
      assert.equal(payload.stream, true);
      assert.equal(payload.stream_options.include_usage, true);
      assert.equal(payload.onText, undefined);
      return events([{ id: 'r', model, choices: [{ delta: { content: 'Hello' }, finish_reason: 'stop' }] }, { choices: [], usage }]);
    } } } };
    const result = await create({ messages, model, onText: text => texts.push(text), maxRetries: 0 }, { client, openRouterClient: client });
    assert.deepEqual(texts, ['Hello']);
    assert.deepEqual(result.usage, usage);
  });
}

test('processor OpenAI compatibility layer preserves final Responses usage and REST completion shape', async () => {
  const texts = [];
  const result = await createCompatibleChatCompletion({ post: async (_path, options) => {
    assert.equal(options.body.stream, true);
    return events([{ type: 'response.output_text.delta', delta: 'Hello' }, { type: 'response.completed', response: {
      id: 'r', model: 'gpt-6-astra', output: [], usage: { input_tokens: 10, output_tokens: 4 },
    } }]);
  } }, { model: 'gpt-6-astra', messages, bypassSamsarExternalInference: true, onText: text => texts.push(text) });
  assert.deepEqual(texts, ['Hello']);
  assert.equal(result.choices[0].message.content, 'Hello');
  assert.equal(result.usage.output_tokens, 4);
});

test('Gemini processor streams natively and prices visible plus thinking tokens', async () => {
  const texts = [];
  const result = await createGoogleGeminiChatCompletion({ model: 'gemini-4-carbon', projectId: 'test', messages, onText: text => texts.push(text) }, {
    getAccessToken: async () => 'test', fetch: async url => {
      assert.match(url, /:streamGenerateContent\?alt=sse$/);
      return sse([{ candidates: [{ content: { parts: [{ text: 'Hello' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, thoughtsTokenCount: 2, totalTokenCount: 16 } }]);
    },
  });
  assert.deepEqual(texts, ['Hello']);
  assert.equal(result.usage.completion_tokens, 6);
});

test('Claude processor preserves final streamed usage and cache reads', async () => {
  const result = await createAnthropicChatCompletion({ model: 'claude-opus-5.5', messages, onText() {} }, {
    env: { ANTHROPIC_API_KEY: 'test' }, fetchImpl: async (_url, init) => {
      assert.equal(JSON.parse(init.body).stream, true);
      return sse([{ type: 'message_start', message: { usage: { input_tokens: 10, cache_read_input_tokens: 2 } } },
        { type: 'message_delta', usage: { output_tokens: 4 } }, { type: 'message_stop' }]);
    },
  });
  assert.equal(result.usage.prompt_tokens, 12);
  assert.equal(result.usage.completion_tokens, 4);
});

test('an interrupted stream cannot fall through to another billable provider', async () => {
  let calls = 0;
  await assert.rejects(runInferenceAdapterFallback(['native', 'openrouter'], async () => {
    calls++;
    throw Object.assign(new Error('Interrupted'), { code: 'ASSISTANT_STREAM_INTERRUPTED', status: 502, retryable: false });
  }), { code: 'ASSISTANT_STREAM_INTERRUPTED' });
  assert.equal(calls, 1);
});


test('hosted Samsar SSE overrides internal polling and keeps the same request key', async () => {
  const texts = [];
  const result = await createSamsarExternalChatCompletion({ model: 'gpt-6-astra', messages,
    authorization: 'deployed', externalPolling: true, assistantBillingRequestId: 'stable-request',
    onText: text => texts.push(text), maxRetries: 0,
  }, { client: {}, fetchImpl: async (url, init) => {
    assert.match(url, /\/v2\/external\/chat\/completions$/);
    assert.equal(init.headers['Idempotency-Key'], 'stable-request');
    assert.equal(JSON.parse(init.body).stream, true);
    return new Response('event: snapshot\ndata: {"text":"Hello"}\n\nevent: completed\ndata: {"response":{"id":"hosted","usage":{"prompt_tokens":10,"completion_tokens":4}}}\n\n');
  } });
  assert.deepEqual(texts, ['Hello']);
  assert.equal(result.id, 'hosted');
  assert.deepEqual(result.usage, usage);
});
