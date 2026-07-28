import assert from 'node:assert/strict';
import test from 'node:test';
import { GoogleAuth } from 'google-auth-library';

import {
  buildInlineImagePart,
  createGoogleGeminiChatCompletion,
} from './GoogleGemini.js';

test('Gemini inlineData reads mounted media without resolving a public tunnel', async () => {
  let fetchCalled = false;
  const bytes = Buffer.from('mounted-image');
  const part = await buildInlineImagePart(
    'http://localhost:3002/assets_v2/generations/session/frame.png',
    {
      resolveMountedImagePath: () => '/assets_v2/generations/session/frame.png',
      readFileImpl: async () => bytes,
      fetchImpl: async () => {
        fetchCalled = true;
        throw new Error('should not fetch');
      },
    },
  );

  assert.equal(fetchCalled, false);
  assert.deepEqual(part, {
    inlineData: {
      mimeType: 'image/png',
      data: bytes.toString('base64'),
    },
  });
});

test('Gemini provider failures preserve HTTP status and provider code', async (t) => {
  const previousProject = process.env.GOOGLE_CLOUD_PROJECT;
  process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
  t.after(() => {
    if (previousProject === undefined) delete process.env.GOOGLE_CLOUD_PROJECT;
    else process.env.GOOGLE_CLOUD_PROJECT = previousProject;
  });

  t.mock.method(GoogleAuth.prototype, 'getClient', async () => ({
    getAccessToken: async () => ({ token: 'test-access-token' }),
  }));
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: false,
    status: 503,
    text: async () => JSON.stringify({
      error: {
        code: 'UNAVAILABLE',
        message: 'Gemini is temporarily unavailable',
      },
    }),
  }));

  await assert.rejects(
    createGoogleGeminiChatCompletion({
      model: 'gemini-3.1-pro',
      messages: [{ role: 'user', content: 'hello' }],
    }),
    (error) => {
      assert.equal(error.message, 'Gemini is temporarily unavailable');
      assert.equal(error.status, 503);
      assert.equal(error.code, 'UNAVAILABLE');
      return true;
    },
  );
});
