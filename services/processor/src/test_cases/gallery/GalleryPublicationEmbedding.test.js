import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GALLERY_PUBLICATION_EMBEDDING_MAX_AGE_MS,
  isGalleryPublicationEmbeddingFresh,
} from '../../models/gallery/GalleryService.js';

const fingerprint = 'publication-fingerprint';
const now = new Date('2026-07-11T00:00:00.000Z');

test('a matching publication embedding remains fresh for less than 24 hours', () => {
  const record = {
    embedding: [0.1, 0.2],
    embeddingFingerprint: fingerprint,
    indexedAt: new Date(now.getTime() - GALLERY_PUBLICATION_EMBEDDING_MAX_AGE_MS + 1),
  };

  assert.equal(isGalleryPublicationEmbeddingFresh(record, fingerprint, now), true);
});

test('a publication embedding becomes stale at 24 hours', () => {
  const record = {
    embedding: [0.1, 0.2],
    embeddingFingerprint: fingerprint,
    indexedAt: new Date(now.getTime() - GALLERY_PUBLICATION_EMBEDDING_MAX_AGE_MS),
  };

  assert.equal(isGalleryPublicationEmbeddingFresh(record, fingerprint, now), false);
});

test('missing embeddings and changed publication content are never treated as fresh', () => {
  assert.equal(
    isGalleryPublicationEmbeddingFresh(
      { embedding: [], embeddingFingerprint: fingerprint, indexedAt: now },
      fingerprint,
      now,
    ),
    false,
  );
  assert.equal(
    isGalleryPublicationEmbeddingFresh(
      { embedding: [0.1], embeddingFingerprint: 'old', indexedAt: now },
      fingerprint,
      now,
    ),
    false,
  );
});
