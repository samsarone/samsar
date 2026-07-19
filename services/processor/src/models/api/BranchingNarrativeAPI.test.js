import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';

import GenerationCreditTransaction from '../../schema/GenerationCreditTransaction.js';
import NarrativeRequest from '../../schema/NarrativeRequest.js';
import User from '../../schema/User.js';
import {
  __testOnly__,
  createBranchingNarrativeRequest,
  normalizeCreateBranchingNarrativePayload,
  processCreateBranchingNarrativeRequest,
  validateBranchingSourceRequest,
} from './BranchingNarrativeAPI.js';
import { calculateNarrativeBilling } from './NarrativeBilling.js';

function asLeanQuery(value) {
  return { lean: async () => value };
}

function setConnectionReadyForTest(t) {
  const originalReadyState = mongoose.connection.readyState;
  mongoose.connection.readyState = 1;
  t.after(() => {
    mongoose.connection.readyState = originalReadyState;
  });
}

function buildSource(overrides = {}) {
  return {
    _id: '507f1f77bcf86cd799439011',
    requestType: 'create_single',
    status: 'COMPLETED',
    generationOutcome: 'SUCCEEDED',
    prompt: 'Make a film',
    duration: 30,
    inferenceModel: 'gpt-5.6-sol',
    themeJson: { visualStyle: 'cinematic' },
    narrativeJson: { scenes: [{ visual: 'one' }, { visual: 'two' }], sounds: [] },
    movieResourceList: {
      scenes: [
        {
          visual: 'A detailed opening image establishes the riverside setting.',
          type: 'base',
          duration: 10,
          startTime: 0,
          endTime: 10,
          speaker: '',
        },
        {
          visual: 'A detailed middle image follows a traveler toward the ferry.',
          type: 'base',
          duration: 10,
          startTime: 10,
          endTime: 20,
          speaker: '',
        },
        {
          visual: 'A detailed closing image reveals the ferry crossing at sunset.',
          type: 'base',
          duration: 10,
          startTime: 20,
          endTime: 30,
          speaker: '',
        },
      ],
      sounds: [],
    },
    ...overrides,
  };
}

test('normalizes branching request id aliases and enforces the bounded integer level count', () => {
  assert.deepEqual(
    normalizeCreateBranchingNarrativePayload({
      narrative_request_id: '507f1f77bcf86cd799439011',
      num_levels: '2',
    }),
    {
      sourceRequestId: '507f1f77bcf86cd799439011',
      numLevels: 2,
    },
  );

  assert.throws(
    () => normalizeCreateBranchingNarrativePayload({ num_levels: 1 }),
    (error) => error.code === 'INVALID_NARRATIVE_REQUEST_ID' && error.status === 400,
  );
  for (const invalidLevel of [0, 1.5, 4, null, true, [2]]) {
    assert.throws(
      () => normalizeCreateBranchingNarrativePayload({
        request_id: '507f1f77bcf86cd799439011',
        num_levels: invalidLevel,
      }),
      (error) => error.code === 'INVALID_NUM_LEVELS' && error.status === 400,
    );
  }

  const previousMaxLevels = process.env.NARRATIVE_MAX_BRANCHING_LEVELS;
  try {
    process.env.NARRATIVE_MAX_BRANCHING_LEVELS = '4';
    assert.equal(normalizeCreateBranchingNarrativePayload({
      request_id: '507f1f77bcf86cd799439011',
      num_levels: 4,
    }).numLevels, 4);
  } finally {
    if (previousMaxLevels === undefined) {
      delete process.env.NARRATIVE_MAX_BRANCHING_LEVELS;
    } else {
      process.env.NARRATIVE_MAX_BRANCHING_LEVELS = previousMaxLevels;
    }
  }
});

