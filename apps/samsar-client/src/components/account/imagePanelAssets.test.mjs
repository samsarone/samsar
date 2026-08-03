import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getUniqueVisibleImagePanelItems,
  normalizeImagePanelAssetKey,
  resolveImagePanelAssetSource,
} from './imagePanelAssets.mjs';

test('resolves the same field priority used by the Images panel', () => {
  assert.equal(resolveImagePanelAssetSource({
    displayUrl: '/generations/display.png',
    url: '/generations/raw.png',
  }), '/generations/display.png');
});

test('normalizes signed and relative variants of the same asset', () => {
  assert.equal(
    normalizeImagePanelAssetKey('https://media.example/assets_v2/generations/session/image.png?token=abc'),
    'assets_v2/generations/session/image.png'
  );
  assert.equal(
    normalizeImagePanelAssetKey('/assets_v2/generations/session/image.png'),
    'assets_v2/generations/session/image.png'
  );
});

test('removes duplicate and explicitly intermediate image rows', () => {
  const items = [
    { _id: 'first', displayUrl: '/generations/final.png' },
    { _id: 'duplicate', url: 'https://media.example/generations/final.png?signature=two' },
    { _id: 'intermediate', url: '/generations/pass.png', generationType: 'scene_intermediate' },
    { _id: 'missing' },
    { _id: 'second', url: '/generations/second.png' },
  ];

  assert.deepEqual(
    getUniqueVisibleImagePanelItems(items).map((item) => item._id),
    ['first', 'second']
  );
});
