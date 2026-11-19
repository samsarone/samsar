import assert from 'node:assert/strict';
import test from 'node:test';
import { backfillPublicationGenerationModels } from './backfill_publication_generation_models.js';

const sessionId = '507f1f77bcf86cd799439011';
const clone = (value) => JSON.parse(JSON.stringify(value));

function memoryCollection(documents, collectionName = 'publications') {
  let writes = 0;
  return {
    collectionName,
    documents,
    get writes() { return writes; },
    countDocuments: async () => documents.length,
    find() {
      const snapshot = clone(documents);
      const cursor = {
        sort() { return cursor; }, batchSize() { return cursor; }, close: async () => {},
        toArray: async () => snapshot,
        async *[Symbol.asyncIterator]() { yield* snapshot; },
      };
      return cursor;
    },
    async bulkWrite(operations) {
      writes += 1;
      let matchedCount = 0;
      for (const { updateOne } of operations) {
        const record = documents.find((document) => document._id === updateOne.filter._id);
        const matches = record && Object.entries(updateOne.filter).every(([field, expected]) => (
          expected?.$exists === false ? !Object.hasOwn(record, field)
            : JSON.stringify(record[field]) === JSON.stringify(expected)
        ));
        if (matches) {
          matchedCount += 1;
          Object.assign(record, clone(updateOne.update.$set));
        }
      }
      return { matchedCount, modifiedCount: matchedCount };
    },
  };
}

test('backfill dry-run reads both publication collections and does not write', async () => {
  const linear = memoryCollection([{ _id: 'linear', sessionId, imageModel: 'original-image' }]);
  const interactive = memoryCollection([{ _id: 'interactive', sessionId }], 'interactivepublications');
  const report = await backfillPublicationGenerationModels({
    collections: [linear, interactive],
    sessionCollection: memoryCollection([{ _id: sessionId, inferenceModel: 'source-llm' }]),
    loadAssetModels: async () => ({ image: ['actual-image'], video: ['actual-video'] }),
    batchSize: 1,
  });
  assert.equal(report.mode, 'dry-run');
  assert.equal(linear.writes, 0);
  assert.equal(interactive.writes, 0);
  assert.equal(report.collections[0].eligible, 1);
  assert.equal(report.collections[1].eligible, 1);
  assert.equal(report.collections[0].missingInference, 0);
});

test('backfill applies missing attribution once, preserves snapshots and timestamps, and reports orphaned sources', async () => {
  const collection = memoryCollection([
    { _id: 'linear', sessionId, imageModel: 'original-image', createdAt: 'original-date', updatedAt: 'original-update' },
    { _id: 'orphan', sessionId: 'not-an-id' },
    { _id: 'pending', sessionId, pendingMediaRevision: 'currently-publishing' },
  ]);
  const options = {
    apply: true, collections: [collection],
    sessionCollection: memoryCollection([{ _id: sessionId, inferenceModel: 'source-llm' }]),
    loadAssetModels: async () => ({ image: ['changed-image'], video: ['actual-video'] }),
  };
  const first = await backfillPublicationGenerationModels(options);
  assert.equal(first.collections[0].updated, 2);
  assert.equal(first.collections[0].invalidSessionId, 1);
  assert.equal(first.collections[0].missingImage, 1);
  assert.equal(first.collections[0].pendingPublishSkipped, 1);
  assert.equal(collection.documents[0].imageModel, 'original-image');
  assert.equal(collection.documents[0].inferenceModel, 'source-llm');
  assert.equal(collection.documents[0].createdAt, 'original-date');
  assert.equal(collection.documents[0].updatedAt, 'original-update');
  assert.deepEqual(collection.documents[1].generationModels.missing, ['image', 'video', 'inference']);
  const second = await backfillPublicationGenerationModels(options);
  assert.equal(second.collections[0].eligible, 0);
  assert.equal(second.collections[0].unchanged, 2);
  assert.equal(collection.writes, 1);
});

test('backfill compare-and-set skips a publication changed after the scan', async () => {
  const collection = memoryCollection([{ _id: 'linear', sessionId, updatedAt: 'before' }]);
  const report = await backfillPublicationGenerationModels({
    apply: true, collections: [collection],
    sessionCollection: memoryCollection([{ _id: sessionId, inferenceModel: 'source-llm' }]),
    loadAssetModels: async () => {
      collection.documents[0].updatedAt = 'concurrent-republish';
      collection.documents[0].inferenceModel = 'republished-llm';
      return {};
    },
  });
  assert.equal(report.collections[0].updated, 0);
  assert.equal(report.collections[0].concurrentSkipped, 1);
  assert.equal(collection.documents[0].inferenceModel, 'republished-llm');
  assert.equal(collection.documents[0].generationModels, undefined);
});
