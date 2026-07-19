import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';

import NarrativeRequest from '../../schema/NarrativeRequest.js';
import User from '../../schema/User.js';
import { generateBranchingNarrativeTree } from '../movie_session/branching/BranchingNarrativeTree.js';
import {
  createVideoFromNarrativeRequest,
  normalizeNarrativeToVideoPayload,
  resolveNarrativeToVideoModels,
  validateNarrativeToVideoSourceRequest,
} from './NarrativeToVideoAPI.js';
import { resolveTextToVideoPreflightBillingDuration } from './MovieAPI.js';

const SOURCE_ID = '507f1f77bcf86cd799439011';
const USER_ID = '507f191e810c19729de860ea';
const VIDEO_SESSION_ID = '507f1f77bcf86cd799439012';

function setConnectionReadyForTest(t) {
  const originalReadyState = mongoose.connection.readyState;
  mongoose.connection.readyState = 1;
  t.after(() => {
    mongoose.connection.readyState = originalReadyState;
  });
}

function buildSource(overrides = {}) {
  return {
    _id: SOURCE_ID,
    userId: USER_ID,
    requestType: 'create_single',
    narrativeType: 'singular',
    status: 'COMPLETED',
    generationOutcome: 'SUCCEEDED',
    billingStatus: 'CHARGED',
    prompt: 'Create a quiet river journey.',
    duration: 20,
    inferenceModel: 'gpt-5.6-sol',
    videoGenerationModel: 'RUNWAYML',
    videoTone: 'grounded',
    speakerOptions: { openAISpeakers: ['nova'] },
    themeJson: {
      visualStyle: 'cinematic realism',
      actors: [{ name: 'Kanya', role: 'Narrator' }],
    },
    narrativeJson: {
      scenes: [{ visual: 'River at dawn.' }, { visual: 'Boat reaches the city.' }],
      sounds: [],
    },
    movieResourceList: {
      scenes: [
        {
          visual: 'A detailed cinematic riverbank at dawn.',
          type: 'base',
          duration: 10,
          startTime: 0,
          endTime: 10,
          speaker: '',
        },
        {
          visual: 'A detailed cinematic boat approaching the waking city.',
          type: 'base',
          duration: 10,
          startTime: 10,
          endTime: 20,
          speaker: '',
        },
      ],
      sounds: [],
    },
    ...overrides,
  };
}

async function buildBranchedSource(overrides = {}) {
  const source = buildSource();
  const generated = await generateBranchingNarrativeTree({
    sourceMovieResourceList: source.movieResourceList,
    themeJson: source.themeJson,
    narrativeJson: source.narrativeJson,
    prompt: source.prompt,
    numLevels: 1,
    inferenceModel: source.inferenceModel,
    requestedDuration: source.duration,
    generateDivergencePaths: async () => [
      { path_name: 'City route', path_description: 'Continue toward the waking city.' },
      { path_name: 'Forest route', path_description: 'Turn toward the quiet forest.' },
    ],
    generateBranchMovieResourceList: async ({
      parentMovieResourceList,
      divergenceSceneIndex,
      divergence,
    }) => {
      const child = structuredClone(parentMovieResourceList);
      for (let index = divergenceSceneIndex + 1; index < child.scenes.length; index += 1) {
        child.scenes[index].visual = `${divergence.path_name}: ${child.scenes[index].visual}`;
      }
      return child;
    },
  });
  return {
    ...source,
    requestType: 'create_branching',
    narrativeType: 'branched',
    numLevels: 1,
    movieResourceList: generated.movieResourceList,
    branchingMeta: generated.branchingMeta,
    ...overrides,
  };
}

test('normalizes the canonical and camel narrative request id with optional model aliases', () => {
  assert.deepEqual(normalizeNarrativeToVideoPayload({
    narrative_request_id: SOURCE_ID,
  }), {
    sourceRequestId: SOURCE_ID,
    imageModel: null,
    videoModel: null,
  });

  assert.deepEqual(normalizeNarrativeToVideoPayload({
    input: {
      sessionId: SOURCE_ID,
      imageModel: 'GPTIMAGE2',
      video_model: 'RUNWAYML',
    },
  }), {
    sourceRequestId: SOURCE_ID,
    imageModel: 'GPTIMAGE2',
    videoModel: 'RUNWAYML',
  });
});

