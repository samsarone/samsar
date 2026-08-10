import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_KIMI_K3_BASE_URL,
  KIMI_K3_PROVIDER_MODEL,
  KIMI_K3_REASONING_EFFORT,
  buildKimiK3ChatRequest,
  createKimiK3ChatCompletion,
  getKimiK3BaseURL,
  hasKimiK3NativeCredential,
} from '../src/KimiK3.js';
import { sendAssistantKimiK3CompletionRequest } from '../src/OpenAI.js';
import { createSamsarExternalChatCompletion } from '../src/SamsarExternalInferenceAdapter.js';

function retryOptions() {
  return {
    sleep: async () => {},
    logger: { error() {}, warn() {} },
  };
}

test('Kimi K3 uses the international endpoint and dedicated API key', () => {
  assert.equal(DEFAULT_KIMI_K3_BASE_URL, 'https://api.moonshot.ai/v1');
  assert.equal(getKimiK3BaseURL({}), DEFAULT_KIMI_K3_BASE_URL);
  assert.equal(
    getKimiK3BaseURL({ KIMI_K3_BASE_URL: 'https://custom.kimi.example/v1/' }),
    'https://custom.kimi.example/v1',
  );
  assert.equal(hasKimiK3NativeCredential({ KIMI_K3_API_KEY: 'kimi-key' }), true);
  assert.equal(hasKimiK3NativeCredential({ MOONSHOT_API_KEY: 'other-key' }), false);
});

test('Kimi request preserves chat contracts while forcing high reasoning and strict JSON', async () => {
  const client = {
    files: {
      create: async () => assert.fail('unexpected media upload'),
      delete: async () => {},
    },
  };
  const { payload } = await buildKimiK3ChatRequest({
    model: 'KIMIK3',
    effort: 'xhigh',
    reasoningEffort: 'xhigh',
    messages: [
      { role: 'developer', content: 'Return structured data.' },
      { role: 'user', content: 'Describe the current scene.' },
    ],
    reasoning_effort: 'low',
    reasoning: { effort: 'max' },
    temperature: 0,
    top_p: 0.5,
    n: 2,
    presence_penalty: 1,
    frequency_penalty: 1,
    max_tokens: 321,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'assistant_result',
        strict: false,
        schema: {
          type: 'object',
          properties: { answer: { type: 'string' } },
          required: ['answer'],
          additionalProperties: false,
        },
      },
    },
  }, { client });

  assert.equal(payload.model, KIMI_K3_PROVIDER_MODEL);
  assert.equal(payload.reasoning_effort, KIMI_K3_REASONING_EFFORT);
  assert.equal(payload.messages[0].role, 'system');
  assert.equal(payload.max_completion_tokens, 321);
  assert.equal(payload.response_format.json_schema.strict, true);
  for (const unsupported of [
    'temperature',
    'top_p',
    'n',
    'presence_penalty',
    'frequency_penalty',
    'effort',
    'reasoningEffort',
    'reasoning',
  ]) {
    assert.equal(Object.hasOwn(payload, unsupported), false);
  }
});

test('Kimi vision embeds mounted or remote images and removes provider-specific detail', async () => {
  const { payload } = await buildKimiK3ChatRequest({
    model: 'kimi-k3',
    messages: [{
      role: 'user',
      content: [{
        type: 'input_image',
        image_url: {
          url: 'http://localhost:3002/assets_v2/generations/session/frame.png',
          detail: 'high',
        },
      }],
    }],
  }, {
    client: { files: { delete: async () => {} } },
    readLocalMediaBuffer: async (source, { mediaKind }) => {
      assert.equal(
        source,
        'http://localhost:3002/assets_v2/generations/session/frame.png',
      );
      assert.equal(mediaKind, 'image');
      return Buffer.from([1, 2, 3]);
    },
    resolveMediaUrl: async () => assert.fail('mounted media must not use a tunnel'),
    fetch: async () => assert.fail('mounted media must not be fetched over HTTP'),
  });

  assert.equal(Array.isArray(payload.messages[0].content), true);
  assert.deepEqual(payload.messages[0].content[0], {
    type: 'image_url',
    image_url: {
      url: 'data:image/png;base64,AQID',
    },
  });
});

