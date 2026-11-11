import assert from 'node:assert/strict';
import test from 'node:test';
import { sendAssistantOpenAICompletionRequest } from './OpenAI.js';
import { createQwenChatCompletion } from './Qwen.js';
import { createKimiK3ChatCompletion } from './KimiK3.js';
import { createOpenRouterChatCompletion } from './SamsarExternalInferenceAdapter.js';
import { createAnthropicChatCompletion } from './AnthropicChatAdapter.js';
import { sendAssistantGeminiCompletionRequest } from './GoogleGemini.js';

const messages = [{ role: 'user', content: 'hello' }];
const usage = { prompt_tokens: 10, completion_tokens: 4 };
async function* events(values) { yield* values; }
function sse(values) { return new Response(values.map(data => `data: ${JSON.stringify(data)}\n\n`).join('')); }

for (const [name, create, model] of [
  ['Qwen', createQwenChatCompletion, 'qwen3.8-max'],
  ['Kimi', createKimiK3ChatCompletion, 'kimi-k3'],
  ['OpenRouter', createOpenRouterChatCompletion, 'gpt-6-astra'],
]) {
  test(`${name} requests streaming and retains provider usage through its real adapter`, async () => {
    const texts = [];
    const client = { chat: { completions: { create: async payload => {
      assert.equal(payload.stream, true);
      assert.equal(payload.stream_options.include_usage, true);
      assert.equal(payload.onText, undefined);
      return events([{ id: 'r', model, choices: [{ delta: { content: 'Hello' }, finish_reason: 'stop' }] }, { choices: [], usage }]);
    } } } };
    const result = await create({ messages, model, onText: text => texts.push(text), maxRetries: 0 }, { client });
    assert.deepEqual(texts, ['Hello']);
    assert.deepEqual(result.usage, usage);
  });
}

test('OpenAI Responses streams through the worker and returns the final raw usage', async () => {
  const texts = [];
  const response = { id: 'r', model: 'gpt-6-astra', output_text: 'Hello', output: [], usage: { input_tokens: 10, output_tokens: 4 } };
  const client = { post: async (_path, options) => {
    assert.equal(options.body.stream, true);
    assert.equal(options.stream, true);
    return events([{ type: 'response.output_text.delta', delta: 'Hello' }, { type: 'response.completed', response }]);
  } };
  const result = await sendAssistantOpenAICompletionRequest(messages, 'gpt-6-astra', 'high', {
    onText: text => texts.push(text), maxRetries: 0,
  }, { client });
  assert.deepEqual(texts, ['Hello']);
  assert.deepEqual(result.response.usage, response.usage);
});

test('native Claude switches to SSE and preserves cache accounting', async () => {
  const texts = [];
  const result = await createAnthropicChatCompletion({ model: 'claude-opus-5.5', messages, onText: text => texts.push(text) }, {
    env: { ANTHROPIC_API_KEY: 'test' }, fetchImpl: async (_url, init) => {
      assert.equal(JSON.parse(init.body).stream, true);
      return sse([
        { type: 'message_start', message: { id: 'a', usage: { input_tokens: 10, cache_read_input_tokens: 3, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } }, { type: 'message_stop' },
      ]);
    },
  });
  assert.deepEqual(texts, ['Hello']);
  assert.equal(result.usage.prompt_tokens, 13);
  assert.equal(result.usage.prompt_tokens_details.cached_tokens, 3);
  assert.equal(result.usage.completion_tokens, 4);
});

test('native Gemini selects streaming endpoint and includes billed thinking tokens', async () => {
  const texts = [];
  const result = await sendAssistantGeminiCompletionRequest(messages, 'gemini-4-carbon', {
    onText: text => texts.push(text), maxRetries: 0,
  }, {
    getGoogleCloudConfig: () => ({ projectId: 'test' }), getGoogleAccessToken: async () => 'token',
    fetchImpl: async (url, init) => {
      assert.equal(JSON.parse(init.body).generationConfig.thinkingConfig.thinkingLevel, 'HIGH');
      assert.match(url, /:streamGenerateContent\?alt=sse$/);
      return sse([{ candidates: [{ content: { parts: [{ text: 'Hello' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, thoughtsTokenCount: 2, totalTokenCount: 16 } }]);
    },
  });
  assert.deepEqual(texts, ['Hello']);
  assert.equal(result.response.usage.output_tokens, 6);
});

test('Claude cannot turn a missing final output receipt into a free completion', async () => {
  const result = await createAnthropicChatCompletion({ model: 'claude-opus-5.5', messages, onText() {} }, {
    env: { ANTHROPIC_API_KEY: 'test' }, fetchImpl: async () => sse([
      { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0 } } }, { type: 'message_stop' },
    ]),
  });
  assert.equal(result.usage, null);
});
