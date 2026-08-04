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
  createTextToInteractiveVideoDraftSession,
  createTextToInteractiveVideoRequest,
  normalizeTextToInteractiveVideoPayload,
  processTextToInteractiveVideoRequest,
  validateTextToInteractiveVideoSessionInput,
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
      inference_model: 'QWEN3.8',
      image_model: 'SEEDREAM',
      video_model: 'COSMOS3SUPERI2V',
    },
  }), {
    prompt: 'Create an interactive river journey.',
    duration: 40,
    inferenceModel: 'QWEN3.8',
    imageModel: 'SEEDREAM',
    videoModel: 'COSMOS3SUPERI2V',
    numLevels: 2,
    aspectRatio: '16:9',
  });

  assert.equal(normalizeTextToInteractiveVideoPayload({
    prompt: 'Create an interactive portrait journey.',
    duration: 40,
    num_levels: 2,
    inference_model: 'QWEN3.8',
    image_model: 'SEEDREAM',
    video_model: 'COSMOS3SUPERI2V',
    aspect_ratio: '9:16',
  }).aspectRatio, '9:16');

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
  assert.throws(
    () => normalizeTextToInteractiveVideoPayload({
      prompt: 'Create an interactive river journey.',
      duration: 40,
      num_levels: 2,
      image_model: 'SEEDREAM',
      video_model: 'RUNWAYML',
      aspectRatio: '1:1',
    }),
    (error) => error.code === 'INVALID_ASPECT_RATIO' && error.status === 400,
  );
  assert.throws(
    () => normalizeTextToInteractiveVideoPayload({
      prompt: 'Create an interactive river journey.',
      duration: 40,
      num_levels: 2,
      image_model: 'SEEDREAM',
      video_model: 'RUNWAYML',
      aspect_ratio: '16:9',
      aspectRatio: '9:16',
    }),
    (error) => error.code === 'CONFLICTING_ASPECT_RATIO' && error.status === 400,
  );
});

test('one-step initialization immediately applies default and overridden branch ratios', async () => {
  const sessionUpdates = [];
  const mappings = [];
  for (const aspectRatio of [undefined, '9:16']) {
    await __testOnly__.initializeVideoSession({
      sessionId: SESSION_ID,
      userId: USER_ID,
      requestId: INTERACTIVE_REQUEST_ID,
      payload: {
        prompt: 'Create an interactive journey.',
        duration: 40,
        inferenceModel: 'QWEN3.8',
        imageModel: 'SEEDREAM',
        videoModel: 'COSMOS3SUPERI2V',
        numLevels: 2,
        ...(aspectRatio ? { aspectRatio } : {}),
      },
    }, {
      videoSessionModel: {
        findByIdAndUpdate: async (_sessionId, update) => {
          sessionUpdates.push(update);
        },
      },
      upsertSessionMapping: async (value) => {
        mappings.push(value);
      },
    });
  }

  assert.deepEqual(
    sessionUpdates.map((update) => update.$set.aspectRatio),
    ['16:9', '9:16'],
  );
  assert.equal(sessionUpdates.every((update) => update.$set.narrativeType === 'branched'), true);
  assert.deepEqual(sessionUpdates[0].$set.interactiveVideoDraftConfig, {
    duration: 40,
    imageModel: 'SEEDREAM',
    videoModel: 'COSMOS3SUPERI2V',
    numLevels: 2,
    aspectRatio: '16:9',
  });
  assert.deepEqual(sessionUpdates[1].$set.interactiveVideoDraftConfig, {
    duration: 40,
    imageModel: 'SEEDREAM',
    videoModel: 'COSMOS3SUPERI2V',
    numLevels: 2,
    aspectRatio: '9:16',
  });
  assert.equal(mappings.every((mapping) => mapping.sessionId === SESSION_ID), true);
  assert.equal(mappings.every((mapping) => mapping.metadata.numLevels === 2), true);
});

test('creates a dedicated branched draft with interactive-video defaults', async (t) => {
  setConnectionReadyForTest(t);
  const updates = [];
  const mappings = [];
  const result = await createTextToInteractiveVideoDraftSession({
    userId: USER_ID,
    dependencies: {
      createNewBlankQuickSession: async () => SESSION_ID,
      videoSessionModel: {
        findByIdAndUpdate: async (_sessionId, update) => updates.push(update),
      },
      upsertGlobalSessionMapping: async (mapping) => mappings.push(mapping),
    },
  });

  assert.equal(result.session_id, SESSION_ID);
  assert.equal(result.status, 'DRAFT');
  assert.equal(result.narrative_type, 'branched');
  assert.equal(updates[0].$set.builderSessionSubType, 'interactive_video_draft');
  assert.equal(updates[0].$set.narrativeType, 'branched');
  assert.equal(updates[0].$set.expressGenerationPending, false);
  assert.equal(mappings[0].sessionSubType, 'interactive_video_draft');
  assert.equal(mappings[0].status, 'DRAFT');
});

