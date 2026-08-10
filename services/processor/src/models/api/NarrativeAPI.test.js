import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';

import GenerationCreditTransaction from '../../schema/GenerationCreditTransaction.js';
import NarrativeRequest from '../../schema/NarrativeRequest.js';
import User from '../../schema/User.js';

import {
  __testOnly__,
  NARRATIVE_BILLING_POLICIES,
  buildNarrativeRequestPayload,
  createSingleNarrativeRequest,
  finalizeNarrativeMovieResourceList,
  getSingleNarrativeRequest,
  normalizeCreateSingleNarrativePayload,
  processCreateSingleNarrativeRequest,
  resolveNarrativeInferenceModel,
} from './NarrativeAPI.js';
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

test('normalizes the create_single prompt, duration, and inference model aliases', () => {
  assert.deepEqual(
    normalizeCreateSingleNarrativePayload({
      prompt: '  Make a concise film  ',
      duration: 240,
      inference_model: 'QWEN3.8',
    }),
    {
      prompt: 'Make a concise film',
      duration: 240,
      inference_model: 'QWEN3.8',
      inferenceModel: 'QWEN3.8',
      video_model: 'RUNWAYML',
      videoGenerationModel: 'RUNWAYML',
    },
  );

  assert.deepEqual(
    normalizeCreateSingleNarrativePayload({
      input: {
        prompt: 'Deep technical film',
        duration: 30,
        inferenceModel: 'gpt-5.6-sol',
        reasoningEffort: 'xhigh',
      },
    }),
    {
      prompt: 'Deep technical film',
      duration: 30,
      inference_model: 'gpt-5.6-sol',
      inferenceModel: 'gpt-5.6-sol',
      effort: 'xhigh',
      video_model: 'RUNWAYML',
      videoGenerationModel: 'RUNWAYML',
    },
  );
});

test('normalizes and validates the video model used to size narrative speech', () => {
  const normalized = normalizeCreateSingleNarrativePayload({
    prompt: 'Make a concise film',
    duration: 30,
    video_model: 'COSMOS3SUPERI2V',
  });

  assert.equal(normalized.video_model, 'COSMOS3SUPERI2V');
  assert.equal(normalized.videoGenerationModel, 'COSMOS3SUPERI2V');
  assert.throws(
    () => normalizeCreateSingleNarrativePayload({
      prompt: 'Make a concise film',
      duration: 30,
      video_model: 'UNKNOWN_MODEL',
    }),
    (error) => error.code === 'INVALID_VIDEO_MODEL' && error.status === 400,
  );
  assert.throws(
    () => normalizeCreateSingleNarrativePayload({
      prompt: 'Make a concise film',
      duration: 30,
      video_model: 'RUNWAYML',
      videoModel: 'COSMOS3SUPERI2V',
    }),
    (error) => error.code === 'CONFLICTING_VIDEO_MODEL' && error.status === 400,
  );
});

test('rejects missing prompts and durations outside the text-to-video range', () => {
  assert.throws(
    () => normalizeCreateSingleNarrativePayload({ duration: 10 }),
    (error) => error.code === 'INVALID_PROMPT' && error.status === 400,
  );
  assert.throws(
    () => normalizeCreateSingleNarrativePayload({ prompt: 'test', duration: 9 }),
    (error) => error.code === 'INVALID_DURATION' && error.status === 400,
  );
  assert.throws(
    () => normalizeCreateSingleNarrativePayload({ prompt: 'test', duration: 241 }),
    (error) => error.code === 'INVALID_DURATION' && error.status === 400,
  );
});

test('uses strict text-to-video inference aliases and falls back to the user selection', () => {
  assert.equal(
    resolveNarrativeInferenceModel({ inference_model: 'GPT5.6' }, 'QWEN3.8'),
    'gpt-5.6-sol',
  );
  assert.equal(
    resolveNarrativeInferenceModel({ inference_model: 'GEMINI3.1' }, 'QWEN3.8'),
    'gemini-3.1-pro',
  );
  assert.equal(resolveNarrativeInferenceModel({}, 'QWEN3.8'), 'QWEN3.8');
  assert.equal(
    resolveNarrativeInferenceModel(
      { inference_model: 'gpt-5.6-sol', effort: 'xhigh' },
      'gpt-5.6-sol',
      'high',
    ),
    'gpt-5.6-sol-xhigh',
  );
  assert.equal(
    resolveNarrativeInferenceModel(
      { inference_model: 'gpt-5.6-sol-xhigh' },
      'gpt-5.6-sol',
      'high',
    ),
    'gpt-5.6-sol-xhigh',
  );
  assert.equal(
    resolveNarrativeInferenceModel(
      { inference_model: 'gpt-5.6-sol-high' },
      'gpt-5.6-sol',
      'xhigh',
    ),
    'gpt-5.6-sol',
  );
  assert.equal(
    resolveNarrativeInferenceModel({}, 'gpt-5.6-sol', 'xhigh'),
    'gpt-5.6-sol-xhigh',
  );
  assert.throws(
    () => resolveNarrativeInferenceModel({ inference_model: 'unknown-model' }, 'QWEN3.8'),
    (error) => error.status === 400 && /inference_model/.test(error.message),
  );
});

