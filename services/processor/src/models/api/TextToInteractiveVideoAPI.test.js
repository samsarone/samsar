import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';

import InteractiveVideoRequest from '../../schema/InteractiveVideoRequest.js';
import NarrativeRequest from '../../schema/NarrativeRequest.js';
import ExpressGenerationBuilderRequest from '../../schema/ExpressGenerationBuilderRequest.js';
import User from '../../schema/User.js';
import VideoSession from '../../schema/VideoSession.js';
import {
  __testOnly__,
  buildTextToInteractiveVideoResponse,
  createTextToInteractiveVideoRequest,
  normalizeTextToInteractiveVideoPayload,
  processTextToInteractiveVideoRequest,
} from './TextToInteractiveVideoAPI.js';

const INTERACTIVE_REQUEST_ID = '507f1f77bcf86cd799439030';
const USER_ID = '507f191e810c19729de860ea';
const SESSION_ID = '507f1f77bcf86cd799439031';
const SINGULAR_REQUEST_ID = '507f1f77bcf86cd799439032';
const BRANCHED_REQUEST_ID = '507f1f77bcf86cd799439033';

function setConnectionReadyForTest(t) {
  const originalReadyState = mongoose.connection.readyState;
  mongoose.connection.readyState = 1;
  t.after(() => {
    mongoose.connection.readyState = originalReadyState;
  });
}

function asLeanQuery(value) {
  return { lean: async () => value };
}

test('normalizes the complete unified payload and requires render model selections', () => {
  assert.deepEqual(normalizeTextToInteractiveVideoPayload({
    input: {
      prompt: '  Create an interactive river journey.  ',
      duration: 40,
      num_levels: '2',
      inference_model: 'QWEN3.7',
      image_model: 'SEEDREAM',
      video_model: 'COSMOS3SUPERI2V',
    },
  }), {
    prompt: 'Create an interactive river journey.',
    duration: 40,
    inferenceModel: 'QWEN3.7',
    imageModel: 'SEEDREAM',
    videoModel: 'COSMOS3SUPERI2V',
    numLevels: 2,
  });

  assert.throws(
    () => normalizeTextToInteractiveVideoPayload({
      prompt: 'Create an interactive river journey.',
      duration: 40,
      num_levels: 2,
      image_model: 'SEEDREAM',
    }),
    (error) => error.code === 'INVALID_VIDEO_MODEL' && error.status === 400,
  );
  assert.throws(
    () => normalizeTextToInteractiveVideoPayload({
      prompt: 'Create an interactive river journey.',
      duration: 40,
      num_levels: 2,
      video_model: 'RUNWAYML',
    }),
    (error) => error.code === 'INVALID_IMAGE_MODEL' && error.status === 400,
  );
  assert.throws(
    () => normalizeTextToInteractiveVideoPayload({
      prompt: 'Create an interactive river journey.',
      duration: 40,
      num_levels: 1,
      numLevels: 2,
      image_model: 'SEEDREAM',
      video_model: 'RUNWAYML',
    }),
    (error) => error.code === 'CONFLICTING_NUM_LEVELS' && error.status === 400,
  );
});

test('response exposes the preallocated final video session for detailed-status polling', () => {
  assert.deepEqual(buildTextToInteractiveVideoResponse({
    _id: INTERACTIVE_REQUEST_ID,
    sessionId: SESSION_ID,
    status: 'PROCESSING',
    stage: 'BRANCHED_NARRATIVE',
    singularNarrativeRequestId: SINGULAR_REQUEST_ID,
  }), {
    request_id: SESSION_ID,
    session_id: SESSION_ID,
    status: 'PENDING',
    narrative_type: 'branched',
    interactive_video_request_id: INTERACTIVE_REQUEST_ID,
    workflow_status: 'PROCESSING',
    workflow_stage: 'BRANCHED_NARRATIVE',
    singular_narrative_request_id: SINGULAR_REQUEST_ID,
    status_url: `/v2/status_detailed?request_id=${SESSION_ID}`,
  });
});