test('rejects source prompt or duration overrides and malformed model aliases', () => {
  assert.throws(
    () => normalizeNarrativeToVideoPayload({ input: [] }),
    (error) => error.code === 'INVALID_REQUEST_PAYLOAD' && error.status === 400,
  );

  for (const forbidden of [
    { prompt: 'Replace the narrative' },
    { duration: 30 },
    { input: { narrative_request_id: SOURCE_ID }, prompt: 'Top-level override' },
  ]) {
    assert.throws(
      () => normalizeNarrativeToVideoPayload({
        narrative_request_id: SOURCE_ID,
        ...forbidden,
      }),
      (error) => error.code === 'SOURCE_NARRATIVE_FIELD_OVERRIDE_NOT_ALLOWED' && error.status === 400,
    );
  }

  assert.throws(
    () => normalizeNarrativeToVideoPayload({
      narrative_request_id: SOURCE_ID,
      image_model: '',
    }),
    (error) => error.code === 'INVALID_IMAGE_MODEL' && error.status === 400,
  );
  assert.throws(
    () => normalizeNarrativeToVideoPayload({
      narrative_request_id: SOURCE_ID,
      video_model: 'RUNWAYML',
      videoModel: 'VEO3.1I2V',
    }),
    (error) => error.code === 'CONFLICTING_VIDEO_MODEL' && error.status === 400,
  );
  assert.throws(
    () => normalizeNarrativeToVideoPayload({
      narrative_request_id: SOURCE_ID,
      narrativeRequestId: VIDEO_SESSION_ID,
    }),
    (error) => error.code === 'CONFLICTING_NARRATIVE_REQUEST_ID' && error.status === 400,
  );
});

test('resolves explicit models, then account preferences, then stable express defaults', () => {
  assert.deepEqual(resolveNarrativeToVideoModels({
    requestedImageModel: 'NANOBANANA2',
    requestedVideoModel: 'VEO3.1I2V',
    user: { agentImageModel: 'GPTIMAGE2', agentVideoModel: 'RUNWAYML' },
  }), {
    imageModel: 'NANOBANANA2',
    videoModel: 'VEO3.1I2V',
  });

  assert.deepEqual(resolveNarrativeToVideoModels({
    user: { agentImageModel: 'SEEDREAM', agentVideoModel: 'KLINGIMGTOVIDTURBO' },
  }), {
    imageModel: 'SEEDREAM',
    videoModel: 'KLINGIMGTOVIDTURBO',
  });

  assert.deepEqual(resolveNarrativeToVideoModels({
    user: { agentImageModel: 'REMOVED_IMAGE_MODEL', agentVideoModel: 'REMOVED_VIDEO_MODEL' },
  }), {
    imageModel: 'GPTIMAGE2',
    videoModel: 'RUNWAYML',
  });

  assert.throws(
    () => resolveNarrativeToVideoModels({ requestedImageModel: 'DALLE3' }),
    (error) => error.code === 'INVALID_IMAGE_MODEL' && error.status === 400,
  );
  assert.throws(
    () => resolveNarrativeToVideoModels({ requestedVideoModel: 'NOT_A_VIDEO_MODEL' }),
    (error) => error.code === 'INVALID_VIDEO_MODEL' && error.status === 400,
  );
});

