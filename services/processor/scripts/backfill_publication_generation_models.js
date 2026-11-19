import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';

import { getDBConnectionString } from '../src/models/DBString.js';
import { buildPublicationModelBackfill } from '../src/models/publication/GenerationModels.js';
import { loadPublicationGenerationAssetModels } from '../src/models/publication/GenerationAssetModels.js';
import { Publication } from '../src/schema/Publication.js';
import InteractivePublication from '../src/schema/InteractivePublication.js';
import VideoSession from '../src/schema/VideoSession.js';

const MODEL_FIELDS = ['imageModel', 'videoModel', 'inferenceModel', 'generationModels'];
const PUBLICATION_PROJECTION = Object.fromEntries([
  '_id', 'sessionId', 'updatedAt', 'pendingMediaRevision', ...MODEL_FIELDS,
].map((key) => [key, 1]));
const SESSION_PROJECTION = Object.fromEntries([
  '_id', 'layers', 'branchRenderPaths.timeline', 'imageModel', 'image_model', 'expressGenerationImageModel',
  'expressGenerativeVideoModel', 'videoGenerationModel', 'videoModel', 'video_model',
  'expressGenerationInferenceModel', 'inferenceModel', 'inference_model',
  'selectedInferenceModel', 'expressStepGeneration.inferenceModel',
  'expressStepGeneration.inference_model', 'expressGenerationBuilder.inferenceModel',
  'expressGenerationBuilder.inference_model', 'metadata.inferenceModel',
  'metadata.inference_model',
].map((key) => [key, 1]));

const sessionObjectId = (value) => {
  const normalized = value?.toString?.();
  return typeof normalized === 'string' && /^[a-f\d]{24}$/i.test(normalized)
    ? new mongoose.Types.ObjectId(normalized) : null;
};
const originalField = (document, field) => Object.hasOwn(document, field)
  ? document[field] : { $exists: false };

function newCounts() {
  return {
    scanned: 0, eligible: 0, unchanged: 0, updated: 0, concurrentSkipped: 0,
    pendingPublishSkipped: 0, invalidSessionId: 0, sessionNotFound: 0,
    missingImage: 0, missingVideo: 0, missingInference: 0,
  };
}

/** Dry-run by default. Use raw collections so absent legacy fields stay absent
 * during comparison. CAS guards preserve concurrent republishes, and attribution
 * updates deliberately leave publication dates/content/timestamps unchanged.
 */
export async function backfillPublicationGenerationModels({
  apply = false,
  batchSize = 200,
  collections = [Publication.collection, InteractivePublication.collection],
  sessionCollection = VideoSession.collection,
  loadAssetModels = loadPublicationGenerationAssetModels,
} = {}) {
  const reports = [];
  for (const collection of collections) {
    const counts = newCounts();
    const totalPublications = await collection.countDocuments({});
    const cursor = collection.find({}, { projection: PUBLICATION_PROJECTION })
      .sort({ _id: 1 }).batchSize(batchSize);
    let batch = [];
    const processBatch = async () => {
      if (batch.length === 0) return;
      const ids = [...new Map(batch.map((publication) => sessionObjectId(publication.sessionId))
        .filter(Boolean).map((id) => [id.toString(), id])).values()];
      const sessions = ids.length > 0
        ? await sessionCollection.find({ _id: { $in: ids } }, { projection: SESSION_PROJECTION }).toArray()
        : [];
      const byId = new Map(sessions.map((session) => [session._id.toString(), session]));
      const assetsBySession = new Map();
      const operations = [];
      for (const publication of batch) {
        counts.scanned += 1;
        // A staged interactive republish has its own pending snapshot. Let it
        // finalize before migrating the live publication.
        if (publication.pendingMediaRevision) {
          counts.pendingPublishSkipped += 1;
          continue;
        }
        const sessionId = sessionObjectId(publication.sessionId);
        const session = sessionId ? byId.get(sessionId.toString()) : null;
        if (!sessionId) counts.invalidSessionId += 1;
        else if (!session) counts.sessionNotFound += 1;
        if (session && !assetsBySession.has(sessionId.toString())) {
          assetsBySession.set(sessionId.toString(), await loadAssetModels(session));
        }
        const update = buildPublicationModelBackfill(
          publication, session || {}, assetsBySession.get(sessionId?.toString()) || {},
        );
        const snapshot = update.generationModels || publication.generationModels;
        for (const kind of ['image', 'video', 'inference']) {
          if (!snapshot?.[kind]?.length) {
            counts[`missing${kind[0].toUpperCase()}${kind.slice(1)}`] += 1;
          }
        }
        if (Object.keys(update).length === 0) {
          counts.unchanged += 1;
          continue;
        }
        counts.eligible += 1;
        operations.push({
          updateOne: {
            filter: {
              _id: publication._id,
              ...Object.fromEntries([
                'sessionId', 'updatedAt', 'pendingMediaRevision', ...MODEL_FIELDS,
              ].map((field) => [field, originalField(publication, field)])),
            },
            update: { $set: update },
          },
        });
      }
      if (apply && operations.length > 0) {
        const result = await collection.bulkWrite(operations, { ordered: false });
        counts.updated += result.modifiedCount;
        counts.concurrentSkipped += operations.length - result.matchedCount;
      }
      batch = [];
    };
    try {
      for await (const publication of cursor) {
        batch.push(publication);
        if (batch.length >= batchSize) await processBatch();
      }
      await processBatch();
    } finally {
      await cursor.close();
    }
    reports.push({ collection: collection.collectionName, totalPublications, ...counts });
  }
  return { mode: apply ? 'apply' : 'dry-run', batchSize, collections: reports };
}

async function main() {
  const args = process.argv.slice(2);
  for (const argument of args) {
    if (argument !== '--apply' && !/^--batch-size=\d+$/.test(argument)) {
      throw new Error('Usage: node scripts/backfill_publication_generation_models.js [--apply] [--batch-size=200]');
    }
  }
  const batchSize = Number(args.find((argument) => argument.startsWith('--batch-size='))?.split('=')[1] || 200);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
    throw new Error('Batch size must be between 1 and 1000.');
  }
  if (process.env.CURRENT_ENV !== 'production') {
    throw new Error('Refusing to run: CURRENT_ENV must be production.');
  }
  await getDBConnectionString();
  const report = await backfillPublicationGenerationModels({
    apply: args.includes('--apply'), batchSize,
  });
  console.log(JSON.stringify({ environment: process.env.CURRENT_ENV, ...report }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ status: 'failed', message: error?.message || String(error) }));
    process.exitCode = 1;
  }).finally(async () => { await mongoose.disconnect().catch(() => undefined); });
}