test('an idempotency-race loser removes only its own blank session', async (t) => {
  setConnectionReadyForTest(t);
  const input = {
    prompt: 'Create an interactive river journey.',
    duration: 40,
    num_levels: 2,
    inference_model: 'QWEN3.7',
    image_model: 'SEEDREAM',
    video_model: 'COSMOS3SUPERI2V',
  };
  const normalizedPayload = normalizeTextToInteractiveVideoPayload(input);
  const payloadHash = __testOnly__.buildPayloadHash(normalizedPayload, null);
  let deleteFilter = null;
  let idempotencyLookups = 0;

  t.mock.method(InteractiveVideoRequest, 'createIndexes', async () => []);
  t.mock.method(NarrativeRequest, 'createIndexes', async () => []);
  t.mock.method(User, 'findById', () => ({
    select: () => ({ lean: async () => ({ generationCredits: 100 }) }),
  }));
  t.mock.method(InteractiveVideoRequest, 'create', async () => {
    throw Object.assign(new Error('duplicate idempotency key'), { code: 11000 });
  });
  t.mock.method(InteractiveVideoRequest, 'findOne', () => {
    idempotencyLookups += 1;
    return asLeanQuery(idempotencyLookups === 1 ? null : {
      _id: INTERACTIVE_REQUEST_ID,
      userId: USER_ID,
      sessionId: SESSION_ID,
      idempotencyKey: 'client-request-1',
      payloadHash,
      status: 'PENDING',
      stage: 'SINGULAR_NARRATIVE',
    });
  });
  t.mock.method(VideoSession, 'deleteOne', async (filter) => {
    deleteFilter = filter;
    return { deletedCount: 1 };
  });

  const result = await createTextToInteractiveVideoRequest({
    userId: USER_ID,
    payload: input,
    idempotencyKey: 'client-request-1',
    dependencies: {
      createNewBlankQuickSession: async () => '507f1f77bcf86cd799439039',
    },
  });

  assert.equal(result.session_id, SESSION_ID);
  assert.deepEqual(deleteFilter, {
    _id: '507f1f77bcf86cd799439039',
    userId: USER_ID,
    sourceNarrativeRequestId: null,
  });
});

test('session metadata alone is not treated as proof that the durable render builder exists', async (t) => {
  t.mock.method(VideoSession, 'findById', () => ({
    select() { return this; },
    lean: async () => ({
      sourceNarrativeRequestId: BRANCHED_REQUEST_ID,
      expressGenerationNarrativeReused: true,
      builderSessionSubType: 'narrative_video_create',
    }),
  }));
  t.mock.method(ExpressGenerationBuilderRequest, 'findOne', () => ({
    select() { return this; },
    lean: async () => null,
  }));

  assert.equal(await __testOnly__.isVideoSessionAlreadyScheduled({
    sessionId: SESSION_ID,
    userId: USER_ID,
    branchedNarrativeRequestId: BRANCHED_REQUEST_ID,
  }), false);
});

test('a stale worker cannot mark the shared final session failed after losing its lease', async (t) => {
  t.mock.method(InteractiveVideoRequest, 'updateOne', async () => ({ matchedCount: 0 }));
  const sessionUpdate = t.mock.method(VideoSession, 'findByIdAndUpdate', async () => {
    throw new Error('a stale worker must not write the shared video session');
  });

  assert.equal(await __testOnly__.markFailed({
    _id: INTERACTIVE_REQUEST_ID,
    userId: USER_ID,
    sessionId: SESSION_ID,
    payload: { videoModel: 'COSMOS3SUPERI2V' },
  }, 'stale-lease-id', new Error('stale worker failure')), false);
  assert.equal(sessionUpdate.mock.callCount(), 0);
});