test('accepts legacy create_single sources without narrativeType and rejects non-singular sources', () => {
  const legacySource = buildSource();
  assert.equal(validateBranchingSourceRequest(legacySource, 2), legacySource);

  assert.throws(
    () => validateBranchingSourceRequest(buildSource({
      requestType: 'create_branching',
      narrativeType: 'branched',
    }), 1),
    (error) => error.code === 'SOURCE_NARRATIVE_NOT_SINGULAR' && error.status === 422,
  );
  assert.throws(
    () => validateBranchingSourceRequest(buildSource({ status: 'PROCESSING' }), 1),
    (error) => error.code === 'SOURCE_NARRATIVE_NOT_COMPLETED' && error.status === 409,
  );
  assert.throws(
    () => validateBranchingSourceRequest(buildSource({ generationOutcome: 'FAILED' }), 1),
    (error) => error.code === 'SOURCE_NARRATIVE_GENERATION_INVALID' && error.status === 422,
  );
});

test('rejects levels that leave no suffix scene to regenerate', () => {
  assert.throws(
    () => validateBranchingSourceRequest(buildSource({
      movieResourceList: {
        scenes: [{ visual: 'one' }, { visual: 'two' }],
        sounds: [],
      },
    }), 2),
    (error) => error.code === 'INVALID_NUM_LEVELS' && error.status === 400,
  );
});

test('submission scopes the source to its owner and creates an isolated branched request', async (t) => {
  setConnectionReadyForTest(t);
  const userId = '507f191e810c19729de860ea';
  const sourceRequestId = '507f1f77bcf86cd799439011';
  const newRequestId = '507f1f77bcf86cd799439012';
  const source = buildSource({
    _id: { toString: () => sourceRequestId },
    narrativeType: 'singular',
    inputPrompt: 'Make a film',
    totalDuration: 30,
    speakerOptions: { ttsModel: 'OPENAI' },
  });
  let sourceLookup = null;
  let createDocument = null;
  const queued = [];

  t.mock.method(GenerationCreditTransaction, 'createIndexes', async () => []);
  t.mock.method(NarrativeRequest, 'createIndexes', async () => []);
  t.mock.method(User, 'findById', () => ({
    select: () => ({ lean: async () => ({ _id: userId, generationCredits: 100 }) }),
  }));
  t.mock.method(NarrativeRequest, 'findOne', (filter) => {
    sourceLookup = filter;
    return asLeanQuery(source);
  });
  t.mock.method(NarrativeRequest, 'create', async (document) => {
    createDocument = document;
    return {
      toObject: () => ({ ...document, _id: newRequestId }),
    };
  });

  const result = await createBranchingNarrativeRequest({
    userId,
    payload: { request_id: sourceRequestId, num_levels: 2 },
    dependencies: {
      queueCreateBranchingNarrativeRequest: (requestId) => queued.push(requestId),
    },
  });

  assert.deepEqual(sourceLookup, { _id: sourceRequestId, userId });
  assert.equal(createDocument.requestType, 'create_branching');
  assert.equal(createDocument.narrativeType, 'branched');
  assert.equal(createDocument.numLevels, 2);
  assert.equal(createDocument.sourceNarrativeRequestId, source._id);
  assert.deepEqual(createDocument.sourceNarrativeSnapshot.movieResourceList, source.movieResourceList);
  assert.notEqual(createDocument.sourceNarrativeSnapshot.movieResourceList, source.movieResourceList);
  assert.deepEqual(queued, [newRequestId]);
  assert.equal(result.status, 'PENDING');
  assert.equal(result.request_type, 'create_branching');
  assert.equal(result.narrative_type, 'branched');
  assert.equal(result.source_narrative_request_id, sourceRequestId);
  assert.equal(result.num_levels, 2);
});

