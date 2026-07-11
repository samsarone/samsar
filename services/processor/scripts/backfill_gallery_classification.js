import 'dotenv/config';
import mongoose from 'mongoose';

import { getDBConnectionString } from '../src/models/DBString.js';
import {
  GALLERY_CATEGORIES,
  GALLERY_CLASSIFICATION_VERSION,
  classifyGalleryPublication,
} from '../src/models/gallery/GalleryClassification.js';
import { getGalleryModels } from '../src/models/gallery/GalleryDatabase.js';
import { normalizeGalleryTaxonomyName } from '../src/models/gallery/GalleryTaxonomy.js';
import { syncGalleryPublications } from '../src/models/gallery/GalleryService.js';
import { normalizePublicationTranscript } from '../src/models/publication/Transcript.js';
import { Publication } from '../src/schema/Publication.js';

const CLASSIFICATION_PASSES = 2;
const MAX_ATTEMPTS = 3;

const hasFlag = (name) => process.argv.includes(`--${name}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const normalizeString = (value) => typeof value === 'string' ? value.trim() : '';

async function auditSourcePublications() {
  const publications = await Publication.collection.find(
    {},
    { projection: { _id: 1, originalPrompt: 1, sessionTranscript: 1 } },
  ).toArray();
  let missingOriginalPrompt = 0;
  let missingSessionTranscript = 0;
  let emptySessionTranscript = 0;

  publications.forEach((publication) => {
    if (!normalizeString(publication.originalPrompt)) missingOriginalPrompt += 1;
    if (!publication.sessionTranscript) {
      missingSessionTranscript += 1;
      return;
    }
    const transcript = normalizePublicationTranscript(publication.sessionTranscript);
    if (transcript.scenes.length === 0 && transcript.sounds.length === 0) {
      emptySessionTranscript += 1;
    }
  });

  return {
    total: publications.length,
    missingOriginalPrompt,
    missingSessionTranscript,
    emptySessionTranscript,
  };
}

async function auditGalleryClassification() {
  const { GalleryPublication, GalleryTaxonomyEntry } = await getGalleryModels();
  const records = await GalleryPublication.find(
    { available: true },
    {
      publicationId: 1,
      embedding: 1,
      categories: 1,
      topics: 1,
      classification: 1,
    },
  ).lean();
  const categories = new Set();
  const topics = new Set();
  let withEmbedding = 0;
  let complete = 0;
  let missingCategories = 0;
  let missingTopics = 0;
  let invalidCategories = 0;
  let tooManyCategories = 0;
  let tooManyTopics = 0;
  const expectedTaxonomyMemberships = new Map();

  const addExpectedMembership = (kind, name, publicationId) => {
    const normalizedName = normalizeGalleryTaxonomyName(name);
    if (!normalizedName || !publicationId) return;
    const key = `${kind}:${normalizedName}`;
    const publicationIds = expectedTaxonomyMemberships.get(key) || new Set();
    publicationIds.add(publicationId);
    expectedTaxonomyMemberships.set(key, publicationIds);
  };

  records.forEach((record) => {
    if (Array.isArray(record.embedding) && record.embedding.length > 0) withEmbedding += 1;
    if (
      record.classification?.status === 'complete' &&
      record.classification?.version === GALLERY_CLASSIFICATION_VERSION
    ) complete += 1;
    const recordCategories = Array.isArray(record.categories) ? record.categories : [];
    const recordTopics = Array.isArray(record.topics) ? record.topics : [];
    if (recordCategories.length === 0) missingCategories += 1;
    if (recordTopics.length === 0) missingTopics += 1;
    if (recordCategories.length > 3) tooManyCategories += 1;
    if (recordTopics.length > 8) tooManyTopics += 1;
    recordCategories.forEach((category) => {
      categories.add(category);
      if (!GALLERY_CATEGORIES.includes(category)) invalidCategories += 1;
      addExpectedMembership('category', category, record.publicationId);
    });
    recordTopics.forEach((topic) => {
      topics.add(topic);
      addExpectedMembership('topic', topic, record.publicationId);
    });
  });

  const taxonomyEntries = await GalleryTaxonomyEntry.find(
    {},
    { kind: 1, normalizedName: 1, publicationIds: 1 },
  ).lean();
  const actualTaxonomyMemberships = new Map(
    taxonomyEntries.map((entry) => [
      `${entry.kind}:${entry.normalizedName}`,
      new Set(Array.isArray(entry.publicationIds) ? entry.publicationIds : []),
    ]),
  );
  let missingTaxonomyMemberships = 0;
  let extraTaxonomyMemberships = 0;
  expectedTaxonomyMemberships.forEach((publicationIds, key) => {
    const actualIds = actualTaxonomyMemberships.get(key) || new Set();
    publicationIds.forEach((publicationId) => {
      if (!actualIds.has(publicationId)) missingTaxonomyMemberships += 1;
    });
  });
  actualTaxonomyMemberships.forEach((publicationIds, key) => {
    const expectedIds = expectedTaxonomyMemberships.get(key) || new Set();
    publicationIds.forEach((publicationId) => {
      if (!expectedIds.has(publicationId)) extraTaxonomyMemberships += 1;
    });
  });

  return {
    total: records.length,
    withEmbedding,
    complete,
    missingCategories,
    missingTopics,
    invalidCategories,
    tooManyCategories,
    tooManyTopics,
    distinctCategories: categories.size,
    distinctTopics: topics.size,
    taxonomyEntries: taxonomyEntries.length,
    missingTaxonomyMemberships,
    extraTaxonomyMemberships,
  };
}

async function classifyWithRetry(publicationId) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await classifyGalleryPublication(publicationId, { force: true });
      if (result.status === 'updated') return result;
      throw new Error(`Classification skipped: ${result.reason || result.status}`);
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) await sleep(attempt * 5000);
    }
  }
  throw lastError;
}

async function runClassificationPass(pass, publicationIds) {
  const summary = { pass, total: publicationIds.length, updated: 0, failed: 0 };
  for (let index = 0; index < publicationIds.length; index += 1) {
    const publicationId = publicationIds[index];
    try {
      await classifyWithRetry(publicationId);
      summary.updated += 1;
    } catch (error) {
      summary.failed += 1;
      console.warn(JSON.stringify({
        stage: 'classification',
        pass,
        position: index + 1,
        total: publicationIds.length,
        publicationId,
        status: 'failed',
        error: error?.message || String(error),
      }));
    }
    console.log(JSON.stringify({
      stage: 'classification',
      pass,
      position: index + 1,
      total: publicationIds.length,
      updated: summary.updated,
      failed: summary.failed,
    }));
  }
  return summary;
}

async function main() {
  if (process.env.CURRENT_ENV !== 'production') {
    throw new Error('Refusing to run: CURRENT_ENV must be production.');
  }

  const apply = hasFlag('apply');
  await getDBConnectionString();
  const sourceAudit = await auditSourcePublications();
  if (
    sourceAudit.missingOriginalPrompt > 0 ||
    sourceAudit.missingSessionTranscript > 0 ||
    sourceAudit.emptySessionTranscript > 0
  ) {
    throw new Error(`Source publication audit failed: ${JSON.stringify(sourceAudit)}`);
  }

  if (!apply) {
    console.log(JSON.stringify({
      mode: 'dry-run',
      environment: process.env.CURRENT_ENV,
      sourceAudit,
      galleryAudit: await auditGalleryClassification(),
      plannedClassificationPasses: CLASSIFICATION_PASSES,
    }, null, 2));
    return;
  }

  console.log(JSON.stringify({ stage: 'embedding_sync', status: 'starting', sourceAudit }));
  const embeddingSync = await syncGalleryPublications({ force: true });
  console.log(JSON.stringify({ stage: 'embedding_sync', status: 'complete', result: embeddingSync }));

  const { GalleryPublication } = await getGalleryModels();
  const indexed = await GalleryPublication.find(
    { available: true, 'embedding.0': { $exists: true } },
    { publicationId: 1 },
  ).sort({ publicationId: 1 }).lean();
  const publicationIds = indexed.map((record) => record.publicationId).filter(Boolean);
  if (publicationIds.length !== sourceAudit.total) {
    throw new Error(
      `Expected ${sourceAudit.total} indexed publications, found ${publicationIds.length}.`
    );
  }

  const passSummaries = [];
  for (let pass = 1; pass <= CLASSIFICATION_PASSES; pass += 1) {
    passSummaries.push(await runClassificationPass(pass, publicationIds));
  }

  const galleryAudit = await auditGalleryClassification();
  console.log(JSON.stringify({
    mode: 'apply',
    environment: process.env.CURRENT_ENV,
    sourceAudit,
    embeddingSync: {
      indexed: embeddingSync.indexed,
      skipped: embeddingSync.skipped,
      failed: embeddingSync.failed,
      totalAvailable: embeddingSync.totalAvailable,
    },
    passSummaries,
    galleryAudit,
  }, null, 2));

  if (
    passSummaries.some((summary) => summary.failed > 0) ||
    galleryAudit.total !== sourceAudit.total ||
    galleryAudit.withEmbedding !== sourceAudit.total ||
    galleryAudit.complete !== sourceAudit.total ||
    galleryAudit.missingCategories > 0 ||
    galleryAudit.missingTopics > 0 ||
    galleryAudit.invalidCategories > 0 ||
    galleryAudit.tooManyCategories > 0 ||
    galleryAudit.tooManyTopics > 0 ||
    galleryAudit.missingTaxonomyMemberships > 0 ||
    galleryAudit.extraTaxonomyMemberships > 0 ||
    galleryAudit.distinctCategories > GALLERY_CATEGORIES.length
  ) {
    throw new Error('Gallery classification backfill completed with validation failures.');
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
