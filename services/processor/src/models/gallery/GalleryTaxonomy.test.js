import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGalleryTaxonomyMembershipOperations,
  normalizeGalleryTaxonomyKind,
  normalizeGalleryTaxonomyName,
} from './GalleryTaxonomy.js';
import galleryTaxonomyEntrySchema from '../../schema/gallery/GalleryTaxonomyEntry.js';

test('normalizes category and topic route aliases', () => {
  assert.equal(normalizeGalleryTaxonomyKind('categories'), 'category');
  assert.equal(normalizeGalleryTaxonomyKind('Topics'), 'topic');
  assert.equal(normalizeGalleryTaxonomyKind('tag'), '');
  assert.equal(normalizeGalleryTaxonomyName('  Science   Fiction '), 'science fiction');
});

test('taxonomy membership upserts every current assignment and removes obsolete assignments', () => {
  const operations = buildGalleryTaxonomyMembershipOperations({
    publicationId: 'publication-1',
    previousCategories: ['Education', 'History'],
    previousTopics: ['Robotics', 'Control Systems'],
    categories: ['Education', 'Science & Technology'],
    topics: ['robotics', 'Industrial Automation'],
  });

  assert.deepEqual(
    operations.upserts.map(({ kind, normalizedName }) => `${kind}:${normalizedName}`),
    [
      'category:education',
      'category:science & technology',
      'topic:robotics',
      'topic:industrial automation',
    ],
  );
  assert.deepEqual(
    operations.removals.map(({ kind, normalizedName }) => `${kind}:${normalizedName}`),
    ['category:history', 'topic:control systems'],
  );
});

test('unchanged classifications still produce idempotent upserts for an empty taxonomy collection', () => {
  const operations = buildGalleryTaxonomyMembershipOperations({
    publicationId: 'publication-2',
    previousCategories: ['Film & Animation'],
    previousTopics: ['science fiction'],
    categories: ['Film & Animation'],
    topics: ['science fiction'],
  });

  assert.equal(operations.upserts.length, 2);
  assert.equal(operations.removals.length, 0);
});

test('taxonomy schema has unique lookup and publication membership indexes', () => {
  const indexes = galleryTaxonomyEntrySchema.indexes();
  assert.ok(indexes.some(([fields, options]) => (
    fields.kind === 1 && fields.normalizedName === 1 && options.unique === true
  )));
  assert.ok(indexes.some(([fields]) => fields.publicationIds === 1));
});