test('resumes the newest pending interactive creator session instead of creating another draft', async (t) => {
  setConnectionReadyForTest(t);
  let createdBlankSession = false;
  let pendingFilter;
  const result = await createTextToInteractiveVideoDraftSession({
    userId: USER_ID,
    dependencies: {
      createNewBlankQuickSession: async () => {
        createdBlankSession = true;
        return SESSION_ID;
      },
      videoSessionModel: {
        findOne: (filter) => {
          pendingFilter = filter;
          return {
            sort: () => ({
              select: () => ({
                lean: async () => ({ _id: SESSION_ID }),
              }),
            }),
          };
        },
      },
    },
  });

  assert.equal(result.session_id, SESSION_ID);
  assert.equal(result.status, 'PENDING');
  assert.equal(result.resumed, true);
  assert.equal(createdBlankSession, false);
  assert.equal(pendingFilter.expressGenerationPending, true);
  assert.equal(pendingFilter.builderSessionSubType, 'interactive_video_create');
  assert.deepEqual(pendingFilter.interactiveVideoDraftConfig, { $exists: true });
});

test('forceNew bypasses a pending interactive creator session', async (t) => {
  setConnectionReadyForTest(t);
  let pendingLookupAttempted = false;
  const result = await createTextToInteractiveVideoDraftSession({
    userId: USER_ID,
    forceNew: true,
    dependencies: {
      createNewBlankQuickSession: async () => SESSION_ID,
      videoSessionModel: {
        findOne: () => {
          pendingLookupAttempted = true;
          return null;
        },
        findByIdAndUpdate: async () => undefined,
      },
      upsertGlobalSessionMapping: async () => undefined,
    },
  });

  assert.equal(result.session_id, SESSION_ID);
  assert.equal(result.status, 'DRAFT');
  assert.equal(result.resumed, false);
  assert.equal(pendingLookupAttempted, false);
});

test('validates user input against an owned draft and fills omitted values from session defaults', async () => {
  const result = await validateTextToInteractiveVideoSessionInput({
    userId: USER_ID,
    payload: {
      input: {
        prompt: 'Use the saved interactive defaults.',
        request_id: SESSION_ID,
      },
    },
    dependencies: {
      videoSessionModel: {
        findOne: () => ({
          lean: async () => ({
            _id: SESSION_ID,
            userId: USER_ID,
            narrativeType: 'branched',
            builderStatus: 'DRAFT',
            builderSessionSubType: 'interactive_video_draft',
            interactiveVideoDraftConfig: {
              duration: 30,
              imageModel: 'NANOBANANA2',
              videoModel: 'COSMOS3SUPERI2V',
              numLevels: 2,
              aspectRatio: '16:9',
            },
          }),
        }),
      },
    },
  });

  assert.deepEqual(result.normalizedPayload, {
    prompt: 'Use the saved interactive defaults.',
    duration: 30,
    inferenceModel: undefined,
    imageModel: 'NANOBANANA2',
    videoModel: 'COSMOS3SUPERI2V',
    numLevels: 2,
    aspectRatio: '16:9',
    sessionId: SESSION_ID,
  });
});

test('rejects conflicting session/request aliases before creating interactive work', () => {
  assert.throws(
    () => normalizeTextToInteractiveVideoPayload({
      prompt: 'A branching story.',
      duration: 30,
      image_model: 'SEEDREAM',
      video_model: 'RUNWAYML',
      num_levels: 1,
      session_id: SESSION_ID,
      request_id: '507f1f77bcf86cd799439099',
    }),
    (error) => error.code === 'CONFLICTING_SESSION_ID' && error.status === 400,
  );
});

test('response exposes the preallocated final video session for detailed-status polling', () => {
  assert.deepEqual(buildTextToInteractiveVideoResponse({
    _id: INTERACTIVE_REQUEST_ID,
    sessionId: SESSION_ID,
    status: 'PROCESSING',
    stage: 'BRANCHED_NARRATIVE',
    payload: { numLevels: 2 },
    singularNarrativeRequestId: SINGULAR_REQUEST_ID,
  }), {
    request_id: SESSION_ID,
    session_id: SESSION_ID,
    status: 'PENDING',
    narrative_type: 'branched',
    num_levels: 2,
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
    inference_model: 'QWEN3.8',
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
      inferenceModel: 'QWEN3.8',
      imageModel: 'SEEDREAM',
      videoModel: 'COSMOS3SUPERI2V',
      aspectRatio: '9:16',
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
        assert.equal(options.minimumSceneCount, 3);
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
    aspectRatio: '9:16',
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