test('branching worker can only claim a branched create_branching request', async (t) => {
  setConnectionReadyForTest(t);
  let claimFilter = null;
  t.mock.method(NarrativeRequest, 'findOneAndUpdate', (filter) => {
    claimFilter = filter;
    return asLeanQuery(null);
  });

  assert.equal(
    await processCreateBranchingNarrativeRequest('507f1f77bcf86cd799439011'),
    null,
  );
  assert.equal(claimFilter.requestType, 'create_branching');
  assert.equal(claimFilter.narrativeType, 'branched');
  assert.deepEqual(claimFilter.$or[0], { status: 'PENDING' });
});

test('recovered branching artifacts use an isolated debit namespace and 1.5x billing', async (t) => {
  setConnectionReadyForTest(t);
  const requestId = '507f1f77bcf86cd799439012';
  const sourceRequestId = '507f1f77bcf86cd799439011';
  const inferenceReceipts = [{
    stage: 'branch_divergence_generation',
    attempt: 1,
    requestKey: 'narrative:create_branching:level-1:root:divergence',
    model: 'gpt-5.6-sol',
    provider: 'openai',
    usage: { inputTokens: 1_000, outputTokens: 100 },
  }, {
    stage: 'branch_movie_resource_generation',
    attempt: 1,
    requestKey: 'narrative:create_branching:level-1:root:path-1',
    model: 'gpt-5.6-sol',
    provider: 'openai',
    usage: { inputTokens: 2_000, outputTokens: 200 },
  }];
  const expectedBilling = calculateNarrativeBilling(inferenceReceipts);
  let storedRequest = {
    _id: { toString: () => requestId },
    userId: '507f191e810c19729de860ea',
    requestType: 'create_branching',
    narrativeType: 'branched',
    sourceNarrativeRequestId: { toString: () => sourceRequestId },
    numLevels: 1,
    status: 'PROCESSING',
    generationOutcome: 'SUCCEEDED',
    prompt: 'Make a film',
    duration: 30,
    inferenceModel: 'gpt-5.6-sol',
    themeJson: { visualStyle: 'cinematic' },
    narrativeJson: { scenes: [{ visual: 'root' }], sounds: [] },
    movieResourceList: {
      structureType: 'branched',
      nodes: [{ nodeId: 'root', scenes: [], sounds: [] }],
    },
    branchingMeta: { rootNodeId: 'root', numLevels: 1 },
    inferenceReceipts,
    billingStatus: 'PENDING',
  };
  let chargeLookup = null;

  t.mock.method(NarrativeRequest, 'findOneAndUpdate', (_filter, update) => {
    storedRequest = { ...storedRequest, ...(update.$set || {}) };
    return asLeanQuery(storedRequest);
  });
  t.mock.method(NarrativeRequest, 'updateOne', async (_filter, update) => {
    storedRequest = { ...storedRequest, ...(update.$set || {}) };
    return { matchedCount: 1, modifiedCount: 1 };
  });
  t.mock.method(GenerationCreditTransaction, 'findOne', (filter) => {
    chargeLookup = filter;
    return {
      sort: async () => ({
        _id: '507f1f77bcf86cd799439013',
        amount: expectedBilling.credits,
        balanceAfter: 80,
      }),
    };
  });
  t.mock.method(User, 'updateOne', async () => ({ matchedCount: 1, modifiedCount: 1 }));

  const result = await processCreateBranchingNarrativeRequest(requestId);

  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.request_type, 'create_branching');
  assert.equal(result.narrative_type, 'branched');
  assert.equal(result.source_narrative_request_id, sourceRequestId);
  assert.equal(result.billing.pricing_multiplier, 1.5);
  assert.equal(result.billing.underlying_credits, expectedBilling.underlyingCredits);
  assert.equal(result.billing.credits_charged, expectedBilling.credits);
  assert.deepEqual(chargeLookup.$or, [
    { idempotencyKey: `narrative:create_branching:${requestId}` },
    {
      source: 'external_narrative_create_branching',
      'metadata.narrativeRequestId': requestId,
    },
  ]);
});

