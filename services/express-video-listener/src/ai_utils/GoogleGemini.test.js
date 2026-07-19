import assert from 'node:assert/strict';
import test from 'node:test';

import { buildInlineImagePart } from './GoogleGemini.js';

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