test('Kimi video uploads use Files API ms:// references and are cleaned up', async () => {
  const deletedFileIds = [];
  let capturedPayload;
  const client = {
    chat: {
      completions: {
        create: async (payload, options) => {
          capturedPayload = payload;
          assert.equal(options.maxRetries, 0);
          assert.equal(options.signal instanceof AbortSignal, true);
          return {
            id: 'chatcmpl-kimi',
            model: 'kimi-k3',
            choices: [{ message: { role: 'assistant', content: 'Scene reviewed.' } }],
            usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
          };
        },
      },
    },
    files: {
      create: async ({ purpose }) => {
        assert.equal(purpose, 'video');
        return { id: 'file-video-1' };
      },
      delete: async (fileId) => {
        deletedFileIds.push(fileId);
      },
    },
  };

  const response = await createKimiK3ChatCompletion({
    model: 'kimi-k3',
    messages: [{
      role: 'user',
      content: [{
        type: 'video_url',
        video_url: 'https://media.example/clip.mp4',
      }],
    }],
    maxRetries: 0,
  }, {
    client,
    readLocalMediaBuffer: async () => null,
    resolveMediaUrl: async (value) => value,
    fetch: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'video/mp4' },
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    }),
    retryOptions: retryOptions(),
  });

  assert.equal(response.model, 'kimi-k3');
  assert.deepEqual(capturedPayload.messages[0].content[0], {
    type: 'video_url',
    video_url: { url: 'ms://file-video-1' },
  });
  assert.deepEqual(deletedFileIds, ['file-video-1']);
});

test('assistant Kimi response remains Responses-compatible for persistence and billing', async () => {
  const client = {
    chat: {
      completions: {
        create: async (payload) => {
          assert.equal(payload.reasoning_effort, 'high');
          assert.equal(payload.response_format.json_schema.strict, true);
          return {
            id: 'chatcmpl-kimi-assistant',
            created: 1_720_000_000,
            model: 'kimi-k3',
            choices: [{ message: { role: 'assistant', content: 'A concise answer.' } }],
            usage: {
              prompt_tokens: 20,
              prompt_tokens_details: { cached_tokens: 5 },
              completion_tokens: 7,
              completion_tokens_details: { reasoning_tokens: 2 },
              total_tokens: 27,
            },
          };
        },
      },
    },
    files: { delete: async () => {} },
  };

  const result = await sendAssistantKimiK3CompletionRequest(
    [{ role: 'developer', content: 'Stay concise.' }, { role: 'user', content: 'Hello' }],
    'KIMIK3',
    {
      maxRetries: 0,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'assistant_answer',
          schema: {
            type: 'object',
            properties: { answer: { type: 'string' } },
            required: ['answer'],
            additionalProperties: false,
          },
        },
      },
    },
    { client, retryOptions: retryOptions() },
  );

  assert.equal(result.model, 'kimi-k3');
  assert.equal(result.externalProvider, 'kimi');
  assert.equal(result.outputText, 'A concise answer.');
  assert.equal(result.response.object, 'response');
  assert.equal(result.response.output_text, 'A concise answer.');
  assert.deepEqual(result.response.usage, {
    input_tokens: 20,
    input_tokens_details: { cached_tokens: 5 },
    output_tokens: 7,
    output_tokens_details: { reasoning_tokens: 2 },
    total_tokens: 27,
  });
});

test('Samsar fallback preserves Kimi structured output and enforces high reasoning', async () => {
  let capturedPayload;
  const response = await createSamsarExternalChatCompletion({
    model: 'KIMIK3',
    messages: [{ role: 'user', content: 'Return JSON.' }],
    reasoning_effort: 'low',
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'answer',
        strict: true,
        schema: {
          type: 'object',
          properties: { answer: { type: 'string' } },
          required: ['answer'],
          additionalProperties: false,
        },
      },
    },
    maxRetries: 0,
  }, {
    client: {
      createV2ExternalChatCompletion: async (payload) => {
        capturedPayload = payload;
        return {
          model: 'kimi-k3',
          choices: [{ message: { content: '{"answer":"ok"}' } }],
        };
      },
    },
    retryOptions: retryOptions(),
  });

  assert.equal(response.model, 'kimi-k3');
  assert.equal(capturedPayload.model, 'kimi-k3');
  assert.equal(capturedPayload.reasoning_effort, 'high');
  assert.equal(capturedPayload.response_format.type, 'json_schema');
});
