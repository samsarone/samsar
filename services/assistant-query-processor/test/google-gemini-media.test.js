import assert from 'node:assert/strict';
import test from 'node:test';

import { sendAssistantGeminiCompletionRequest } from '../src/GoogleGemini.js';

test('Google Gemini reads mounted Docker media directly for inlineData', async () => {
  let capturedBody;
  const source = 'http://localhost:3002/assets_v2/generations/session/frame.webp';

  const result = await sendAssistantGeminiCompletionRequest([{
    role: 'user',
    content: [{ type: 'input_image', source: { url: source } }],
  }], 'gemini-3.1-pro', {}, {
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
