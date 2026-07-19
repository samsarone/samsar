import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mapFinalRenderToGalleryItem,
  normalizeImageAssetPath,
} from './Account.js';

test('normalizeImageAssetPath preserves assets_v2 paths as secure media URLs', () => {
  const normalized = normalizeImageAssetPath(
    'assets_v2/generations/6a482ba4ef8d8eb60b88a5b5/generation_1783114735255_3vhpbt.png'
  );

  assert.match(
    normalized,
    /\/assets_v2\/generations\/6a482ba4ef8d8eb60b88a5b5\/generation_1783114735255_3vhpbt\.png/
  );
  assert.doesNotMatch(normalized, /\/generations\/assets_v2\//);
});

test('normalizeImageAssetPath refreshes absolute assets_v2 media URLs from their key', () => {
  const normalized = normalizeImageAssetPath(
    'https://static.samsar.one/assets_v2/generations/session/image.png?Expires=1&Signature=old'
  );

  assert.match(normalized, /\/assets_v2\/generations\/session\/image\.png/);
  assert.doesNotMatch(normalized, /Expires=1/);
  assert.doesNotMatch(normalized, /Signature=old/);
});

test('normalizeImageAssetPath keeps legacy generation filenames under /generations', () => {
  assert.equal(
    normalizeImageAssetPath('generation_123.png'),
    '/generations/generation_123.png'
  );
  assert.equal(
    normalizeImageAssetPath('/generations/generation_123.png'),
    '/generations/generation_123.png'
  );
});

test('branched final renders use their InteractivePublication in the user gallery', () => {
  const sessionId = '507f1f77bcf86cd799439011';
  const publicationId = '507f1f77bcf86cd799439012';
  const item = mapFinalRenderToGalleryItem({
    _id: sessionId,
    narrativeType: 'branched',
    sessionName: 'Choose a road',
    defaultBranchPathId: 'root.1',
    branchRenderPaths: [{
      pathId: 'root.1',
      remoteURL: 'https://private.example/root.1.mp4',
    }],
  }, {
    [sessionId]: {
      _id: publicationId,
      thumbnailUrl: 'https://static.samsar.one/published/root.1.png',
      manifest: {
        default_path_id: 'root.1',
        outputs: {
          paths: [{
            path_id: 'root.1',
            contentUrl: 'https://static.samsar.one/published/root.1.mp4',
            is_default: true,
          }],
        },
      },
    },
  });

  assert.equal(item.url, 'https://static.samsar.one/published/root.1.mp4');
  assert.equal(item.thumbnail, 'https://static.samsar.one/published/root.1.png');
  assert.equal(item.isPublished, true);
  assert.equal(item.publicationId, publicationId);
});
