import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeImageAssetPath } from './Account.js';

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
