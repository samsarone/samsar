import assert from 'node:assert/strict';
import test from 'node:test';

import { INFERENCE_MODELS } from '../../consts/InferenceModels.js';
import { createCompatibleChatCompletion } from './OpenAICompat.js';

test('forces high reasoning for GPT 5.6 Sol Responses requests', async () => {
  let capturedPath;
  let capturedBody;
  const openaiClient = {
    async post(path, options) {
      capturedPath = path;
      capturedBody = options.body;
      return {
        id: 'resp-test',
        model: 'gpt-5.6-sol',
        output_text: 'ok',
      };
    },
  };

  const response = await createCompatibleChatCompletion(openaiClient, {
    model: 'gpt-5.6-sol',
    messages: [{ role: 'user', content: 'hello' }],
    reasoning: { effort: 'low' },
  });

  assert.equal(capturedPath, '/responses');
  assert.deepEqual(capturedBody.reasoning, { effort: 'high' });
  assert.equal(response.choices[0].message.content, 'ok');
});

test('preserves GPT 5.6 Luna and forces xhigh for publication metadata requests', async () => {
  let capturedBody;
  const openaiClient = {
    async post(_path, options) {
      capturedBody = options.body;
      return {
        id: 'resp-metadata-test',
        model: INFERENCE_MODELS.PublicationMetadata,
        output_text: 'metadata',
      };
    },
  };

  await createCompatibleChatCompletion(openaiClient, {
    model: INFERENCE_MODELS.PublicationMetadata,
    messages: [{ role: 'user', content: 'generate metadata' }],
    reasoning: { effort: 'low' },
  });

  assert.equal(capturedBody.model, 'gpt-5.6-luna');
  assert.deepEqual(capturedBody.reasoning, { effort: 'xhigh' });
});

test('resolves multimodal media immediately before a native OpenAI Responses request', async () => {
  let capturedBody;
  let capturedOptions;
  const sourceMessages = [{
    role: 'user',
    content: [{
      type: 'image_url',
      image_url: {
        url: 'http://localhost:3002/assets_v2/generations/session/frame.png',
        detail: 'high',
      },
    }],
  }];
  const originalMessages = JSON.parse(JSON.stringify(sourceMessages));
  const openaiClient = {
    async post(_path, options) {
      capturedOptions = options;
      capturedBody = options.body;
      return { id: 'resp-media-test', model: 'gpt-5.6-sol', output_text: 'seen' };
    },
  };

  await createCompatibleChatCompletion(openaiClient, {
    model: 'gpt-5.6-sol',
    messages: sourceMessages,
  }, {
    resolveMediaUrl: async (source, options) => {
      assert.equal(source, originalMessages[0].content[0].image_url.url);
      assert.deepEqual(options, {
        mediaKind: 'image',
        serviceName: 'samsar_processor_openai_responses',
      });
      return 'https://fresh.example/assets_v2/generations/session/frame.png';
    },
  });

  assert.deepEqual(sourceMessages, originalMessages);
  assert.deepEqual(capturedBody.input[0].content[0], {
    type: 'input_image',
    image_url: 'https://fresh.example/assets_v2/generations/session/frame.png',
    detail: 'high',
  });
  assert.equal(capturedOptions.maxRetries, 0);
});

test('routes Kimi K3 through its native high-reasoning chat adapter', async () => {
  let capturedPayload;
  const kimiClient = {
    chat: {
      completions: {
        create: async (payload) => {
          capturedPayload = payload;
          return {
            model: 'kimi-k3',
            choices: [{ message: { role: 'assistant', content: '{"ok":true}' } }],
          };
        },
      },
    },
    files: {
      create: async () => assert.fail('unexpected upload'),
      delete: async () => {},
    },
  };

  const response = await createCompatibleChatCompletion({}, {
    model: 'KIMIK3',
    messages: [{ role: 'developer', content: 'Return JSON.' }],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'result',
        schema: {
          type: 'object',
          properties: { ok: { type: 'boolean' } },
          required: ['ok'],
          additionalProperties: false,
        },
      },
    },
  }, { client: kimiClient });

  assert.equal(capturedPayload.model, 'kimi-k3');
  assert.equal(capturedPayload.reasoning_effort, 'high');
  assert.equal(capturedPayload.messages[0].role, 'system');
  assert.equal(capturedPayload.response_format.json_schema.strict, true);
  assert.equal(response.choices[0].message.content, '{"ok":true}');
});
