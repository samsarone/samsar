import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePublicationAspectRatio,
  resolvePublicationAspectRatio,
} from './AspectRatio.js';

test('normalizes named and numeric aspect ratios', () => {
  assert.equal(normalizePublicationAspectRatio('vertical'), '9:16');
  assert.equal(normalizePublicationAspectRatio('16 / 9'), '16:9');
  assert.equal(normalizePublicationAspectRatio('1x1'), '1:1');
});

test('uses the session aspect ratio as the publication source of truth', () => {
  assert.equal(
    resolvePublicationAspectRatio({
      sessionAspectRatio: '9:16',
      requestedAspectRatio: '16:9',
      publishedAspectRatio: '16:9',
    }),
    '9:16',
  );
});

test('falls back when a session has no valid aspect ratio', () => {
  assert.equal(
    resolvePublicationAspectRatio({
      sessionAspectRatio: null,
      requestedAspectRatio: 'landscape',
      publishedAspectRatio: '9:16',
    }),
    '16:9',
  );
  assert.equal(resolvePublicationAspectRatio({}), '1:1');
});
