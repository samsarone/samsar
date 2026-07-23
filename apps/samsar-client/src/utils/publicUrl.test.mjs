import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOSTED_GALLERY_URL,
  normalizePublicUrl,
  resolvePublisherUrl,
} from './publicUrl.mjs';

test('publisher URL defaults to the hosted Gallery', () => {
  assert.equal(resolvePublisherUrl(undefined), HOSTED_GALLERY_URL);
  assert.equal(resolvePublisherUrl('   '), HOSTED_GALLERY_URL);
});

test('publisher URL accepts a deployment override and removes trailing slashes', () => {
  assert.equal(
    resolvePublisherUrl(' https://gallery.example.test/// '),
    'https://gallery.example.test',
  );
});

test('normalization preserves path prefixes', () => {
  assert.equal(
    normalizePublicUrl('https://example.test/apps/gallery/', HOSTED_GALLERY_URL),
    'https://example.test/apps/gallery',
  );
});