test('submission persists request and saved GPT 5.6 Sol effort as the worker model', async (t) => {
  setConnectionReadyForTest(t);
  const userId = '507f191e810c19729de860ea';
  const createdDocuments = [];

  t.mock.method(GenerationCreditTransaction, 'createIndexes', async () => []);
  t.mock.method(NarrativeRequest, 'createIndexes', async () => []);
  t.mock.method(User, 'findById', () => ({
    select: () => ({
      lean: async () => ({
        _id: userId,
        generationCredits: 100,
        selectedInferenceModel: 'gpt-5.6-sol',
        selectedInferenceEffort: 'xhigh',
        speakerOptions: null,
      }),
    }),
  }));
  t.mock.method(NarrativeRequest, 'create', async (document) => {
    createdDocuments.push(document);
    const suffix = createdDocuments.length === 1 ? '21' : '22';
    return {
      toObject: () => ({
        ...document,
        _id: `507f1f77bcf86cd7994390${suffix}`,
      }),
    };
  });

  await createSingleNarrativeRequest({
    userId,
    payload: { prompt: 'Use my saved effort.', duration: 30 },
    dependencies: { queueCreateSingleNarrativeRequest: () => true },
  });
  await createSingleNarrativeRequest({
    userId,
    payload: {
      prompt: 'Override the saved effort.',
      duration: 30,
      inference_model: 'gpt-5.6-sol',
      effort: 'high',
    },
    dependencies: { queueCreateSingleNarrativeRequest: () => true },
  });

  assert.equal(createdDocuments[0].inferenceModel, 'gpt-5.6-sol-xhigh');
  assert.equal(createdDocuments[1].inferenceModel, 'gpt-5.6-sol');
});

test('skips full normalization after localized speech repair and preserves enriched sounds', () => {
  const scenes = Array.from({ length: 5 }, (_unused, sceneIndex) => ({
    visual: `Scene ${sceneIndex}.`,
    type: 'character',
  }));
  const sounds = Array.from({ length: 8 }, (_unused, soundIndex) => ({
    type: 'speech',
    subType: 'character',
    actor: soundIndex % 2 === 0 ? 'Athena' : 'Narrator',
    gender: soundIndex % 2 === 0 ? 'F' : 'M',
    sceneIndex: soundIndex % scenes.length,
    audio: `Repaired line ${soundIndex}.`,
  }));
  const rawNarrativeJson = { scenes, sounds };
  const enrichedMovieResourceList = {
    scenes: scenes.map((scene) => ({ ...scene, imagePrompt: `Image: ${scene.visual}` })),
    sounds: sounds.map((sound) => ({
      ...sound,
      speaker: sound.actor === 'Athena' ? 'shimmer' : 'echo',
      provider: 'OPENAI',
      speakerCharacterName: sound.actor,
    })),
  };
  let validationCalls = 0;

  const finalized = finalizeNarrativeMovieResourceList({
    narrative: {
      speechRepairs: 3,
      validation: {
        valid: true,
        errors: [],
        violations: { speechCharacterLimits: [] },
      },
    },
    rawNarrativeJson,
    movieResourceList: enrichedMovieResourceList,
    videoGenerationModel: 'COSMOS3SUPERI2V',
    inferenceModel: 'QWEN3.8',
    requestedDuration: 40,
    validateNarrative: () => {
      validationCalls += 1;
      throw new Error('full validation must not rerun after localized speech repair');
    },
  });

  assert.equal(validationCalls, 0);
  assert.equal(finalized.validation.valid, true);
  assert.equal(finalized.validation.fullValidationSkippedAfterSpeechRepair, true);
  assert.equal(finalized.movieResourceList.sounds.length, 8);
  assert.deepEqual(finalized.movieResourceList, enrichedMovieResourceList);
  assert.notEqual(finalized.movieResourceList, enrichedMovieResourceList);
  assert.deepEqual(
    finalized.movieResourceList.sounds.map(({ audio }) => audio),
    sounds.map(({ audio }) => audio),
  );
});

test('rejects enrichment that loses repaired sounds instead of normalizing the loss', () => {
  const rawNarrativeJson = {
    scenes: Array.from({ length: 5 }, (_unused, sceneIndex) => ({
      visual: `Scene ${sceneIndex}.`,
      type: 'character',
    })),
    sounds: Array.from({ length: 8 }, (_unused, soundIndex) => ({
      type: 'speech',
      subType: 'character',
      actor: 'Athena',
      gender: 'F',
      sceneIndex: soundIndex % 5,
      audio: `Line ${soundIndex}.`,
    })),
  };
  const movieResourceList = {
    scenes: rawNarrativeJson.scenes.map((scene) => ({ ...scene })),
    sounds: rawNarrativeJson.sounds.slice(0, 5).map((sound) => ({ ...sound })),
  };

  assert.throws(
    () => finalizeNarrativeMovieResourceList({
      narrative: { speechRepairs: 3, validation: { valid: true, errors: [] } },
      rawNarrativeJson,
      movieResourceList,
      validateNarrative: () => {
        throw new Error('full validation must not run');
      },
    }),
    (error) => (
      error.code === 'MOVIE_RESOURCE_LIST_SOUND_PRESERVATION_FAILED' &&
      /sounds 8→5/.test(error.message)
    ),
  );
});

