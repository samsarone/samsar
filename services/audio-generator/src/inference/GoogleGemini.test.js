import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGeminiContents } from './GoogleGemini.js';

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
