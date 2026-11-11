import assert from 'node:assert/strict';
import test from 'node:test';
import { GoogleAuth } from 'google-auth-library';

import { buildGeminiContents, createGoogleGeminiChatCompletion } from './GoogleGemini.js';

test('Gemini reads mounted typed image aliases directly into inline image parts', async () => {
  const read = [];
  let fetchCalled = false;
  const result = await buildGeminiContents([{
    role: 'user',
    content: [
      { type: 'input_text', text: 'Describe these.' },
      { type: 'input_image', source: { urls: ['/assets_v2/one.png', '/assets_v2/two.png'] } },
      { type: 'input_image', source: { data: 'YWJj', mime_type: 'image/jpeg' } },
    ],
  }], {
    resolveMediaUrl: async () => {
      throw new Error('Gemini inlineData must not create a provider tunnel.');
    },
    readLocalMediaBuffer: async (value, { mediaKind }) => {
      read.push([value, mediaKind]);
      return Buffer.from(value.endsWith('one.png') ? 'one' : 'two');
    },
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error('Mounted Gemini media must not be fetched over HTTP.');
    },
  });

  assert.deepEqual(read, [
    ['/assets_v2/one.png', 'image'],
    ['/assets_v2/two.png', 'image'],
  ]);
  assert.equal(fetchCalled, false);
  assert.equal(result.contents[0].parts[0].text, 'Describe these.');
  assert.equal(result.contents[0].parts[1].inlineData.mimeType, 'image/png');
  assert.equal(result.contents[0].parts[3].inlineData.mimeType, 'image/jpeg');
  assert.equal(result.contents[0].parts[3].inlineData.data, 'YWJj');
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
  const fetchImpl = async (url, options) => {
    capturedUrl = url;
    capturedBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }) };
  };

  await createGoogleGeminiChatCompletion([
    { role: 'user', content: 'First prompt' },
    { role: 'assistant', content: 'Previous answer' },
  ], 'gemini-4-carbon', { fetchImpl });

  assert.match(capturedUrl, /models\/gemini-4-carbon-20261110:generateContent$/);
  assert.deepEqual(capturedBody.contents.map(({ role }) => role), ['user']);
  assert.deepEqual(capturedBody.generationConfig.thinkingConfig, { thinkingLevel: 'MEDIUM' });
});