test('submission persists the selected video model for model-aware speech generation', async (t) => {
  setConnectionReadyForTest(t);
  const userId = '507f191e810c19729de860ea';
  const requestId = '507f1f77bcf86cd799439011';
  let createdDocument = null;
  const queued = [];

  t.mock.method(GenerationCreditTransaction, 'createIndexes', async () => []);
  t.mock.method(NarrativeRequest, 'createIndexes', async () => []);
  t.mock.method(User, 'findById', () => ({
    select: () => ({
      lean: async () => ({
        _id: userId,
        generationCredits: 100,
        selectedInferenceModel: 'QWEN3.8',
        speakerOptions: null,
      }),
    }),
  }));
  t.mock.method(NarrativeRequest, 'create', async (document) => {
    createdDocument = document;
    return { toObject: () => ({ ...document, _id: requestId }) };
  });

  const result = await createSingleNarrativeRequest({
    userId,
    minimumSceneCount: 3,
    payload: {
      prompt: 'Create a short journey.',
      duration: 30,
      video_model: 'COSMOS3SUPERI2V',
    },
    dependencies: {
      queueCreateSingleNarrativeRequest: (id) => queued.push(id),
    },
  });

  assert.equal(createdDocument.videoGenerationModel, 'COSMOS3SUPERI2V');
  assert.equal(createdDocument.minimumSceneCount, 3);
  assert.equal(result.video_model, 'COSMOS3SUPERI2V');
  assert.deepEqual(queued, [requestId]);
});

test('interactive-video narrative admission does not require a separate credit balance', async (t) => {
  setConnectionReadyForTest(t);
  const userId = '507f191e810c19729de860ea';
  const requestId = '507f1f77bcf86cd799439012';
  let createdDocument = null;

  t.mock.method(GenerationCreditTransaction, 'createIndexes', async () => []);
  t.mock.method(NarrativeRequest, 'createIndexes', async () => []);
  t.mock.method(User, 'findById', () => ({
    select: () => ({
      lean: async () => ({
        _id: userId,
        generationCredits: 0,
        selectedInferenceModel: 'QWEN3.8',
        speakerOptions: null,
      }),
    }),
  }));
  t.mock.method(NarrativeRequest, 'create', async (document) => {
    createdDocument = document;
    return { toObject: () => ({ ...document, _id: requestId }) };
  });

  const result = await createSingleNarrativeRequest({
    userId,
    payload: {
      prompt: 'Create the shared opening narrative.',
      duration: 30,
      video_model: 'COSMOS3SUPERI2V',
    },
    billingPolicy: NARRATIVE_BILLING_POLICIES.INCLUDED_IN_INTERACTIVE_VIDEO_RATE,
    dependencies: { queueCreateSingleNarrativeRequest: () => true },
  });

  assert.equal(result.status, 'PENDING');
  assert.equal(
    createdDocument.billingPolicy,
    NARRATIVE_BILLING_POLICIES.INCLUDED_IN_INTERACTIVE_VIDEO_RATE,
  );
});

test('completed polling payload returns the three requested narrative artifacts', () => {
  const result = buildNarrativeRequestPayload({
    _id: { toString: () => '507f1f77bcf86cd799439011' },
    status: 'COMPLETED',
    prompt: 'Make a film',
    duration: 30,
    inferenceModel: 'gpt-5.6-sol',
    themeJson: { style: ['cinematic'] },
    narrativeJson: { scenes: [{ visual: 'raw' }], sounds: [] },
    movieResourceList: { scenes: [{ visual: 'enriched' }], sounds: [] },
    pricingMultiplier: 1.5,
    underlyingCostUsd: 0.1,
    underlyingCredits: 10,
    creditsCharged: 15,
    remainingCredits: 85,
  });

  assert.equal(result.request_id, '507f1f77bcf86cd799439011');
  assert.equal(result.status, 'COMPLETED');
  assert.deepEqual(result.themeJson, { style: ['cinematic'] });
  assert.deepEqual(result.narrativeJson.scenes, [{ visual: 'raw' }]);
  assert.deepEqual(result.movieResourceList.scenes, [{ visual: 'enriched' }]);
  assert.equal(result.billing.pricing_multiplier, 1.5);
  assert.equal(result.billing.credits_charged, 15);
});

