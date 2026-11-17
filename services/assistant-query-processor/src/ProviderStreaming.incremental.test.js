import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sendAssistantOpenAICompletionRequest } from './OpenAI.js';
import { createQwenChatCompletion } from './Qwen.js';
import { createKimiK3ChatCompletion } from './KimiK3.js';
import { createAnthropicChatCompletion } from './AnthropicChatAdapter.js';
import { sendAssistantGeminiCompletionRequest } from './GoogleGemini.js';
import { createGenblazeChatCompletion, createOpenRouterChatCompletion, createSamsarExternalChatCompletion } from './SamsarExternalInferenceAdapter.js';

const messages = [{ role: 'user', content: 'Hello' }];
const usage = { prompt_tokens: 10, completion_tokens: 4 };
const reasoningModels = ['gpt-6.2-astra', 'gpt-6.1-sol', 'claude-opus-5.5', 'claude-fable-5.2']
  .flatMap(model => [model, `${model}-xhigh`]);
const allModels = [...reasoningModels, 'QWEN3.8', 'gemini-4-carbon', 'kimi-k3'];

function environment(t, values) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

// Withhold the provider's terminal event and HTTP EOF until the assertion has
// observed text. A prebuffered fixture cannot detect a wait-for-completion bug.
async function verifyIncremental(start) {
  let release, received, timer, settled = false;
  const final = new Promise(resolve => { release = resolve; });
  const first = new Promise(resolve => { received = resolve; });
  async function* events(initial, terminal) { yield* initial; await final; yield* terminal; }
  function sse(initial, terminal) {
    const encode = value => new TextEncoder().encode(typeof value === 'string' ? value : `data: ${JSON.stringify(value)}\n\n`);
    return new Response(new ReadableStream({
      async start(controller) {
        for (const event of initial) controller.enqueue(encode(event));
        await final;
        for (const event of terminal) controller.enqueue(encode(event));
        controller.close();
      },
    }), { headers: { 'Content-Type': 'text/event-stream' } });
  }
  const pending = Promise.resolve().then(() => start({
    events, sse, onText: text => { if (text) received(text); },
  })).finally(() => { settled = true; });
  try {
    assert.equal(await Promise.race([
      first,
      pending.then(() => { throw new Error('Adapter completed before delivering streamed text.'); }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Adapter buffered text until provider completion.')), 1500); }),
    ]), 'Hello');
    assert.equal(settled, false, 'Text must arrive while the provider response is still open.');
  } finally {
    clearTimeout(timer);
    release();
    await pending;
  }
  return pending;
}

function chatClient(fixture, model) {
  return { chat: { completions: { create: async payload => {
    assert.equal(payload.stream, true);
    assert.equal(payload.onText, undefined);
    return fixture.events([{ id: 'r', model, choices: [{ index: 0, delta: { content: 'Hello' } }] }], [
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }, { choices: [], usage },
    ]);
  } } } };
}

for (const model of reasoningModels.filter(model => model.startsWith('gpt-'))) {
  test(`native OpenAI ${model} delivers text before its final response`, async () => {
    const result = await verifyIncremental(fixture => sendAssistantOpenAICompletionRequest(messages, model, null, {
      onText: fixture.onText, maxRetries: 0,
    }, { client: { post: async (_url, options) => {
      assert.equal(options.body.stream, true);
      return fixture.events([{ type: 'response.output_text.delta', delta: 'Hello' }], [{ type: 'response.completed', response: {
        id: 'r', model, output: [], usage: { input_tokens: 10, output_tokens: 4 },
      } }]);
    } } }));
    assert.equal(result.outputText, 'Hello');
    assert.equal(result.response.usage.output_tokens, 4);
  });
}