test('durable worker sequences both waived narrative stages before scheduling one billed render', async (t) => {
  setConnectionReadyForTest(t);
  let storedJob = {
    _id: INTERACTIVE_REQUEST_ID,
    userId: USER_ID,
    sessionId: SESSION_ID,
    status: 'PENDING',
    stage: 'SINGULAR_NARRATIVE',
    payload: {
      prompt: 'Create an interactive river journey.',
      duration: 40,
      numLevels: 2,
      inferenceModel: 'QWEN3.7',
      imageModel: 'SEEDREAM',
      videoModel: 'COSMOS3SUPERI2V',
    },
    apiKeyUsage: {
      apiKeyId: 'api-key-id',
      apiKeyUsageLimit: 5_000,
      apiKeyUsageLimitPeriod: 'monthly',
    },
    webhookUrl: 'https://example.com/interactive-ready',
  };
  const sequence = [];
  const stageWrites = [];
  let claimCount = 0;
  let finalVideoArguments = null;

  t.mock.method(InteractiveVideoRequest, 'findOneAndUpdate', (_filter, update) => {
    claimCount += 1;
    storedJob = { ...storedJob, ...(update.$set || {}) };
    return asLeanQuery({ ...storedJob });
  });
  t.mock.method(InteractiveVideoRequest, 'updateOne', async (_filter, update) => {
    storedJob = { ...storedJob, ...(update.$set || {}) };
    stageWrites.push(update.$set || {});
    return { matchedCount: 1, modifiedCount: 1 };
  });
  t.mock.method(NarrativeRequest, 'findOne', () => ({
    sort() { return this; },
    lean: async () => null,
  }));
  t.mock.method(VideoSession, 'findById', () => ({
    select() { return this; },
    lean: async () => null,
  }));
  t.mock.method(ExpressGenerationBuilderRequest, 'findOne', () => ({
    select() { return this; },
    lean: async () => null,
  }));
  const sessionUpdate = t.mock.method(VideoSession, 'findByIdAndUpdate', async () => ({}));

  const result = await processTextToInteractiveVideoRequest(
    INTERACTIVE_REQUEST_ID,
    {
      createSingleNarrativeRequest: async (options) => {
        sequence.push('create-single');
        assert.equal(options.billingPolicy, 'included_in_interactive_video_rate');
        assert.equal(options.payload.video_model, 'COSMOS3SUPERI2V');
        assert.equal(options.interactiveVideoRequestId, INTERACTIVE_REQUEST_ID);
        return { request_id: SINGULAR_REQUEST_ID, status: 'PENDING' };
      },
      processCreateSingleNarrativeRequest: async (requestId) => {
        sequence.push('process-single');
        assert.equal(requestId, SINGULAR_REQUEST_ID);
        return { request_id: requestId, status: 'COMPLETED' };
      },
      createBranchingNarrativeRequest: async (options) => {
        sequence.push('create-branching');
        assert.equal(options.billingPolicy, 'included_in_interactive_video_rate');
        assert.equal(options.payload.narrative_request_id, SINGULAR_REQUEST_ID);
        assert.equal(options.payload.video_model, 'COSMOS3SUPERI2V');
        assert.equal(options.payload.num_levels, 2);
        return { request_id: BRANCHED_REQUEST_ID, status: 'PENDING' };
      },
      processCreateBranchingNarrativeRequest: async (requestId) => {
        sequence.push('process-branching');
        assert.equal(requestId, BRANCHED_REQUEST_ID);
        return { request_id: requestId, status: 'COMPLETED' };
      },
      createVideoFromNarrativeRequest: async (options) => {
        sequence.push('create-video');
        finalVideoArguments = options;
        return { request_id: SESSION_ID, session_id: SESSION_ID, status: 'PENDING' };
      },
    },
  );

  assert.deepEqual(sequence, [
    'create-single',
    'process-single',
    'create-branching',
    'process-branching',
    'create-video',
  ]);
  assert.equal(finalVideoArguments.destinationSessionId, SESSION_ID);
  assert.deepEqual(finalVideoArguments.payload, {
    narrative_request_id: BRANCHED_REQUEST_ID,
    image_model: 'SEEDREAM',
    video_model: 'COSMOS3SUPERI2V',
  });
  assert.deepEqual(finalVideoArguments.authContext, storedJob.apiKeyUsage);
  assert.equal(finalVideoArguments.webhookUrl, 'https://example.com/interactive-ready');
  assert.equal(result.session_id, SESSION_ID);
  assert.equal(result.workflow_status, 'COMPLETED');
  assert.equal(result.status, 'PENDING');
  assert.equal(claimCount, 2);
  assert.ok(stageWrites.some((write) => (
    write.singularNarrativeRequestId === SINGULAR_REQUEST_ID
  )));
  assert.ok(stageWrites.some((write) => (
    write.branchedNarrativeRequestId === BRANCHED_REQUEST_ID
  )));
  assert.equal(sessionUpdate.mock.callCount(), 1);
});
