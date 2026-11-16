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
      model: 'gemini-4-carbon',
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

test('versioned Carbon environment model keeps native sampling and trims trailing model turns', async (t) => {
  const previousProject = process.env.GOOGLE_CLOUD_PROJECT;
  const previousModel = process.env.GOOGLE_GEMINI_4_CARBON_MODEL;
  process.env.GOOGLE_CLOUD_PROJECT = 'argon-shape-project';
  process.env.GOOGLE_GEMINI_4_CARBON_MODEL = 'gemini-4-carbon-20261110';
  t.after(() => {
    if (previousProject === undefined) delete process.env.GOOGLE_CLOUD_PROJECT;
    else process.env.GOOGLE_CLOUD_PROJECT = previousProject;
    if (previousModel === undefined) delete process.env.GOOGLE_GEMINI_4_CARBON_MODEL;
    else process.env.GOOGLE_GEMINI_4_CARBON_MODEL = previousModel;
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

  await createGoogleGeminiChatCompletion({
    model: 'gemini-4-carbon',
    messages: [
      { role: 'user', content: 'First prompt' },
      { role: 'assistant', content: 'Previous answer' },
    ],
    temperature: 0.5,
    top_p: 0.8,
    max_tokens: 50000,
    thinking_level: 'HIGH',
  });

  assert.match(capturedUrl, /models\/gemini-4-carbon-20261110:generateContent$/);
  assert.deepEqual(capturedBody.contents.map(({ role }) => role), ['user']);
  assert.equal(capturedBody.generationConfig.temperature, undefined);
  assert.equal(capturedBody.generationConfig.topP, undefined);
  assert.equal(capturedBody.generationConfig.maxOutputTokens, 32768);
  assert.deepEqual(capturedBody.generationConfig.thinkingConfig, { thinkingLevel: 'HIGH' });
});
