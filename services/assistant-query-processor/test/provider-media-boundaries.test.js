import assert from 'node:assert/strict';
import test from 'node:test';

import { sendAssistantGeminiCompletionRequest } from '../src/GoogleGemini.js';
import { sendAssistantOpenAICompletionRequest } from '../src/OpenAI.js';
import { createQwenChatCompletion } from '../src/Qwen.js';
import {
  createOpenRouterChatCompletion,
  createSamsarExternalChatCompletion,
} from '../src/SamsarExternalInferenceAdapter.js';

const ENV_KEYS = [
  'CURRENT_ENV',
  'OPENROUTER_API_KEY',
  'SAMSAR_API_KEY',
  'SAMSAR_QWEN_OPENROUTER_ONLY',
];
let originalEnv;

function retryOptions() {
  return {
    sleep: async () => {},
    logger: { error() {}, warn() {} },
  };
}

function retryableFailure(message = 'temporary provider failure') {
  const error = new Error(message);
  error.status = 500;
  return error;
}

function imageMessages() {
  return [{
    role: 'user',
    content: [{
      type: 'input_image',
      image_url: 'http://localhost:3002/assets_v2/generations/session/frame.png',
    }],
  }];
}

function rotatingResolver(calls, providerName) {
  return async (source, options) => {
    calls.push({ source, ...options });
    return `https://${providerName}-${calls.length}.trycloudflare.com/assets_v2/generations/session/frame.png`;
  };
}

test.beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.CURRENT_ENV = 'docker';
});

test.afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  originalEnv = null;
});

test('native Qwen rebuilds and freshly resolves its media payload on every retry attempt', async () => {
  const resolverCalls = [];
  const payloads = [];
  const requestOptions = [];
  const client = {
    chat: {
      completions: {
        create: async (payload, options) => {
          payloads.push(payload);
          requestOptions.push(options);
          if (payloads.length === 1) throw retryableFailure();
          return { model: payload.model, choices: [{ message: { content: 'ok' } }] };
        },
      },
    },
  };

  await createQwenChatCompletion({
    model: 'QWEN3.7',
    messages: imageMessages(),
    maxRetries: 1,
  }, {
    client,
    resolveMediaUrl: rotatingResolver(resolverCalls, 'qwen'),
    retryOptions: retryOptions(),
  });

  assert.equal(payloads.length, 2);
  assert.equal(resolverCalls.length, 2);
  assert.equal(payloads[0].messages[0].content[0].image_url.url.includes('qwen-1.'), true);
  assert.equal(payloads[1].messages[0].content[0].image_url.url.includes('qwen-2.'), true);
  assert.notEqual(payloads[0], payloads[1]);
  assert.equal(requestOptions.every((options) => options.maxRetries === 0), true);
  assert.equal(requestOptions.every((options) => options.signal instanceof AbortSignal), true);
});

test('OpenRouter rebuilds and freshly resolves its media payload inside each external retry', async () => {
  const resolverCalls = [];
  const payloads = [];
  const client = {
    chat: {
      completions: {
        create: async (payload) => {
          payloads.push(payload);
          if (payloads.length === 1) throw retryableFailure();
          return { choices: [{ message: { content: 'ok' } }] };
        },
      },
    },
  };

  await createOpenRouterChatCompletion({
    model: 'QWEN3.7',
    messages: imageMessages(),
    maxRetries: 1,
  }, {
    client,
    resolveMediaUrl: rotatingResolver(resolverCalls, 'openrouter'),
    retryOptions: retryOptions(),
  });

  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].messages[0].content[0].image_url.includes('openrouter-1.'), true);
  assert.equal(payloads[1].messages[0].content[0].image_url.includes('openrouter-2.'), true);
});

test('Samsar external inference rebuilds and freshly resolves media inside each SDK retry', async () => {
  const resolverCalls = [];
  const payloads = [];
  const client = {
    createV2ExternalChatCompletion: async (payload) => {
      payloads.push(payload);
      if (payloads.length === 1) throw retryableFailure();
      return { choices: [{ message: { content: 'ok' } }] };
    },
  };

  await createSamsarExternalChatCompletion({
    model: 'gpt-5.6-sol',
    authorization: 'deployed',
    messages: imageMessages(),
    maxRetries: 1,
  }, {
    client,
    resolveMediaUrl: rotatingResolver(resolverCalls, 'samsar'),
    retryOptions: retryOptions(),
  });

  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].messages[0].content[0].image_url.includes('samsar-1.'), true);
  assert.equal(payloads[1].messages[0].content[0].image_url.includes('samsar-2.'), true);
});

