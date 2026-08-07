import assert from 'node:assert/strict';
import test from 'node:test';

import { ensureGalleryPublicationIndexesForModel } from './GalleryDatabase.js';
import galleryPublicationSchema from '../../schema/gallery/GalleryPublication.js';

const indexConflict = () => Object.assign(
  new Error(
    'An equivalent index already exists with the same name but different options: gallery_text_search',
  ),
  { code: 85 },
);

test('GalleryPublication is isolated from InteractivePublication storage', () => {
  assert.equal(galleryPublicationSchema.get('collection'), 'gallery_publications');
});

test('reconciles a stale GalleryPublication text index only on gallery_publications', async () => {
  let createAttempts = 0;
  const droppedIndexes = [];
  const GalleryPublication = {
    collection: {
      collectionName: 'gallery_publications',
      async dropIndex(name) {
        droppedIndexes.push(name);
      },
    },
    async createIndexes() {
      createAttempts += 1;
      if (createAttempts === 1) throw indexConflict();
    },
  };

  await ensureGalleryPublicationIndexesForModel(GalleryPublication);

  assert.equal(createAttempts, 2);
  assert.deepEqual(droppedIndexes, ['gallery_text_search']);
});

test('refuses to reconcile the Gallery text index on InteractivePublication', async () => {
  let dropAttempted = false;
  const InteractivePublication = {
    collection: {
      collectionName: 'interactivepublications',
      async dropIndex() {
        dropAttempted = true;
      },
    },
    async createIndexes() {
      throw indexConflict();
    },
  };

  await assert.rejects(
    ensureGalleryPublicationIndexesForModel(InteractivePublication),
    /Refusing to reconcile gallery_text_search outside SamsarGallery\.gallery_publications/,
  );
  assert.equal(dropAttempted, false);
});