test('branching polling payload exposes its source, level count, and compact tree metadata', () => {
  const result = buildNarrativeRequestPayload({
    _id: '507f1f77bcf86cd799439012',
    requestType: 'create_branching',
    narrativeType: 'branched',
    sourceNarrativeRequestId: { toString: () => '507f1f77bcf86cd799439011' },
    numLevels: 2,
    status: 'COMPLETED',
    prompt: 'Make a film',
    duration: 30,
    inferenceModel: 'gpt-5.6-sol',
    themeJson: {},
    narrativeJson: { scenes: [], sounds: [] },
    movieResourceList: { structureType: 'branched', nodes: [] },
    branchingMeta: { rootNodeId: 'root', leafNodeIds: [] },
  });

  assert.equal(result.request_type, 'create_branching');
  assert.equal(result.narrative_type, 'branched');
  assert.equal(result.source_narrative_request_id, '507f1f77bcf86cd799439011');
  assert.equal(result.num_levels, 2);
  assert.deepEqual(result.branchingMeta, { rootNodeId: 'root', leafNodeIds: [] });
});

test('failed polling payload retains billing details and the mapped request error', () => {
  const result = buildNarrativeRequestPayload({
    _id: '507f1f77bcf86cd799439011',
    status: 'FAILED',
    prompt: 'Make a film',
    duration: 30,
    inferenceModel: 'gpt-5.6-sol',
    errorMessage: 'Not enough generation credits.',
    errorCode: 'INSUFFICIENT_CREDITS',
    errorStatus: 402,
    pricingMultiplier: 1.5,
    underlyingCostUsd: 0.1,
    underlyingCredits: 10,
    creditsCharged: 0,
    remainingCredits: 0,
  });

  assert.deepEqual(result.error, {
    message: 'Not enough generation credits.',
    code: 'INSUFFICIENT_CREDITS',
    status: 402,
  });
  assert.deepEqual(result.billing, {
    pricing_multiplier: 1.5,
    underlying_cost_usd: 0.1,
    underlying_credits: 10,
    credits_charged: 0,
    remaining_credits: 0,
    usage: null,
  });
  assert.equal('themeJson' in result, false);
  assert.equal('movieResourceList' in result, false);
  assert.equal('narrativeJson' in result, false);
});

test('a worker that does not acquire the pending or expired lease performs no work', async (t) => {
  setConnectionReadyForTest(t);
  const requestId = '507f1f77bcf86cd799439011';
  let claimFilter = null;
  let claimUpdate = null;

  t.mock.method(NarrativeRequest, 'findOneAndUpdate', (filter, update) => {
    claimFilter = filter;
    claimUpdate = update;
    return asLeanQuery(null);
  });
  const updateMock = t.mock.method(NarrativeRequest, 'updateOne', async () => {
    throw new Error('an unowned worker must not write');
  });
  const transactionMock = t.mock.method(GenerationCreditTransaction, 'findOne', () => {
    throw new Error('an unowned worker must not inspect billing');
  });

  assert.equal(await processCreateSingleNarrativeRequest(requestId), null);
  assert.equal(updateMock.mock.callCount(), 0);
  assert.equal(transactionMock.mock.callCount(), 0);
  assert.equal(claimFilter._id, requestId);
  assert.deepEqual(claimFilter.$or[0], { status: 'PENDING' });
  assert.equal(claimFilter.$or[1].status, 'PROCESSING');
  assert.deepEqual(claimFilter.$or[1].$or[0], { workerLeaseExpiresAt: null });
  assert.ok(claimFilter.$or[1].$or[1].workerLeaseExpiresAt.$lte instanceof Date);
  assert.equal(claimUpdate.$set.status, 'PROCESSING');
  assert.equal(claimUpdate.$set.meteringSlotActive, true);
  assert.match(claimUpdate.$set.workerLeaseId, /^[0-9a-f-]{36}$/i);
  assert.ok(claimUpdate.$set.workerLeaseExpiresAt instanceof Date);
  assert.equal(claimUpdate.$inc.processingAttempts, 1);
});

test('a second active narrative request waits for the user metering slot', async (t) => {
  setConnectionReadyForTest(t);
  const requestId = '507f1f77bcf86cd799439010';
  const duplicateSlotError = Object.assign(new Error('duplicate metering slot'), {
    code: 11000,
  });

  t.mock.method(NarrativeRequest, 'findOneAndUpdate', () => ({
    lean: async () => {
      throw duplicateSlotError;
    },
  }));
  const requestWrite = t.mock.method(NarrativeRequest, 'updateOne', async () => {
    throw new Error('a request waiting for the metering slot must not write');
  });
  const userLookup = t.mock.method(User, 'exists', async () => {
    throw new Error('a request waiting for the metering slot must not run inference admission');
  });

  assert.equal(await processCreateSingleNarrativeRequest(requestId), null);
  assert.equal(requestWrite.mock.callCount(), 0);
  assert.equal(userLookup.mock.callCount(), 0);
});

