import test from 'node:test';
import assert from 'node:assert/strict';
import { readSSE, collectChatStream, createStreamingChatCompletion, createStreamingResponses,
  collectAnthropicStream, collectGeminiStream, requestSamsarStream } from './ProviderStreaming.js';
const usage = { prompt_tokens: 10, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 3 } };
async function* events(values) { for (const value of values) yield value; }
function body(values) { return new Response(values.map(value => `data: ${JSON.stringify(value)}\r\n\r\n`).join('')).body; }
const chunks = [
  { id: 'one', model: 'gpt-6-astra', choices: [{ index: 0, delta: { content: 'Hello' } }] },
  { choices: [{ index: 0, delta: { content: ' world' }, finish_reason: 'stop' }] },
  { choices: [], usage },
];

test('chat streaming delivers cumulative text and waits beyond finish_reason for final usage', async () => {
  const texts = [];
  const result = await collectChatStream(events(chunks), text => texts.push(text));
  assert.deepEqual(texts, ['Hello', 'Hello world']);
  assert.equal(result.choices[0].message.content, 'Hello world');
  assert.deepEqual(result.usage, usage);
});
test('repeated cumulative usage is not added and empty accounting choices are accepted', async () => {
  const result = await collectChatStream(events([...chunks, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage }]));
  assert.equal(result.usage.completion_tokens, 4);
});
test('missing final usage stays missing, never becomes an invented zero-cost receipt', async () => {
  const result = await collectChatStream(events(chunks.slice(0, 2)));
  assert.equal(result.usage, null);
});
test('truncation and mid-stream error events cannot be retried as fresh inference', async () => {
  for (const input of [chunks.slice(0, 1), [chunks[0], { error: { message: 'Overloaded' } }],
    [chunks[0], { choices: [{ finish_reason: 'error' }] }]]) {
    await assert.rejects(collectChatStream(events(input)), { code: 'ASSISTANT_STREAM_INTERRUPTED', retryable: false });
  }
});
test('delivery callback failures do not lose billable provider usage', async () => {
  const result = await collectChatStream(events(chunks), () => { throw new Error('Mongo unavailable'); });
  assert.deepEqual(result.usage, usage);
});
test('REST calls preserve a complete result and streaming enables usage without leaking callback fields', async () => {
  const calls = [];
  const final = { id: 'rest', usage };
  const client = { chat: { completions: { create: async (payload, options) => {
    calls.push({ payload, options }); return payload.stream ? events(chunks) : final;
  } } } };
  assert.equal(await createStreamingChatCompletion(client, { model: 'model' }, {}), final);
  const result = await createStreamingChatCompletion(client, { model: 'model', onText() {} }, {});
  assert.equal(result.id, 'one');
  assert.equal(calls[1].payload.stream, true);
  assert.equal(calls[1].payload.stream_options.include_usage, true);
  assert.equal('onText' in calls[1].payload, false);
  assert.equal(calls[1].options.maxRetries, 0);
});
test('Responses streaming keeps full final usage, reasoning and output metadata', async () => {
  const final = { id: 'r', model: 'model', usage: { input_tokens: 7, output_tokens: 8, output_tokens_details: { reasoning_tokens: 5 } }, output: [] };
  const texts = [];
  const client = { post: async (path, options) => {
    assert.equal(path, '/responses'); assert.equal(options.stream, true);
    return events([{ type: 'response.output_text.delta', delta: 'Hi' }, { type: 'response.completed', response: final }]);
  } };
  assert.equal(await createStreamingResponses(client, {}, {}, text => texts.push(text)), final);
  assert.deepEqual(texts, ['Hi']);
});
test('SSE parser handles fragmented UTF-8, comments, CRLF and multi-line data', async () => {
  const bytes = new TextEncoder().encode(': heartbeat\r\nevent: sample\r\ndata: {"text":\r\ndata: "你好"}\r\n\r\n');
  const parsed = [];
  for await (const value of readSSE(events([...bytes].map(byte => new Uint8Array([byte]))))) parsed.push(value);
  assert.equal(parsed[0].event, 'sample');
  assert.equal(JSON.parse(parsed[0].data).text, '你好');
});
test('Claude preserves input/cache usage and replaces cumulative output usage', async () => {
  const texts = [];
  const result = await collectAnthropicStream(body([
    { type: 'message_start', message: { id: 'c', model: 'claude', usage: { input_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 2, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'private' } },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Answer' } },
    { type: 'message_delta', usage: { output_tokens: 2 } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } },
    { type: 'message_stop' },
  ]), text => texts.push(text));
  assert.deepEqual(texts, ['Answer']);
  assert.equal(result.usage.output_tokens, 4);
  assert.equal(result.usage.cache_read_input_tokens, 5);
  assert.equal(result.usage.input_tokens, 10);
});
test('Gemini streams answer text only and retains final usage including thought/cache counts', async () => {
  const texts = [];
  const metadata = { promptTokenCount: 10, candidatesTokenCount: 4, thoughtsTokenCount: 7, cachedContentTokenCount: 3 };
  const result = await collectGeminiStream(body([
    { candidates: [{ content: { parts: [{ thought: true, text: 'private' }, { text: 'Hello' }] } }] },
    { candidates: [{ content: { parts: [{ text: ' world' }] }, finishReason: 'STOP' }], usageMetadata: metadata },
  ]), text => texts.push(text));
  assert.deepEqual(texts, ['Hello', 'Hello world']);
  assert.deepEqual(result.usageMetadata, metadata);
});
test('native providers reject malformed or prematurely terminated streams', async () => {
  await assert.rejects(collectAnthropicStream(body([{ type: 'message_start', message: {} }])) , { code: 'ASSISTANT_STREAM_INTERRUPTED' });
  await assert.rejects(collectGeminiStream(new Response('data: broken\n\n').body), { code: 'ASSISTANT_STREAM_INTERRUPTED' });
});
test('Samsar streaming propagates one billing identity and returns the settled response', async () => {
  const texts = [];
  const result = await requestSamsarStream({ url: 'https://processor.test/v2/external/chat/completions', headers: { 'Idempotency-Key': 'same' },
    payload: { messages: [] }, onText: text => texts.push(text), fetchImpl: async (_url, init) => {
      assert.equal(init.headers['Idempotency-Key'], 'same');
      assert.equal(JSON.parse(init.body).stream, true);
      return new Response('event: snapshot\ndata: {"text":"Hi"}\n\nevent: completed\ndata: {"response":{"id":"r","usage":{"prompt_tokens":10,"completion_tokens":4}},"creditsCharged":1}\n\n');
    } });
  assert.deepEqual(texts, ['Hi']); assert.equal(result.id, 'r'); assert.equal(result.samsarBilling.adapter, 'samsar');
});


test('partial Responses accounting cannot silently invent zero output usage', async () => {
  const client = { post: async () => events([{ type: 'response.completed', response: { id: 'r', usage: { input_tokens: 12 } } }]) };
  const result = await createStreamingResponses(client, {}, {}, () => {});
  assert.equal(result.usage, null);
});