test('accepts settled singular and branched sources and rejects invalid source state', async () => {
  const legacySource = buildSource({ narrativeType: undefined, billingStatus: 'WAIVED' });
  assert.equal(validateNarrativeToVideoSourceRequest(legacySource), legacySource);
  const branchedSource = await buildBranchedSource();
  assert.equal(validateNarrativeToVideoSourceRequest(branchedSource), branchedSource);

  const invalidCases = [
    [buildSource({ requestType: 'create_single', narrativeType: 'branched' }), 'SOURCE_NARRATIVE_TYPE_INVALID', 422],
    [buildSource({ status: 'PROCESSING' }), 'SOURCE_NARRATIVE_NOT_COMPLETED', 409],
    [buildSource({ generationOutcome: 'FAILED' }), 'SOURCE_NARRATIVE_GENERATION_INVALID', 422],
    [buildSource({ billingStatus: 'PENDING' }), 'SOURCE_NARRATIVE_BILLING_NOT_SETTLED', 409],
    [buildSource({ themeJson: null }), 'SOURCE_NARRATIVE_ARTIFACTS_INVALID', 422],
    [buildSource({
      movieResourceList: {
        scenes: [{
          visual: '   ',
          type: 'base',
          duration: 10,
          startTime: 0,
          endTime: 10,
        }],
        sounds: [],
      },
    }), 'SOURCE_MOVIE_RESOURCE_LIST_INVALID', 422],
  ];

  for (const [source, code, status] of invalidCases) {
    assert.throws(
      () => validateNarrativeToVideoSourceRequest(source),
      (error) => error.code === code && error.status === status,
      code,
    );
  }

  assert.throws(
    () => validateNarrativeToVideoSourceRequest({
      ...branchedSource,
      branchingMeta: { ...branchedSource.branchingMeta, leafNodeIds: ['root.1'] },
    }),
    (error) => error.code === 'SOURCE_BRANCHING_META_INVALID' && error.status === 422,
  );
});

test('preflight derives branched billing duration from the canonical layer catalog', async () => {
  const singularSource = buildSource();
  const branchedSource = await buildBranchedSource();

  assert.equal(resolveTextToVideoPreflightBillingDuration({
    requestedDuration: singularSource.duration,
    estimatedOutroDuration: 8,
    preparedNarrativeArtifacts: singularSource,
    videoGenerationModel: 'RUNWAYML',
    framesPerSecond: 24,
  }), 28);

  assert.equal(resolveTextToVideoPreflightBillingDuration({
    requestedDuration: branchedSource.duration,
    estimatedOutroDuration: 8,
    preparedNarrativeArtifacts: branchedSource,
    videoGenerationModel: 'RUNWAYML',
    framesPerSecond: 24,
  }), 38);
});

test('branched submission preserves the tree and forwards branching metadata', async (t) => {
  setConnectionReadyForTest(t);
  const source = await buildBranchedSource();
  const sourceSnapshot = structuredClone(source);
  let preparedPayload;

  t.mock.method(NarrativeRequest, 'findOne', () => ({ lean: async () => source }));
  t.mock.method(User, 'findById', () => ({
    select: () => ({
      lean: async () => ({
        _id: USER_ID,
        agentImageModel: 'GPTIMAGE2',
        agentVideoModel: 'RUNWAYML',
      }),
    }),
  }));

  await createVideoFromNarrativeRequest({
    userId: USER_ID,
    payload: { narrative_request_id: SOURCE_ID },
    dependencies: {
      requestCreateVideoFromNarrativeArtifacts: async (_userId, payload) => {
        preparedPayload = payload;
        payload.movieResourceList.nodes[0].scenes[0].visual = 'downstream mutation';
        payload.branchingMeta.leafNodeIds.length = 0;
        return { request_id: VIDEO_SESSION_ID, session_id: VIDEO_SESSION_ID };
      },
    },
  });

  assert.equal(preparedPayload.narrativeType, 'branched');
  assert.equal(preparedPayload.sourceNarrativeType, 'branched');
  assert.equal(preparedPayload.movieResourceList.structureType, 'branched');
  assert.equal(preparedPayload.branchingMeta.numLevels, 1);
  assert.deepEqual(source, sourceSnapshot);
});