test('polling is scoped to the authenticated user and create_single request type', async (t) => {
  setConnectionReadyForTest(t);
  const requestId = '507f1f77bcf86cd799439011';
  const userId = '507f191e810c19729de860ea';
  let lookup = null;

  t.mock.method(NarrativeRequest, 'findOne', (filter) => {
    lookup = filter;
    return asLeanQuery({
      _id: requestId,
      userId,
      requestType: 'create_single',
      status: 'COMPLETED',
      prompt: 'Make a film',
      duration: 30,
      inferenceModel: 'gpt-5.6-sol',
      themeJson: {},
      narrativeJson: { scenes: [] },
      movieResourceList: { scenes: [] },
    });
  });

  const result = await getSingleNarrativeRequest({ userId, requestId });

  assert.equal(result.status, 'COMPLETED');
  assert.deepEqual(lookup, {
    _id: requestId,
    userId,
    requestType: 'create_single',
  });
});

test('a recovered worker reuses persisted artifacts and an existing narrative debit', async (t) => {
  setConnectionReadyForTest(t);
  const requestId = '507f1f77bcf86cd799439011';
  const inferenceReceipts = [{
    stage: 'narrative_generation',
    attempt: 1,
    requestKey: 'narrative:create_single:narrative',
    model: 'gpt-5.6-sol',
    provider: 'openai',
    usage: {
      inputTokens: 1_000,
      outputTokens: 100,
      cachedInputTokens: 200,
      reasoningTokens: 20,
    },
  }];
  const expectedBilling = calculateNarrativeBilling(inferenceReceipts);
  const claimedRequest = {
    _id: { toString: () => requestId },
    userId: '507f191e810c19729de860ea',
    status: 'PROCESSING',
    prompt: 'Make a film',
    duration: 30,
    inferenceModel: 'gpt-5.6-sol',
    videoGenerationModel: 'RUNWAYML',
    videoTone: 'grounded',
    themeJson: { style: ['cinematic'] },
    narrativeJson: { scenes: [{ visual: 'raw' }], sounds: [] },
    movieResourceList: { scenes: [{ visual: 'enriched' }], sounds: [] },
    validation: { narrative: { valid: true }, movieResourceList: { valid: true } },
    inferenceReceipts,
    pricingMultiplier: 1.5,
    billingStatus: 'PENDING',
  };
  const writes = [];
  let chargeLookup = null;
  let storedRequest = { ...claimedRequest };
  let workerLeaseId = null;

  t.mock.method(NarrativeRequest, 'findOneAndUpdate', (filter, update) => {
    if (update.$set?.status === 'PROCESSING') {
      workerLeaseId = update.$set.workerLeaseId;
    }
    storedRequest = { ...storedRequest, ...(update.$set || {}) };
    writes.push({ filter, update });
    return asLeanQuery(storedRequest);
  });
  t.mock.method(NarrativeRequest, 'updateOne', async (filter, update) => {
    writes.push({ filter, update });
    storedRequest = { ...storedRequest, ...(update.$set || {}) };
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
  });
  t.mock.method(GenerationCreditTransaction, 'findOne', (filter) => {
    chargeLookup = filter;
    return {
      sort: async () => ({
        _id: '507f1f77bcf86cd799439012',
        amount: expectedBilling.credits,
        balanceAfter: 92.5,
      }),
    };
  });
  t.mock.method(User, 'updateOne', async () => ({ matchedCount: 1, modifiedCount: 1 }));

  const result = await processCreateSingleNarrativeRequest(requestId);

  assert.equal(result.status, 'COMPLETED');
  assert.deepEqual(result.themeJson, claimedRequest.themeJson);
  assert.deepEqual(result.narrativeJson, claimedRequest.narrativeJson);
  assert.deepEqual(result.movieResourceList, claimedRequest.movieResourceList);
  assert.equal(result.billing.pricing_multiplier, 1.5);
  assert.equal(result.billing.underlying_cost_usd, expectedBilling.underlyingCostUsd);
  assert.equal(result.billing.underlying_credits, expectedBilling.underlyingCredits);
  assert.equal(result.billing.credits_charged, expectedBilling.credits);
  assert.equal(result.billing.remaining_credits, 92.5);
  assert.equal(storedRequest.meteringSlotActive, false);
  assert.deepEqual(chargeLookup, {
    userId: claimedRequest.userId,
    direction: 'debit',
    $or: [
      { idempotencyKey: `narrative:create_single:${requestId}` },
      {
        source: 'external_narrative_create_single',
        'metadata.narrativeRequestId': requestId,
      },
    ],
  });
  const persistedBilling = writes.find(({ update }) => update.$set?.inferenceUsage);
  assert.ok(persistedBilling, 'the recovered receipts must be re-priced and persisted');
  assert.deepEqual(persistedBilling.update.$set.inferenceUsage, expectedBilling.usage);
  assert.deepEqual(persistedBilling.update.$set.inferenceReceipts, expectedBilling.receipts);
  const ownedWrites = writes.filter(({ filter }) => filter.status === 'PROCESSING');
  assert.ok(ownedWrites.length >= 2);
  assert.ok(ownedWrites.every(({ filter }) => filter.workerLeaseId === workerLeaseId));
});

