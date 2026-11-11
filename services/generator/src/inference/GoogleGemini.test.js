import assert from 'node:assert/strict';
import test from 'node:test';
import { GoogleAuth } from 'google-auth-library';

import { buildGeminiContents, createGoogleGeminiChatCompletion } from './GoogleGemini.js';

test('Gemini reads mounted image bytes directly for inlineData', async () => {
  let fetchCalled = false;
  const result = await buildGeminiContents([{
    role: 'user',
    content: [{
      type: 'input_image',
      image_url: { url: 'http://localhost:3002/assets_v2/generations/session/frame.jpg' },
    }],
  }], {
    resolveLocalMediaPath: () => '/assets_v2/generations/session/frame.jpg',
    readFileImpl: async () => Buffer.from('mounted-image'),
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error('Gemini must not fetch or tunnel mounted media.');
    },
  });

  assert.equal(fetchCalled, false);
  assert.deepEqual(result.contents[0].parts[0], {
    inlineData: {
      mimeType: 'image/jpeg',
      data: Buffer.from('mounted-image').toString('base64'),
    },
  });
});

test('versioned Carbon environment model trims trailing model turns', async (t) => {
  const previousProject = process.env.GOOGLE_CLOUD_PROJECT;
  const previousModel = process.env.GOOGLE_GEMINI_4_CARBON_MODEL;
  const previousThinkingLevel = process.env.GOOGLE_GEMINI_THINKING_LEVEL;
  process.env.GOOGLE_CLOUD_PROJECT = 'argon-shape-project';
  process.env.GOOGLE_GEMINI_4_CARBON_MODEL = 'gemini-4-carbon-20261110';
  process.env.GOOGLE_GEMINI_THINKING_LEVEL = 'MEDIUM';
  t.after(() => {
    if (previousProject === undefined) delete process.env.GOOGLE_CLOUD_PROJECT;
    else process.env.GOOGLE_CLOUD_PROJECT = previousProject;
    if (previousModel === undefined) delete process.env.GOOGLE_GEMINI_4_CARBON_MODEL;
    else process.env.GOOGLE_GEMINI_4_CARBON_MODEL = previousModel;
    if (previousThinkingLevel === undefined) delete process.env.GOOGLE_GEMINI_THINKING_LEVEL;
    else process.env.GOOGLE_GEMINI_THINKING_LEVEL = previousThinkingLevel;
  });

  let capturedUrl;
  let capturedBody;
  t.mock.method(GoogleAuth.prototype, 'getClient', async () => ({
    getAccessToken: async () => ({ token: 'test-token' }),
  }));
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    capturedUrl = url;
    capturedBody = JSON.parse(options.body);
    return { ok: true, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }) };
  });

  await createGoogleGeminiChatCompletion([
    { role: 'user', content: 'First prompt' },
    { role: 'assistant', content: 'Previous answer' },
  ], 'gemini-4-carbon');

  assert.match(capturedUrl, /models\/gemini-4-carbon-20261110:generateContent$/);
  assert.deepEqual(capturedBody.contents.map(({ role }) => role), ['user']);
  assert.deepEqual(capturedBody.generationConfig.thinkingConfig, { thinkingLevel: 'MEDIUM' });
});