for (const [name, model, create] of [
  ['native Qwen', 'QWEN3.8', createQwenChatCompletion],
  ['native Kimi', 'kimi-k3', createKimiK3ChatCompletion],
  ...allModels.filter(model => model !== 'kimi-k3').map(model => ['OpenRouter', model, createOpenRouterChatCompletion]),
]) {
  test(`${name} ${model} delivers text before provider finish and usage events`, async () => {
    const result = await verifyIncremental(fixture => {
      const client = chatClient(fixture, model);
      return create({ model, messages, onText: fixture.onText, maxRetries: 0 }, { client, openRouterClient: client });
    });
    assert.equal(result.choices[0].message.content, 'Hello');
    assert.deepEqual(result.usage, usage);
  });
}

for (const model of reasoningModels.filter(model => model.startsWith('claude-'))) {
  test(`native Anthropic ${model} delivers text before message_stop`, async () => {
    const result = await verifyIncremental(fixture => createAnthropicChatCompletion({ model, messages, onText: fixture.onText }, {
      env: { ANTHROPIC_API_KEY: 'test' }, fetchImpl: async (_url, options) => {
        assert.equal(JSON.parse(options.body).stream, true);
        return fixture.sse([
          { type: 'message_start', message: { id: 'r', usage: { input_tokens: 10, output_tokens: 0 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
        ], [{ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } }, { type: 'message_stop' }]);
      },
    }));
    assert.equal(result.choices[0].message.content, 'Hello');
    assert.equal(result.usage.completion_tokens, 4);
  });
}

test('native Gemini delivers text before its final usage and HTTP EOF', async () => {
  const result = await verifyIncremental(fixture => sendAssistantGeminiCompletionRequest(messages, 'gemini-4-carbon', {
    onText: fixture.onText, maxRetries: 0,
  }, {
    getGoogleCloudConfig: () => ({ projectId: 'test' }), getGoogleAccessToken: async () => 'test',
    fetchImpl: async url => {
      assert.match(url, /:streamGenerateContent\?alt=sse$/);
      return fixture.sse([{ candidates: [{ content: { parts: [{ text: 'Hello' }] } }] }], [
        { candidates: [{ finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4 } },
      ]);
    },
  }));
  assert.equal(result.outputText, 'Hello');
  assert.equal(result.response.usage.output_tokens, 4);
});

for (const model of allModels) {
  test(`hosted Samsar ${model} delivers text before the settled response`, async t => {
    environment(t, { CURRENT_ENV: 'docker', SAMSAR_DEPLOYMENT_EDITION: 'standalone', SAMSAR_QWEN_OPENROUTER_ONLY: 'false' });
    const result = await verifyIncremental(fixture => createSamsarExternalChatCompletion({
      model, messages, authorization: 'deployed', onText: fixture.onText, maxRetries: 0,
      assistantBillingRequestId: 'same-request',
    }, { client: {}, fetchImpl: async (_url, options) => {
      assert.equal(JSON.parse(options.body).stream, true);
      assert.equal(options.headers['Idempotency-Key'], 'same-request');
      return fixture.sse(['event: snapshot\ndata: {"text":"Hello"}\n\n'], [
        `event: completed\ndata: ${JSON.stringify({ response: { id: 'r', model, choices: [{ message: { content: 'Hello' } }], usage } })}\n\n`,
      ]);
    } }));
    assert.deepEqual(result.usage, usage);
  });
}

for (const model of ['gpt-6.2-astra', 'QWEN3.8', 'gemini-4-carbon']) {
  test(`GMICloud through Genblaze ${model} delivers text before completion`, async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-stream-catalog-'));
    const catalog = path.join(directory, 'models.json');
    fs.writeFileSync(catalog, JSON.stringify({ models: { [model]: { text: { modelId: model, operation: 'chat.completions' } } } }));
    const previous = process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH;
    process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH = catalog;
    t.after(() => {
      if (previous === undefined) delete process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH;
      else process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH = previous;
      fs.rmSync(directory, { recursive: true, force: true });
    });
    const result = await verifyIncremental(fixture => createGenblazeChatCompletion({
      model, messages, onText: fixture.onText, maxRetries: 0,
    }, { genblazeClient: chatClient(fixture, model) }));
    assert.deepEqual(result.usage, usage);
  });
}