test('submission scopes the source to its owner and sends isolated prepared artifacts to MovieAPI', async (t) => {
  setConnectionReadyForTest(t);
  const source = buildSource();
  const sourceSnapshot = structuredClone(source);
  let sourceLookup = null;
  let selectedUserFields = null;
  let pipelineCall = null;

  t.mock.method(NarrativeRequest, 'findOne', (filter) => {
    sourceLookup = filter;
    return { lean: async () => source };
  });
  t.mock.method(User, 'findById', (id) => {
    assert.equal(id, USER_ID);
    return {
      select: (fields) => {
        selectedUserFields = fields;
        return {
          lean: async () => ({
            _id: USER_ID,
            agentImageModel: 'SEEDREAM',
            agentVideoModel: 'KLINGIMGTOVIDTURBO',
          }),
        };
      },
    };
  });

  const result = await createVideoFromNarrativeRequest({
    userId: USER_ID,
    payload: {
      narrative_request_id: SOURCE_ID,
      image_model: 'GPTIMAGE2',
      videoModel: 'RUNWAYML',
    },
    webhookUrl: 'https://example.com/video-ready',
    dependencies: {
      requestCreateVideoFromNarrativeArtifacts: async (userId, preparedPayload, webhookUrl) => {
        pipelineCall = { userId, preparedPayload, webhookUrl };
        preparedPayload.themeJson.visualStyle = 'mutated downstream';
        preparedPayload.narrativeJson.scenes[0].visual = 'mutated downstream';
        preparedPayload.movieResourceList.scenes[0].visual = 'mutated downstream';
        return {
          request_id: VIDEO_SESSION_ID,
          session_id: VIDEO_SESSION_ID,
          status: 'PENDING',
        };
      },
    },
  });

  assert.deepEqual(sourceLookup, { _id: SOURCE_ID, userId: USER_ID });
  assert.equal(selectedUserFields, 'agentImageModel agentVideoModel');
  assert.equal(pipelineCall.userId, USER_ID);
  assert.equal(pipelineCall.webhookUrl, 'https://example.com/video-ready');
  assert.deepEqual({
    sourceNarrativeRequestId: pipelineCall.preparedPayload.sourceNarrativeRequestId,
    prompt: pipelineCall.preparedPayload.prompt,
    duration: pipelineCall.preparedPayload.duration,
    inferenceModel: pipelineCall.preparedPayload.inferenceModel,
    videoTone: pipelineCall.preparedPayload.videoTone,
    imageModel: pipelineCall.preparedPayload.image_model,
    videoModel: pipelineCall.preparedPayload.video_model,
    aspectRatio: pipelineCall.preparedPayload.aspect_ratio,
    requestType: pipelineCall.preparedPayload.requestType,
    creditSource: pipelineCall.preparedPayload.creditSource,
  }, {
    sourceNarrativeRequestId: SOURCE_ID,
    prompt: source.prompt,
    duration: source.duration,
    inferenceModel: source.inferenceModel,
    videoTone: source.videoTone,
    imageModel: 'GPTIMAGE2',
    videoModel: 'RUNWAYML',
    aspectRatio: '1:1',
    requestType: 'API',
    creditSource: 'narrative_to_video',
  });
  assert.deepEqual(source, sourceSnapshot, 'the stored NarrativeRequest artifacts must remain immutable');
  assert.deepEqual(result, {
    request_id: VIDEO_SESSION_ID,
    session_id: VIDEO_SESSION_ID,
    status: 'PENDING',
    source_narrative_request_id: SOURCE_ID,
  });
});

test('submission returns not found for an unowned source without starting the video pipeline', async (t) => {
  setConnectionReadyForTest(t);
  let pipelineStarted = false;

  t.mock.method(NarrativeRequest, 'findOne', () => ({ lean: async () => null }));
  t.mock.method(User, 'findById', () => ({
    select: () => ({
      lean: async () => ({
        _id: USER_ID,
        agentImageModel: 'GPTIMAGE2',
        agentVideoModel: 'RUNWAYML',
      }),
    }),
  }));

  await assert.rejects(
    createVideoFromNarrativeRequest({
      userId: USER_ID,
      payload: { narrative_request_id: SOURCE_ID },
      dependencies: {
        requestCreateVideoFromNarrativeArtifacts: async () => {
          pipelineStarted = true;
        },
      },
    }),
    (error) => error.code === 'NOT_FOUND' && error.status === 404,
  );
  assert.equal(pipelineStarted, false);
});