test('an interactive-video singular stage records usage but never debits narrative credits', async (t) => {
  setConnectionReadyForTest(t);
  const requestId = '507f1f77bcf86cd799439021';
  let storedRequest = {
    _id: { toString: () => requestId },
    userId: '507f191e810c19729de860ea',
    requestType: 'create_single',
    narrativeType: 'singular',
    status: 'PROCESSING',
    generationOutcome: 'SUCCEEDED',
    prompt: 'Make a film',
    duration: 30,
    inferenceModel: 'gpt-5.6-sol',
    videoGenerationModel: 'RUNWAYML',
    videoTone: 'grounded',
    themeJson: { style: ['cinematic'] },
    narrativeJson: { scenes: [{ visual: 'raw' }], sounds: [] },
    movieResourceList: { scenes: [{ visual: 'enriched' }], sounds: [] },
    validation: { narrative: { valid: true }, movieResourceList: { valid: true } },
    inferenceReceipts: [{
      stage: 'narrative_generation',
      requestKey: 'narrative:create_single:narrative',
      model: 'gpt-5.6-sol',
      provider: 'openai',
      usage: { inputTokens: 1_000, outputTokens: 100 },
    }],
    billingStatus: 'PENDING',
    billingPolicy: 'included_in_interactive_video_rate',
  };

  t.mock.method(NarrativeRequest, 'findOneAndUpdate', (_filter, update) => {
    storedRequest = { ...storedRequest, ...(update.$set || {}) };
    return asLeanQuery(storedRequest);
  });
  t.mock.method(NarrativeRequest, 'updateOne', async (_filter, update) => {
    storedRequest = { ...storedRequest, ...(update.$set || {}) };
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
  });
  const transactionLookup = t.mock.method(GenerationCreditTransaction, 'findOne', () => {
    throw new Error('interactive narrative stages must not inspect or create debit transactions');
  });

  const result = await processCreateSingleNarrativeRequest(requestId);

  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.billing.credits_charged, 0);
  assert.equal(result.billing.policy, 'included_in_interactive_video_rate');
  assert.equal(result.billing.reason, 'included_in_interactive_video_rate');
  assert.equal(storedRequest.billingStatus, 'WAIVED');
  assert.equal(transactionLookup.mock.callCount(), 0);
});

test('a worker fails closed when any persisted inference receipt cannot be billed', async (t) => {
  setConnectionReadyForTest(t);
  const requestId = '507f1f77bcf86cd799439011';
  let storedRequest = {
    _id: { toString: () => requestId },
    userId: '507f191e810c19729de860ea',
    status: 'PROCESSING',
    prompt: 'Make a film',
    duration: 30,
    inferenceModel: 'gpt-5.6-sol',
    videoGenerationModel: 'RUNWAYML',
    videoTone: 'grounded',
    themeJson: { style: ['cinematic'] },
    narrativeJson: { scenes: [{ visual: 'raw' }], sounds: [] },
    movieResourceList: { scenes: [{ visual: 'enriched' }], sounds: [] },
    inferenceReceipts: [
      {
        stage: 'theme_generation',
        model: 'gpt-5.6-sol',
        usage: { inputTokens: 1_000, outputTokens: 100 },
      },
      {
        stage: 'narrative_generation',
        model: 'unknown-provider/model',
        usage: { inputTokens: 2_000, outputTokens: 200 },
      },
    ],
    billingStatus: 'PENDING',
  };

  t.mock.method(NarrativeRequest, 'findOneAndUpdate', (_filter, update) => {
    storedRequest = { ...storedRequest, ...(update.$set || {}) };
    return asLeanQuery(storedRequest);
  });
  t.mock.method(NarrativeRequest, 'updateOne', async (_filter, update) => {
    storedRequest = { ...storedRequest, ...(update.$set || {}) };
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
  });
  const transactionMock = t.mock.method(GenerationCreditTransaction, 'findOne', () => ({
    sort: async () => ({ amount: 1, balanceAfter: 99 }),
  }));

  const result = await processCreateSingleNarrativeRequest(requestId);

  assert.equal(result.status, 'FAILED');
  assert.equal(result.error.status, 502);
  assert.match(result.error.code, /^INFERENCE_(?:BILLING|USAGE)_/);
  assert.equal(result.creditsCharged, 0);
  assert.equal(transactionMock.mock.callCount(), 0);
});

