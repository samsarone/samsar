import assert from 'node:assert/strict';
import test from 'node:test';

import { sendAssistantGeminiCompletionRequest } from '../src/GoogleGemini.js';

test('Google Gemini reads mounted Docker media directly for inlineData', async () => {
  let capturedBody;
  const source = 'http://localhost:3002/assets_v2/generations/session/frame.webp';

  const result = await sendAssistantGeminiCompletionRequest([{
    role: 'user',
    content: [{ type: 'input_image', source: { url: source } }],
  }], 'gemini-4-carbon', {}, {
    getGoogleCloudConfig: () => ({ projectId: 'gemini-inline-project' }),
    getGoogleAccessToken: async () => 'token',
    resolveMediaUrl: async () => {
      throw new Error('Gemini inlineData must not create a public tunnel.');
    },
    readLocalMediaBuffer: async (value, { mediaKind }) => {
      assert.equal(value, source);
      assert.equal(mediaKind, 'image');
      return Buffer.from('mounted-image');
    },
    fetchImpl: async (_url, options) => {
      capturedBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'seen' }] } }],
        }),
      };
    },
  });

  assert.deepEqual(capturedBody.contents[0].parts[0], {
    inlineData: {
      mimeType: 'image/webp',
      data: Buffer.from('mounted-image').toString('base64'),
    },
  });
  assert.equal(result.outputText, 'seen');
});

test('versioned Carbon keeps native sampling and trims trailing model turns', async () => {
  let capturedUrl;
  let capturedBody;
  await sendAssistantGeminiCompletionRequest([
    { role: 'user', content: 'First prompt' },
    { role: 'assistant', content: 'Previous answer' },
  ], 'gemini-4-carbon', {
    model: 'gemini-4-carbon-20261110',
    temperature: 0.5,
    top_p: 0.8,
    max_tokens: 50000,
    thinkingLevel: 'MEDIUM',
  }, {
    getGoogleCloudConfig: () => ({ projectId: 'argon-shape-project' }),
    getGoogleAccessToken: async () => 'test-token',
    fetchImpl: async (url, options) => {
      capturedUrl = url;
      capturedBody = JSON.parse(options.body);
      return { ok: true, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }) };
    },
  });

  assert.match(capturedUrl, /models\/gemini-4-carbon-20261110:generateContent$/);
  assert.deepEqual(capturedBody.contents.map(({ role }) => role), ['user']);
  assert.equal(capturedBody.generationConfig.temperature, undefined);
  assert.equal(capturedBody.generationConfig.topP, undefined);
  assert.equal(capturedBody.generationConfig.maxOutputTokens, 32768);
  assert.deepEqual(capturedBody.generationConfig.thinkingConfig, { thinkingLevel: 'MEDIUM' });
});
