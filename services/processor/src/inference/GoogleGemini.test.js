import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createGoogleGeminiChatCompletion,
  normalizeGeminiUsage,
  normalizeJsonSchemaForGemini,
} from './GoogleGemini.js';

test('normalizeJsonSchemaForGemini removes empty enum values rejected by Vertex', () => {
  const schema = {
    type: 'object',
    properties: {
      sounds: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            gender: {
              type: 'string',
              enum: ['M', 'F', ''],
              description: 'Use an empty string only for sound_effect items.',
            },
          },
        },
      },
    },
  };

  const normalized = normalizeJsonSchemaForGemini(schema);

  assert.deepEqual(
    normalized.properties.sounds.items.properties.gender.enum,
    ['M', 'F'],
  );
  assert.equal(
    normalized.properties.sounds.items.properties.gender.description,
    'Use an empty string only for sound_effect items.',
  );
});

test('normalizeGeminiUsage includes thinking tokens in billable output tokens', () => {
  const usage = normalizeGeminiUsage({
    promptTokenCount: 100,
    candidatesTokenCount: 20,
    thoughtsTokenCount: 7,
    cachedContentTokenCount: 10,
    totalTokenCount: 127,
  });

  assert.equal(usage.prompt_tokens, 100);
  assert.equal(usage.completion_tokens, 27);
  assert.equal(usage.output_tokens, 27);
  assert.equal(usage.completion_tokens_details.reasoning_tokens, 7);
  assert.equal(usage.total_tokens, 127);
});

test('native Google Gemini reads mounted image media before building inline provider content', async () => {
  let capturedRequestBody;
  const messages = [{
    role: 'user',
    content: [{
      type: 'input_image',
      image_url: 'http://localhost:3002/assets_v2/generations/session/gemini.png',
    }],
  }];
  const originalMessages = JSON.parse(JSON.stringify(messages));

  const response = await createGoogleGeminiChatCompletion({
    model: 'gemini-3.1-pro',
    projectId: 'gemini-media-project',
    messages,
  }, {
    resolveMediaUrl: async () => {
      throw new Error('Gemini inlineData must not create a provider tunnel.');
    },
    readLocalMediaBuffer: async (source) => {
      assert.equal(source, 'http://localhost:3002/assets_v2/generations/session/gemini.png');
      return Buffer.from('ABC');
    },
    getAccessToken: async () => 'google-access-token',
    fetch: async (_url, options) => {
      capturedRequestBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          responseId: 'gemini-media-response',
          candidates: [{ index: 0, content: { parts: [{ text: 'seen' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
        }),
      };
    },
  });

  assert.deepEqual(messages, originalMessages);
  assert.deepEqual(capturedRequestBody.contents[0].parts[0], {
    inlineData: { mimeType: 'image/png', data: 'QUJD' },
  });
  assert.equal(response.choices[0].message.content, 'seen');
});
