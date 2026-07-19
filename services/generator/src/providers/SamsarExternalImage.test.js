import assert from 'node:assert/strict';
import test from 'node:test';

import { buildExternalImageEditPayload } from './SamsarExternalImage.js';

test('external image edit sends only freshly resolved media aliases', async () => {
  const result = await buildExternalImageEditPayload({
    model: 'NANOBANANAEDIT',
    prompt: 'edit',
    image: 'http://localhost:3002/assets_v2/generations/frame.png',
    imageUrl: 'http://localhost:3002/assets_v2/generations/stale.png',
    input_image_urls: ['http://localhost:3002/assets_v2/generations/stale-2.png'],
    maskImage: 'http://localhost:3002/assets_v2/generations/mask.png',
    input: {
      source_image_url: 'http://localhost:3002/assets_v2/generations/nested-stale.png',
      strength: 0.5,
    },
  }, 'custom-edit', {
    resolveMediaUrls: async () => ['https://fresh.example/frame.png'],
    resolveMediaUrl: async () => 'https://fresh.example/mask.png',
  });

  assert.equal(result.input.image_url, 'https://fresh.example/frame.png');
  assert.deepEqual(result.input.image_urls, ['https://fresh.example/frame.png']);
  assert.equal(result.input.mask_url, 'https://fresh.example/mask.png');
  assert.equal('image' in result.input, false);
  assert.equal('imageUrl' in result.input, false);
  assert.equal('input_image_urls' in result.input, false);
  assert.equal('maskImage' in result.input, false);
  assert.equal('source_image_url' in result.input.input, false);
  assert.equal(result.input.input.strength, 0.5);
});
