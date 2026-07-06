import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeImageToVideoStartImagePayload } from './VideoInputPayloadAliases.js';

test('step image-to-video accepts start image URL aliases', () => {
  const startImageUrl = 'https://media.example.com/assets_v2/session/start.png';

  for (const key of ['start_image_url', 'startImageUrl', 'start_image', 'startImage']) {
    const normalized = normalizeImageToVideoStartImagePayload({ [key]: startImageUrl });
    assert.deepEqual(normalized.image_urls, [startImageUrl], key);
  }
});

test('step image-to-video preserves explicit image_urls over aliases', () => {
  const explicitImageUrls = ['https://media.example.com/assets_v2/session/explicit.png'];
  const normalized = normalizeImageToVideoStartImagePayload({
    image_urls: explicitImageUrls,
    startImage: 'https://media.example.com/assets_v2/session/start.png',
  });

  assert.equal(normalized.image_urls, explicitImageUrls);
});
