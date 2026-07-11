import 'dotenv/config';
import mongoose from 'mongoose';

import { getDBConnectionString } from '../src/models/DBString.js';
import { getGalleryModels } from '../src/models/gallery/GalleryDatabase.js';
import { normalizeGalleryTaxonomyName } from '../src/models/gallery/GalleryTaxonomy.js';

const hasFlag = (name) => process.argv.includes(`--${name}`);

function buildExpectedTaxonomy(publications) {
  const entries = new Map();

  const addMembership = (kind, value, publicationId) => {
    const name = typeof value === 'string' ? value.trim() : '';
    const normalizedName = normalizeGalleryTaxonomyName(name);
    if (!name || !normalizedName || !publicationId) return;
    const key = `${kind}:${normalizedName}`;
    const entry = entries.get(key) || {
      kind,
      name,
      normalizedName,
      publicationIds: new Set(),
    };
    entry.publicationIds.add(publicationId);
    entries.set(key, entry);
  };

  publications.forEach((publication) => {
    const publicationId = publication.publicationId;
    (Array.isArray(publication.categories) ? publication.categories : [])
      .forEach((category) => addMembership('category', category, publicationId));
    (Array.isArray(publication.topics) ? publication.topics : [])
      .forEach((topic) => addMembership('topic', topic, publicationId));
  });

  return Array.from(entries.values())
    .map((entry) => ({
      ...entry,
      publicationIds: Array.from(entry.publicationIds).sort(),
    }))
    .sort((left, right) => (
      left.kind.localeCompare(right.kind) || left.normalizedName.localeCompare(right.normalizedName)
    ));
}

function summarize(publications, expectedEntries) {
  const categoryEntries = expectedEntries.filter((entry) => entry.kind === 'category');
  const topicEntries = expectedEntries.filter((entry) => entry.kind === 'topic');
  return {
    publications: publications.length,
    publicationsMissingCategories: publications.filter(
      (publication) => !Array.isArray(publication.categories) || publication.categories.length === 0,
    ).length,
    publicationsMissingTopics: publications.filter(
      (publication) => !Array.isArray(publication.topics) || publication.topics.length === 0,
    ).length,
    categoryDocuments: categoryEntries.length,
    topicDocuments: topicEntries.length,
    categoryMemberships: categoryEntries.reduce(
      (total, entry) => total + entry.publicationIds.length,
      0,
    ),
    topicMemberships: topicEntries.reduce(
      (total, entry) => total + entry.publicationIds.length,
      0,
    ),
  };
}

function compareTaxonomy(expectedEntries, actualEntries) {
  const expected = new Map(expectedEntries.map((entry) => [
    `${entry.kind}:${entry.normalizedName}`,
    new Set(entry.publicationIds),
  ]));
  const actual = new Map(actualEntries.map((entry) => [
    `${entry.kind}:${entry.normalizedName}`,
    new Set(Array.isArray(entry.publicationIds) ? entry.publicationIds : []),
  ]));
  let missingDocuments = 0;
  let extraDocuments = 0;
  let missingMemberships = 0;
  let extraMemberships = 0;

  expected.forEach((expectedIds, key) => {
    const actualIds = actual.get(key);
    if (!actualIds) {
      missingDocuments += 1;
      missingMemberships += expectedIds.size;
      return;
    }
    expectedIds.forEach((publicationId) => {
      if (!actualIds.has(publicationId)) missingMemberships += 1;
    });
  });
  actual.forEach((actualIds, key) => {
    const expectedIds = expected.get(key);
    if (!expectedIds) {
      extraDocuments += 1;
      extraMemberships += actualIds.size;
      return;
    }
    actualIds.forEach((publicationId) => {
      if (!expectedIds.has(publicationId)) extraMemberships += 1;
    });
  });

  return {
    expectedDocuments: expected.size,
    actualDocuments: actual.size,
    missingDocuments,
    extraDocuments,
    missingMemberships,
    extraMemberships,
  };
}

async function main() {
  if (process.env.CURRENT_ENV !== 'production') {
    throw new Error('Refusing to run: CURRENT_ENV must be production.');
  }

  const apply = hasFlag('apply');
  await getDBConnectionString();
  const { GalleryPublication, GalleryTaxonomyEntry } = await getGalleryModels();
  const publications = await GalleryPublication.find(
    { available: true },
    { publicationId: 1, categories: 1, topics: 1 },
  ).sort({ publicationId: 1 }).lean();
  const expectedEntries = buildExpectedTaxonomy(publications);
  const sourceSummary = summarize(publications, expectedEntries);
  if (
    sourceSummary.publications === 0 ||
    sourceSummary.publicationsMissingCategories > 0 ||
    sourceSummary.publicationsMissingTopics > 0
  ) {
    throw new Error(`Gallery taxonomy source audit failed: ${JSON.stringify(sourceSummary)}`);
  }

  const before = await GalleryTaxonomyEntry.find(
    {},
    { kind: 1, normalizedName: 1, publicationIds: 1 },
  ).lean();
  if (!apply) {
    console.log(JSON.stringify({
      mode: 'dry-run',
      environment: process.env.CURRENT_ENV,
      sourceSummary,
      currentTaxonomy: compareTaxonomy(expectedEntries, before),
    }, null, 2));
    return;
  }

  await GalleryTaxonomyEntry.createIndexes();
  const now = new Date();
  if (expectedEntries.length > 0) {
    await GalleryTaxonomyEntry.bulkWrite(
      expectedEntries.map((entry) => ({
        updateOne: {
          filter: { kind: entry.kind, normalizedName: entry.normalizedName },
          update: {
            $set: {
              name: entry.name,
              publicationIds: entry.publicationIds,
              updatedAt: now,
            },
            $setOnInsert: { createdAt: now },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  const expectedKeys = new Set(
    expectedEntries.map((entry) => `${entry.kind}:${entry.normalizedName}`),
  );
  const existingEntries = await GalleryTaxonomyEntry.find(
    {},
    { kind: 1, normalizedName: 1 },
  ).lean();
  const obsoleteIds = existingEntries
    .filter((entry) => !expectedKeys.has(`${entry.kind}:${entry.normalizedName}`))
    .map((entry) => entry._id);
  if (obsoleteIds.length > 0) {
    await GalleryTaxonomyEntry.deleteMany({ _id: { $in: obsoleteIds } });
  }

  const after = await GalleryTaxonomyEntry.find(
    {},
    { kind: 1, normalizedName: 1, publicationIds: 1 },
  ).lean();
  const verification = compareTaxonomy(expectedEntries, after);
  console.log(JSON.stringify({
    mode: 'apply',
    environment: process.env.CURRENT_ENV,
    sourceSummary,
    verification,
    classificationRequests: 0,
    embeddingRequests: 0,
  }, null, 2));

  if (
    verification.missingDocuments > 0 ||
    verification.extraDocuments > 0 ||
    verification.missingMemberships > 0 ||
    verification.extraMemberships > 0
  ) {
    throw new Error('Gallery taxonomy backfill completed with validation failures.');
  }
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ status: 'failed', error: error?.message || String(error) }));
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