test('OpenAI Responses disables SDK retries and rebuilds media for each owned retry attempt', async () => {
  const resolverCalls = [];
  const bodies = [];
  const options = [];
  const client = {
    post: async (_path, request) => {
      bodies.push(request.body);
      options.push(request);
      if (bodies.length === 1) throw retryableFailure();
      return { model: 'gpt-5.6-sol', output_text: 'ok', output: [] };
    },
    chat: { completions: { create: async () => assert.fail('chat fallback was not expected') } },
  };

  await sendAssistantOpenAICompletionRequest(
    imageMessages(),
    'gpt-5.6-sol',
    'xhigh',
    { maxRetries: 1 },
    {
      client,
      resolveMediaUrl: rotatingResolver(resolverCalls, 'openai'),
      retryOptions: retryOptions(),
    },
  );

  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].input[0].content[0].image_url.includes('openai-1.'), true);
  assert.equal(bodies[1].input[0].content[0].image_url.includes('openai-2.'), true);
  assert.equal(options.every((request) => request.maxRetries === 0), true);
});

test('OpenAI chat fallback expands media arrays and freshly resolves every fallback retry', async () => {
  const resolverCalls = [];
  const chatPayloads = [];
  let responseCalls = 0;
  const messages = [{
    role: 'user',
    content: [{
      type: 'input_image',
      sources: [
        'http://localhost:3002/assets_v2/generations/session/one.png',
        { uri: 'http://localhost:3002/assets_v2/generations/session/two.png' },
      ],
    }],
  }];
  const resolver = async (source, options) => {
    resolverCalls.push({ source, ...options });
    const fileName = source.includes('two.png') ? 'two.png' : 'one.png';
    return `https://openai-chat-${resolverCalls.length}.trycloudflare.com/assets_v2/generations/session/${fileName}`;
  };
  const client = {
    post: async () => {
      responseCalls += 1;
      const error = new Error('Responses endpoint unavailable');
      error.status = 404;
      throw error;
    },
    chat: {
      completions: {
        create: async (payload) => {
          chatPayloads.push(payload);
          if (chatPayloads.length === 1) throw retryableFailure();
          return { model: 'legacy-chat-model', choices: [{ message: { content: 'ok' } }] };
        },
      },
    },
  };

  await sendAssistantOpenAICompletionRequest(
    messages,
    'gpt-5.6-sol',
    'xhigh',
    { maxRetries: 1 },
    {
      client,
      resolveMediaUrl: resolver,
      shouldFallbackToChatCompletions: () => true,
      retryOptions: retryOptions(),
    },
  );

  assert.equal(responseCalls, 1);
  assert.equal(chatPayloads.length, 2);
  assert.equal(chatPayloads[0].messages[0].content.length, 2);
  assert.equal(chatPayloads[1].messages[0].content.length, 2);
  const firstAttemptUrls = chatPayloads[0].messages[0].content.map((part) => part.image_url.url);
  const secondAttemptUrls = chatPayloads[1].messages[0].content.map((part) => part.image_url.url);
  assert.equal(firstAttemptUrls.every((url) => url.includes('openai-chat-3.') || url.includes('openai-chat-4.')), true);
  assert.equal(secondAttemptUrls.every((url) => url.includes('openai-chat-5.') || url.includes('openai-chat-6.')), true);
});

test('Gemini rereads mounted image bytes without a tunnel when the provider request retries', async () => {
  const readImages = [];
  const providerBodies = [];
  let providerAttempt = 0;
  const fetchImpl = async (url, options = {}) => {
    providerAttempt += 1;
    providerBodies.push(JSON.parse(options.body));
    if (providerAttempt === 1) {
      return {
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ error: { message: 'temporary Gemini failure' } }),
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'ok' }] } }],
      }),
    };
  };

  const result = await sendAssistantGeminiCompletionRequest(
    imageMessages(),
    'gemini-3.1-pro',
    { maxRetries: 1 },
    {
      fetchImpl,
      getGoogleCloudConfig: () => ({ projectId: 'test-project' }),
      getGoogleAccessToken: async () => 'test-token',
      resolveMediaUrl: async () => {
        throw new Error('Gemini inlineData must not create a provider tunnel.');
      },
      readLocalMediaBuffer: async (source, { mediaKind }) => {
        assert.equal(mediaKind, 'image');
        readImages.push(source);
        return Buffer.from(readImages.length === 1 ? [1, 2, 3] : [4, 5, 6]);
      },
      retryOptions: retryOptions(),
    },
  );

  assert.equal(result.outputText, 'ok');
  assert.deepEqual(readImages, [
    'http://localhost:3002/assets_v2/generations/session/frame.png',
    'http://localhost:3002/assets_v2/generations/session/frame.png',
  ]);
  assert.equal(providerBodies.length, 2);
  assert.deepEqual(providerBodies[0].contents[0].parts[0].inlineData, {
    mimeType: 'image/png',
    data: 'AQID',
  });
  assert.equal(providerBodies[1].contents[0].parts[0].inlineData.data, 'BAUG');
});