test('a fresh request with no available credits fails as 402 before inference', async (t) => {
  setConnectionReadyForTest(t);
  const requestId = '507f1f77bcf86cd799439011';
  let storedRequest = {
    _id: { toString: () => requestId },
    userId: '507f191e810c19729de860ea',
    status: 'PENDING',
    prompt: 'Make a film',
    duration: 30,
    inferenceModel: 'gpt-5.6-sol',
    videoGenerationModel: 'RUNWAYML',
    videoTone: 'grounded',
    inferenceReceipts: [],
    billingStatus: 'PENDING',
  };
  const writes = [];

  t.mock.method(NarrativeRequest, 'findOneAndUpdate', (filter, update) => {
    writes.push({ filter, update });
    storedRequest = { ...storedRequest, ...(update.$set || {}) };
    return asLeanQuery(storedRequest);
  });
  t.mock.method(NarrativeRequest, 'updateOne', async (filter, update) => {
    writes.push({ filter, update });
    storedRequest = { ...storedRequest, ...(update.$set || {}) };
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
  });
  const creditOwnerMock = t.mock.method(User, 'exists', async () => null);
  const transactionMock = t.mock.method(GenerationCreditTransaction, 'findOne', () => {
    throw new Error('zero-credit preflight failure must not inspect the debit ledger');
  });

  const result = await processCreateSingleNarrativeRequest(requestId);

  assert.equal(result.status, 'FAILED');
  assert.deepEqual(result.error, {
    message: 'Insufficient credits',
    code: 'INSUFFICIENT_CREDITS',
    status: 402,
  });
  assert.equal(result.creditsCharged, 0);
  assert.equal(result.billing.credits_charged, 0);
  assert.equal(creditOwnerMock.mock.callCount(), 1);
  assert.equal(transactionMock.mock.callCount(), 0);
  const workerLeaseId = writes[0].update.$set.workerLeaseId;
  assert.ok(writes.slice(1).every(({ filter }) => (
    filter.workerLeaseId === workerLeaseId && filter.status === 'PROCESSING'
  )));
});

test('a generation failure checkpoint is persisted before billing begins', async (t) => {
  setConnectionReadyForTest(t);
  const requestId = '507f1f77bcf86cd799439013';
  let storedRequest = {
    _id: { toString: () => requestId },
    userId: '507f191e810c19729de860ea',
    status: 'PENDING',
    generationOutcome: 'PENDING',
    prompt: 'Make a film',
    duration: 30,
    inferenceModel: 'gpt-5.6-sol',
    videoGenerationModel: 'RUNWAYML',
    videoTone: 'grounded',
    inferenceReceipts: [],
    billingStatus: 'PENDING',
  };
  const writes = [];

  t.mock.method(NarrativeRequest, 'findOneAndUpdate', (filter, update) => {
    writes.push({ kind: 'findOneAndUpdate', filter, update });
    storedRequest = { ...storedRequest, ...(update.$set || {}) };
    return asLeanQuery(storedRequest);
  });
  t.mock.method(NarrativeRequest, 'updateOne', async (filter, update) => {
    writes.push({ kind: 'updateOne', filter, update });
    storedRequest = { ...storedRequest, ...(update.$set || {}) };
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
  });
  t.mock.method(User, 'exists', async () => {
    const error = new Error('Generation admission failed');
    error.code = 'GENERATION_ADMISSION_FAILED';
    error.status = 503;
    throw error;
  });
  const transactionMock = t.mock.method(GenerationCreditTransaction, 'findOne', () => {
    throw new Error('a zero-usage failure must not inspect the debit ledger');
  });

  const result = await processCreateSingleNarrativeRequest(requestId);

  assert.equal(result.status, 'FAILED');
  assert.deepEqual(result.error, {
    message: 'Generation admission failed',
    code: 'GENERATION_ADMISSION_FAILED',
    status: 503,
  });
  assert.equal(transactionMock.mock.callCount(), 0);

  const checkpointIndex = writes.findIndex(({ update }) => (
    update.$set?.generationOutcome === 'FAILED'
  ));
  const billingIndex = writes.findIndex(({ update }) => (
    Object.hasOwn(update.$set || {}, 'inferenceUsage')
  ));
  assert.ok(checkpointIndex > 0, 'the failed generation must be durably checkpointed');
  assert.ok(billingIndex > checkpointIndex, 'billing must start after the generation checkpoint');
  assert.equal(
    writes[checkpointIndex].update.$set.generationFailureCode,
    'GENERATION_ADMISSION_FAILED',
  );
  assert.equal(writes[checkpointIndex].update.$set.generationFailureStatus, 503);
});

