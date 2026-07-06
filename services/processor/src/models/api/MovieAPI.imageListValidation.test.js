import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertImageListToVideoUrlsAreFetchable,
  isBlockedImageListToVideoImageUrl,
} from './ImageListToVideoUrlValidation.js';

test('blocks Wikimedia Special:Redirect file URLs for image-list-to-video input', () => {
  const url = 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Arashiyama%20Bamboo%20Grove%20%28Unsplash%29.jpg';

  assert.equal(isBlockedImageListToVideoImageUrl(url), true);
  assert.throws(
    () => assertImageListToVideoUrlsAreFetchable([url]),
    /direct, publicly accessible image URL/,
  );
});

test('allows direct image URLs for image-list-to-video input', () => {
  assert.equal(isBlockedImageListToVideoImageUrl('https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg'), false);
  assert.doesNotThrow(() => assertImageListToVideoUrlsAreFetchable([
    'https://cdn.example.com/image.jpg',
  ]));
});
