import assert from 'node:assert/strict';
import test from 'node:test';

import NarrativeRequest from './NarrativeRequest.js';

test('narrative requests keep standalone mixed artifacts and durable polling fields', () => {
  const paths = NarrativeRequest.schema.paths;

  assert.equal(paths.userId.instance, 'String');
  assert.deepEqual(paths.requestType.enumValues, ['create_single', 'create_branching']);
  assert.deepEqual(paths.narrativeType.enumValues, ['singular', 'branched']);
  assert.equal(paths.narrativeType.defaultValue, 'singular');
  assert.equal(paths.sourceNarrativeRequestId.instance, 'ObjectId');
  assert.equal(paths.sourceNarrativeRequestId.options.ref, 'NarrativeRequest');
  assert.equal(paths.sourceNarrativeSnapshot.instance, 'Mixed');
  assert.equal(paths.numLevels.instance, 'Number');
  assert.equal(paths.branchingMeta.instance, 'Mixed');
  assert.equal(paths.branchingProgress.instance, 'Mixed');
  assert.equal(paths.prompt.instance, 'String');
  assert.equal(paths.duration.instance, 'Number');
  assert.equal(paths.inferenceModel.instance, 'String');
  assert.deepEqual(paths.inferenceModel.enumValues, [
    'gpt-5.6-sol',
    'gemini-3.1-pro',
    'QWEN3.7',
  ]);
  assert.equal(paths.themeJson.instance, 'Mixed');
  assert.equal(paths.narrativeJson.instance, 'Mixed');
  assert.equal(paths.movieResourceList.instance, 'Mixed');
  assert.equal(paths.billingSnapshot.instance, 'Mixed');
  assert.deepEqual(paths.status.enumValues, ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']);
  assert.deepEqual(paths.generationOutcome.enumValues, ['PENDING', 'SUCCEEDED', 'FAILED']);
  assert.equal(paths.pricingMultiplier.defaultValue, 1.5);
  assert.equal(paths.meteringSlotActive.instance, 'Boolean');
  assert.equal(paths.workerLeaseId.instance, 'String');
  assert.equal(paths.expireAt, undefined, 'narrative results must not be TTL-expired');

  const activeSlotIndex = NarrativeRequest.schema.indexes().find(
    ([fields]) => fields.userId === 1 && fields.meteringSlotActive === 1,
  );
  assert.ok(activeSlotIndex);
  assert.equal(activeSlotIndex[1].unique, true);
  assert.deepEqual(activeSlotIndex[1].partialFilterExpression, {
    meteringSlotActive: true,
  });
});

test('narrative request schema supports singular defaults and branching metadata', () => {
  const sourceNarrativeRequestId = '507f1f77bcf86cd799439011';
  const common = {
    userId: 'user-1',
    prompt: 'test',
    inputPrompt: 'test',
    duration: 30,
    totalDuration: 30,
    inferenceModel: 'gpt-5.6-sol',
  };
  const singular = new NarrativeRequest(common);
  const branched = new NarrativeRequest({
    ...common,
    requestType: 'create_branching',
    narrativeType: 'branched',
    sourceNarrativeRequestId,
    sourceNarrativeSnapshot: { movieResourceList: { scenes: [], sounds: [] } },
    numLevels: 2,
    branchingMeta: { rootNodeId: 'root' },
    branchingProgress: { completedNodeIds: [] },
  });

  assert.equal(singular.requestType, 'create_single');
  assert.equal(singular.narrativeType, 'singular');
  assert.equal(branched.validateSync(), undefined);
  assert.equal(branched.requestType, 'create_branching');
  assert.equal(branched.narrativeType, 'branched');
  assert.equal(branched.sourceNarrativeRequestId.toString(), sourceNarrativeRequestId);
  assert.equal(branched.numLevels, 2);
});

test('branching levels must be a positive integer when present', () => {
  const common = {
    userId: 'user-1',
    requestType: 'create_branching',
    narrativeType: 'branched',
    prompt: 'test',
    inputPrompt: 'test',
    duration: 30,
    totalDuration: 30,
    inferenceModel: 'gpt-5.6-sol',
  };

  const zeroLevels = new NarrativeRequest({ ...common, numLevels: 0 }).validateSync();
  const fractionalLevels = new NarrativeRequest({ ...common, numLevels: 1.5 }).validateSync();
  const configurableLevels = new NarrativeRequest({ ...common, numLevels: 4 }).validateSync();
  const excessiveLevels = new NarrativeRequest({ ...common, numLevels: 7 }).validateSync();

  assert.ok(zeroLevels.errors.numLevels);
  assert.ok(fractionalLevels.errors.numLevels);
  assert.equal(configurableLevels, undefined);
  assert.ok(excessiveLevels.errors.numLevels);
});

test('narrative request schema rejects unsupported models and durations over 240 seconds', () => {
  const invalid = new NarrativeRequest({
    userId: 'user-1',
    prompt: 'test',
    inputPrompt: 'test',
    duration: 241,
    totalDuration: 241,
    inferenceModel: 'unsupported',
  }).validateSync();

  assert.ok(invalid.errors.duration);
  assert.ok(invalid.errors.totalDuration);
  assert.ok(invalid.errors.inferenceModel);
});