test('fresh worker checkpoints the tree, meters every branching call, and forwards source settings', async (t) => {
  setConnectionReadyForTest(t);
  const requestId = '507f1f77bcf86cd799439014';
  const userId = '507f191e810c19729de860ea';
  const sourceMovieResourceList = buildSource().movieResourceList;
  const rawReceipts = [{
    stage: 'branch_divergence_generation',
    attempt: 1,
    requestKey: 'narrative:create_branching:level-1:parent-root:divergence',
    model: 'gpt-5.6-sol',
    provider: 'openai',
    usage: { input_tokens: 500, output_tokens: 50 },
  }, {
    stage: 'branch_movie_resource_generation',
    attempt: 1,
    requestKey: 'narrative:create_branching:level-1:parent-root:child-0',
    model: 'gpt-5.6-sol',
    provider: 'openai',
    usage: { input_tokens: 700, output_tokens: 100 },
  }, {
    stage: 'branch_movie_resource_generation',
    attempt: 1,
    requestKey: 'narrative:create_branching:level-1:parent-root:child-1',
    model: 'gpt-5.6-sol',
    provider: 'openai',
    usage: { input_tokens: 800, output_tokens: 120 },
  }];
  const expectedBilling = calculateNarrativeBilling(rawReceipts);
  const tree = {
    structureType: 'branched',
    schemaVersion: 1,
    rootNodeId: 'root',
    numLevels: 1,
    branchingFactor: 2,
    branchSceneIndices: [1],
    nodes: [{ nodeId: 'root', scenes: sourceMovieResourceList.scenes, sounds: [] }],
    branchPoints: [],
  };
  const branchingMeta = {
    schemaVersion: 1,
    numLevels: 1,
    branchingFactor: 2,
    rootNodeId: 'root',
    branchSceneIndices: [1],
    branchPoints: [],
    leafNodeIds: ['root.1', 'root.2'],
    nodeCount: 3,
  };
  let storedRequest = {
    _id: { toString: () => requestId },
    userId,
    requestType: 'create_branching',
    narrativeType: 'branched',
    sourceNarrativeRequestId: '507f1f77bcf86cd799439011',
    sourceNarrativeSnapshot: {
      prompt: 'Make a film',
      themeJson: { visualStyle: 'cinematic' },
      narrativeJson: { scenes: [], sounds: [] },
      movieResourceList: sourceMovieResourceList,
    },
    numLevels: 1,
    status: 'PENDING',
    generationOutcome: 'PENDING',
    prompt: 'Make a film',
    duration: 30,
    inferenceModel: 'gpt-5.6-sol',
    videoGenerationModel: 'CUSTOM_SOURCE_MODEL',
    inferenceReceipts: [],
    billingStatus: 'PENDING',
  };
  const writes = [];
  let treeOptions = null;

  t.mock.method(NarrativeRequest, 'findOneAndUpdate', (_filter, update) => {
    storedRequest = { ...storedRequest, ...(update.$set || {}) };
    writes.push(update);
    return asLeanQuery(storedRequest);
  });
  t.mock.method(NarrativeRequest, 'updateOne', async (_filter, update) => {
    if (update.$push?.inferenceReceipts) {
      storedRequest.inferenceReceipts = [
        ...(storedRequest.inferenceReceipts || []),
        update.$push.inferenceReceipts,
      ];
    }
    storedRequest = { ...storedRequest, ...(update.$set || {}) };
    writes.push(update);
    return { matchedCount: 1, modifiedCount: 1 };
  });
  t.mock.method(User, 'exists', async () => ({ _id: userId }));
  t.mock.method(GenerationCreditTransaction, 'findOne', () => ({
    sort: async () => ({
      _id: '507f1f77bcf86cd799439015',
      amount: expectedBilling.credits,
      balanceAfter: 70,
    }),
  }));
  t.mock.method(User, 'updateOne', async () => ({ matchedCount: 1, modifiedCount: 1 }));

  const result = await processCreateBranchingNarrativeRequest(requestId, {
    generateBranchingNarrativeTree: async (options) => {
      treeOptions = options;
      for (const receipt of rawReceipts) await options.onInferenceResponse(receipt);
      await options.onCheckpoint({
        movieResourceList: tree,
        branchingMeta,
        progress: { stage: 'PARENT_EXPANDED', parentNodeId: 'root' },
      });
      return { movieResourceList: tree, branchingMeta, validation: { valid: true } };
    },
  });

  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.billing.pricing_multiplier, 1.5);
  assert.equal(result.billing.credits_charged, expectedBilling.credits);
  assert.equal(treeOptions.requestedDuration, 30);
  assert.equal(treeOptions.videoGenerationModel, 'CUSTOM_SOURCE_MODEL');
  assert.equal(treeOptions.numLevels, 1);
  assert.deepEqual(treeOptions.sourceMovieResourceList, sourceMovieResourceList);
  assert.ok(writes.some((update) => (
    update.$set?.branchingProgress?.progress?.stage === 'PARENT_EXPANDED'
  )));
  const receiptWrites = writes.filter((update) => update.$push?.inferenceReceipts);
  assert.equal(receiptWrites.length, rawReceipts.length);
  assert.deepEqual(
    result.billing.usage,
    expectedBilling.usage,
  );
});