test('recovery of a failed generation reuses its billing snapshot without rerunning inference', async (t) => {
  setConnectionReadyForTest(t);
  const requestId = '507f1f77bcf86cd799439014';
  const userId = '507f191e810c19729de860ea';
  const inferenceReceipts = [{
    stage: 'narrative_generation',
    attempt: 1,
    validationAttempt: 1,
    requestKey: 'narrative:create_single:narrative',
    model: 'gpt-5.6-sol',
    provider: 'openai',
    usage: {
      inputTokens: 1_000,
      outputTokens: 100,
      cachedInputTokens: 200,
      reasoningTokens: 20,
    },
  }];
  const originalReceipts = structuredClone(inferenceReceipts);
  const expectedBilling = calculateNarrativeBilling(inferenceReceipts);
  const billingSnapshot = {
    ...expectedBilling,
    costUsd: expectedBilling.costUsd + 0.01,
    underlyingCostUsd: expectedBilling.underlyingCostUsd + 0.01,
    underlyingCredits: expectedBilling.underlyingCredits + 1,
    credits: expectedBilling.credits + 1.5,
  };
  let storedRequest = {
    _id: { toString: () => requestId },
    userId,
    status: 'PROCESSING',
    generationOutcome: 'FAILED',
    generationFinishedAt: new Date('2026-07-18T00:00:00.000Z'),
    generationFailureMessage: 'Narrative provider failed',
    generationFailureCode: 'NARRATIVE_PROVIDER_FAILED',
    generationFailureStatus: 502,
    prompt: 'Make a film',
    duration: 30,
    inferenceModel: 'gpt-5.6-sol',
    videoGenerationModel: 'RUNWAYML',
    videoTone: 'grounded',
    inferenceReceipts,
    billingStatus: 'CHARGING',
    billingSnapshot,
  };
  const writes = [];

  t.mock.method(NarrativeRequest, 'findOneAndUpdate', (filter, update) => {
    writes.push({ kind: 'findOneAndUpdate', filter, update });
    storedRequest = { ...storedRequest, ...(update.$set || {}) };
    return asLeanQuery(storedRequest);
  });
  t.mock.method(NarrativeRequest, 'updateOne', async (filter, update) => {
    assert.equal(update.$push, undefined, 'recovery must not append a new inference receipt');
    writes.push({ kind: 'updateOne', filter, update });
    storedRequest = { ...storedRequest, ...(update.$set || {}) };
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
  });
  const inferenceAdmissionMock = t.mock.method(User, 'exists', async () => {
    throw new Error('recovery must not enter the generation branch');
  });
  t.mock.method(GenerationCreditTransaction, 'findOne', () => ({
    sort: async () => ({
      _id: '507f1f77bcf86cd799439015',
      amount: billingSnapshot.credits,
      balanceAfter: 91,
    }),
  }));
  t.mock.method(User, 'updateOne', async () => ({ matchedCount: 1, modifiedCount: 1 }));

  const result = await processCreateSingleNarrativeRequest(requestId);

  assert.equal(inferenceAdmissionMock.mock.callCount(), 0);
  assert.equal(result.status, 'FAILED');
  assert.deepEqual(result.error, {
    message: 'Narrative provider failed',
    code: 'NARRATIVE_PROVIDER_FAILED',
    status: 502,
  });
  assert.equal(result.creditsCharged, billingSnapshot.credits);
  assert.equal(result.billing.underlying_cost_usd, billingSnapshot.underlyingCostUsd);
  assert.equal(result.billing.underlying_credits, billingSnapshot.underlyingCredits);

  const persistedBilling = writes.find(({ update }) => update.$set?.inferenceUsage);
  assert.ok(persistedBilling, 'recovery must persist pricing derived from the checkpointed receipt');
  assert.deepEqual(persistedBilling.update.$set.inferenceReceipts, billingSnapshot.receipts);
  assert.equal(persistedBilling.update.$set.inferenceReceipts.length, 1);
  assert.deepEqual(inferenceReceipts, originalReceipts, 'recovery must not mutate receipt usage');
  assert.equal(
    writes.slice(1).some(({ update }) => Object.hasOwn(update.$set || {}, 'generationOutcome')),
    false,
    'an existing failed checkpoint must not be rewritten',
  );
});

test('worker lease and error helpers enforce safe defaults', () => {
  assert.equal(typeof __testOnly__.getNarrativeWorkerLeaseMs, 'function');
  assert.equal(typeof __testOnly__.getRequestErrorStatus, 'function');

  const previousLease = process.env.NARRATIVE_REQUEST_WORKER_LEASE_MS;
  try {
    delete process.env.NARRATIVE_REQUEST_WORKER_LEASE_MS;
    assert.equal(__testOnly__.getNarrativeWorkerLeaseMs(), 5 * 60 * 1000);
    process.env.NARRATIVE_REQUEST_WORKER_LEASE_MS = '120000';
    assert.equal(__testOnly__.getNarrativeWorkerLeaseMs(), 120000);
    process.env.NARRATIVE_REQUEST_WORKER_LEASE_MS = '59999';
    assert.equal(__testOnly__.getNarrativeWorkerLeaseMs(), 5 * 60 * 1000);
  } finally {
    if (previousLease === undefined) {
      delete process.env.NARRATIVE_REQUEST_WORKER_LEASE_MS;
    } else {
      process.env.NARRATIVE_REQUEST_WORKER_LEASE_MS = previousLease;
    }
  }

  assert.equal(__testOnly__.getRequestErrorStatus({ code: 'INSUFFICIENT_CREDITS' }), 402);
  assert.equal(__testOnly__.getRequestErrorStatus({ statusCode: 422 }), 422);
  assert.equal(__testOnly__.getRequestErrorStatus(new Error('unknown')), 500);
  assert.equal(
    __testOnly__.isNarrativeLeaseLostError({ code: __testOnly__.NARRATIVE_LEASE_LOST_CODE }),
    true,
  );
  assert.equal(__testOnly__.isNarrativeLeaseLostError({ code: 'SOME_OTHER_ERROR' }), false);
});
