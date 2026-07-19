import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGeminiContents } from './GoogleGemini.js';

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