test('existing debit mismatch fails closed instead of completing with inconsistent billing', async (t) => {
  setConnectionReadyForTest(t);
  const requestId = '507f1f77bcf86cd799439016';
  const inferenceReceipts = [{
    stage: 'branch_divergence_generation',
    requestKey: 'narrative:create_branching:level-1:parent-root:divergence',
    model: 'gpt-5.6-sol',
    usage: { inputTokens: 1_000, outputTokens: 100 },
  }];
  let storedRequest = {
    _id: { toString: () => requestId },
    userId: '507f191e810c19729de860ea',
    requestType: 'create_branching',
    narrativeType: 'branched',
    numLevels: 1,
    status: 'PROCESSING',
    generationOutcome: 'SUCCEEDED',
    prompt: 'Make a film',
    duration: 30,
    inferenceModel: 'gpt-5.6-sol',
    themeJson: {},
    narrativeJson: {},
    movieResourceList: { structureType: 'branched', nodes: [] },
    branchingMeta: { rootNodeId: 'root' },
    inferenceReceipts,
    billingStatus: 'PENDING',
  };

  t.mock.method(NarrativeRequest, 'findOneAndUpdate', (_filter, update) => {
    storedRequest = { ...storedRequest, ...(update.$set || {}) };
    return asLeanQuery(storedRequest);
  });
  t.mock.method(NarrativeRequest, 'updateOne', async (_filter, update) => {
    storedRequest = { ...storedRequest, ...(update.$set || {}) };
    return { matchedCount: 1, modifiedCount: 1 };
  });
  t.mock.method(GenerationCreditTransaction, 'findOne', () => ({
    sort: async () => ({
      _id: '507f1f77bcf86cd799439017',
      amount: 999,
      balanceAfter: 0,
    }),
  }));

  const result = await processCreateBranchingNarrativeRequest(requestId);

  assert.equal(result.status, 'FAILED');
  assert.equal(result.error.code, 'NARRATIVE_BILLING_IDEMPOTENCY_CONFLICT');
  assert.equal(result.error.status, 409);
  assert.equal(result.creditsCharged, 0);
});

test('branching constants fix binary fanout and provide a configurable default safety cap', () => {
  assert.equal(__testOnly__.BRANCHING_FACTOR, 2);
  assert.equal(__testOnly__.MAX_BRANCHING_LEVELS, 3);
  assert.equal(
    __testOnly__.getBillingIdempotencyKey('507f1f77bcf86cd799439011'),
    'narrative:create_branching:507f1f77bcf86cd799439011',
  );
});
