import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPublicationForSessionVideo,
  serializePublicationForResponse,
  unpublishSessionVideo,
} from './Publication.js';

const userId = '507f191e810c19729de860ea';
const sessionId = '507f1f77bcf86cd799439011';

const normalizeMarker = (value) => value?.toString?.() ?? value ?? null;
const matchesPublishedSessionMarkers = (session, filter) => (
  (!Object.hasOwn(filter, 'ispublishedVideo') ||
    (session.ispublishedVideo === true) === filter.ispublishedVideo) &&
  (!Object.hasOwn(filter, 'publishedPublicationId') ||
    normalizeMarker(session.publishedPublicationId) === normalizeMarker(filter.publishedPublicationId)) &&
  (!Object.hasOwn(filter, 'publishedVideoURL') ||
    normalizeMarker(session.publishedVideoURL) === normalizeMarker(filter.publishedVideoURL))
);

const updatePublishedSessionWithCas = (session, filter, update) => {
  if (!matchesPublishedSessionMarkers(session, filter)) return null;
  Object.assign(session, update.$set);
  return session;
};

const interactiveResult = {
  id: '507f1f77bcf86cd799439012',
  type: 'InteractiveVideo',
  schema: 'interactive_publication.v1',
  title: 'Choose',
  description: '',
  tags: [],
  datePublished: new Date('2026-07-19T00:00:00.000Z'),
  thumbnailUrl: 'https://static.samsar.one/published/default-thumbnail.png',
  aspectRatio: '16:9',
  inLanguage: 'EN',
  hasSubtitles: false,
  manifest: {
    schema: 'interactive_video_manifest.v1',
    default_path_id: 'root.1',
    timing: { origin: 'media', unit: 'seconds' },
    tree: { root_node_id: 'root', choice_points: [] },
    outputs: {
      paths: [{
        path_id: 'root.1',
        contentUrl: 'https://static.samsar.one/published/default-video.mp4',
        thumbnailUrl: 'https://static.samsar.one/published/default-thumbnail.png',
        encodingFormat: 'video/mp4',
        duration: 10,
        is_default: true,
      }],
    },
  },
};

test('publication response serialization leaves the linear contract unchanged', () => {
  const linearPublication = {
    _id: '507f1f77bcf86cd799439013',
    videoURL: 'https://static.samsar.one/published/linear.mp4',
    title: 'Linear',
  };
  const document = { toObject: () => linearPublication };

  assert.equal(serializePublicationForResponse(document), linearPublication);
});

test('central publish dispatches branched sessions before the linear Publication path', async () => {
  const session = {
    _id: sessionId,
    userId,
    narrativeType: 'branched',
  };
  let createCalls = 0;
  let markedPublicationId = null;
  let persistedUpdate = null;
  const result = await createPublicationForSessionVideo(
    userId,
    { id: sessionId },
    {
      connectToDatabase: async () => {},
      videoSessionModel: {
        findById: async () => session,
        findOneAndUpdate: async (filter, update) => {
          assert.equal(filter._id, sessionId);
          persistedUpdate = update.$set;
          return updatePublishedSessionWithCas(session, filter, update);
        },
      },
      createInteractivePublication: async (_userId, _payload, options) => {
        createCalls += 1;
        assert.equal(options.sessionData, session);
        return interactiveResult;
      },
      buildInteractiveSessionUpdate: () => ({
        ispublishedVideo: true,
        publishedPublicationId: interactiveResult.id,
      }),
      markInteractivePublication: async (publicationId) => {
        markedPublicationId = publicationId;
        assert.equal(persistedUpdate.ispublishedVideo, true);
        return interactiveResult;
      },
    },
  );

  assert.equal(result.type, 'InteractiveVideo');
  assert.equal(result.mainVideoUrl,
    interactiveResult.manifest.outputs.paths[0].contentUrl);
  assert.equal(result.mainThumbnailUrl,
    interactiveResult.manifest.outputs.paths[0].thumbnailUrl);
  assert.equal(result.duration, 10);
  assert.deepEqual(result.manifest, interactiveResult.manifest);
  assert.equal(createCalls, 1);
  assert.equal(markedPublicationId, interactiveResult.id);
  assert.equal(persistedUpdate.publishedPublicationId, interactiveResult.id);
});

test('central publish accepts session_id and dispatches source-branched sessions interactively', async () => {
  const session = {
    _id: sessionId,
    userId,
    narrativeType: 'singular',
    sourceNarrativeType: 'branched',
  };
  let requestedSessionId = null;
  let createCalls = 0;

  const result = await createPublicationForSessionVideo(
    userId,
    { session_id: sessionId },
    {
      connectToDatabase: async () => {},
      videoSessionModel: {
        findById: async (value) => {
          requestedSessionId = value;
          return session;
        },
        findOneAndUpdate: async (filter, update) => (
          updatePublishedSessionWithCas(session, filter, update)
        ),
      },
      createInteractivePublication: async () => {
        createCalls += 1;
        return interactiveResult;
      },
      buildInteractiveSessionUpdate: () => ({
        ispublishedVideo: true,
        publishedVideoURL: interactiveResult.manifest.outputs.paths[0].contentUrl,
        publishedPublicationId: interactiveResult.id,
      }),
      markInteractivePublication: async () => interactiveResult,
    },
  );

  assert.equal(requestedSessionId, sessionId);
  assert.equal(createCalls, 1);
  assert.equal(result.type, 'InteractiveVideo');
  assert.equal(result.mainVideoUrl,
    interactiveResult.manifest.outputs.paths[0].contentUrl);
  assert.equal(result.mainThumbnailUrl,
    interactiveResult.manifest.outputs.paths[0].thumbnailUrl);
});

test('central publish restores prior session markers and aborts a draft when finalization fails', async () => {
  const priorUrl = 'https://static.samsar.one/published/prior/video.mp4';
  const priorPublicationId = '507f1f77bcf86cd799439099';
  const session = {
    _id: sessionId,
    userId,
    narrativeType: 'branched',
    ispublishedVideo: true,
    publishedVideoURL: priorUrl,
    publishedPublicationId: priorPublicationId,
    publishedTitle: 'Prior title',
  };
  let updateCalls = 0;
  let abortCalls = 0;

  await assert.rejects(
    () => createPublicationForSessionVideo(
      userId,
      { id: sessionId },
      {
        connectToDatabase: async () => {},
        videoSessionModel: {
          findById: async () => session,
          findOneAndUpdate: async (filter, update) => {
            updateCalls += 1;
            return updatePublishedSessionWithCas(session, filter, update);
          },
        },
        createInteractivePublication: async () => interactiveResult,
        buildInteractiveSessionUpdate: () => ({
          ispublishedVideo: true,
          publishedVideoURL: interactiveResult.manifest.outputs.paths[0].contentUrl,
          publishedPublicationId: interactiveResult.id,
        }),
        markInteractivePublication: async () => {
          throw new Error('simulated finalization failure');
        },
        abortInteractivePublication: async () => {
          abortCalls += 1;
        },
      },
    ),
    /simulated finalization failure/,
  );

  assert.equal(updateCalls, 2);
  assert.equal(abortCalls, 1);
  assert.equal(session.publishedVideoURL, priorUrl);
  assert.equal(session.publishedPublicationId, priorPublicationId);
  assert.equal(session.publishedTitle, 'Prior title');
  assert.equal(session.ispublishedVideo, true);
});

test('a superseded publish cannot roll session markers back over a newer revision', async () => {
  const newerUrl = 'https://static.samsar.one/published/newer/video.mp4';
  const session = {
    _id: sessionId,
    userId,
    narrativeType: 'branched',
    ispublishedVideo: true,
    publishedVideoURL: 'https://static.samsar.one/published/original/video.mp4',
    publishedPublicationId: interactiveResult.id,
  };
  let abortCalls = 0;

  await assert.rejects(
    () => createPublicationForSessionVideo(
      userId,
      { id: sessionId },
      {
        connectToDatabase: async () => {},
        videoSessionModel: {
          findById: async () => session,
          findOneAndUpdate: async (filter, update) => {
            return updatePublishedSessionWithCas(session, filter, update);
          },
        },
        createInteractivePublication: async () => interactiveResult,
        buildInteractiveSessionUpdate: () => ({
          ispublishedVideo: true,
          publishedVideoURL: interactiveResult.manifest.outputs.paths[0].contentUrl,
          publishedPublicationId: interactiveResult.id,
        }),
        markInteractivePublication: async () => {
          session.publishedVideoURL = newerUrl;
          throw new Error('superseded revision');
        },
        abortInteractivePublication: async () => {
          abortCalls += 1;
        },
      },
    ),
    /superseded revision/,
  );

  assert.equal(session.publishedVideoURL, newerUrl);
  assert.equal(abortCalls, 1);
});

test('a publish observed before unpublish cannot resurrect cleared session markers', async () => {
  const priorUrl = 'https://static.samsar.one/published/prior/video.mp4';
  const priorPublicationId = '507f1f77bcf86cd799439099';
  const session = {
    _id: sessionId,
    userId,
    narrativeType: 'branched',
    ispublishedVideo: true,
    publishedVideoURL: priorUrl,
    publishedPublicationId: priorPublicationId,
  };
  let updateCalls = 0;
  let abortCalls = 0;
  let markCalls = 0;

  await assert.rejects(
    () => createPublicationForSessionVideo(
      userId,
      { id: sessionId },
      {
        connectToDatabase: async () => {},
        videoSessionModel: {
          findById: async () => session,
          findOneAndUpdate: async (filter, update) => {
            updateCalls += 1;
            if (updateCalls === 1) {
              Object.assign(session, {
                ispublishedVideo: false,
                publishedPublicationId: null,
                publishedVideoURL: null,
              });
            }
            return updatePublishedSessionWithCas(session, filter, update);
          },
        },
        createInteractivePublication: async () => interactiveResult,
        buildInteractiveSessionUpdate: () => ({
          ispublishedVideo: true,
          publishedVideoURL: interactiveResult.manifest.outputs.paths[0].contentUrl,
          publishedPublicationId: interactiveResult.id,
        }),
        markInteractivePublication: async () => {
          markCalls += 1;
          return interactiveResult;
        },
        abortInteractivePublication: async () => {
          abortCalls += 1;
        },
      },
    ),
    /session could not be marked as published/i,
  );

  assert.equal(updateCalls, 2);
  assert.equal(abortCalls, 1);
  assert.equal(markCalls, 0);
  assert.equal(session.ispublishedVideo, false);
  assert.equal(session.publishedPublicationId, null);
  assert.equal(session.publishedVideoURL, null);
});

test('a failed session write aborts its unused publication revision', async () => {
  const session = {
    _id: sessionId,
    userId,
    narrativeType: 'branched',
    ispublishedVideo: false,
  };
  let abortCalls = 0;
  let updateCalls = 0;

  await assert.rejects(
    () => createPublicationForSessionVideo(
      userId,
      { id: sessionId },
      {
        connectToDatabase: async () => {},
        videoSessionModel: {
          findById: async () => session,
          findOneAndUpdate: async () => {
            updateCalls += 1;
            if (updateCalls === 1) {
              throw new Error('simulated session write failure');
            }
            return null;
          },
        },
        createInteractivePublication: async () => interactiveResult,
        buildInteractiveSessionUpdate: () => ({
          ispublishedVideo: true,
          publishedVideoURL: interactiveResult.manifest.outputs.paths[0].contentUrl,
          publishedPublicationId: interactiveResult.id,
        }),
        abortInteractivePublication: async () => {
          abortCalls += 1;
        },
      },
    ),
    /simulated session write failure/,
  );

  assert.equal(abortCalls, 1);
});

test('central publish keeps singular sessions on the existing readiness path', async () => {
  let interactiveCalls = 0;
  await assert.rejects(
    () => createPublicationForSessionVideo(
      userId,
      { id: sessionId, title: 'Linear' },
      {
        connectToDatabase: async () => {},
        videoSessionModel: {
          findById: async () => ({
            _id: sessionId,
            userId,
            narrativeType: 'singular',
            remoteURL: null,
            videoLink: null,
            publishedVideoURL: null,
          }),
        },
        createInteractivePublication: async () => {
          interactiveCalls += 1;
          return interactiveResult;
        },
      },
    ),
    /not ready to publish/i,
  );

  assert.equal(interactiveCalls, 0);
});

test('central unpublish clears branch session markers before final media deletion', async () => {
  let stagedSessionId = null;
  let finalized = false;
  const session = {
    _id: sessionId,
    userId,
    narrativeType: 'branched',
    ispublishedVideo: true,
    publishedPublicationId: interactiveResult.id,
    publishedVideoURL: interactiveResult.manifest.outputs.paths[0].contentUrl,
  };
  const stage = { publicationId: interactiveResult.id, token: 'unpublish-token', existed: true };
  const response = await unpublishSessionVideo(
    userId,
    { sessionId },
    {
      connectToDatabase: async () => {},
      videoSessionModel: {
        findById: async () => session,
        findOneAndUpdate: async (_filter, update) => {
          Object.assign(session, update.$set);
          return session;
        },
      },
      stageInteractiveUnpublish: async (value) => {
        stagedSessionId = value;
        return stage;
      },
      finalizeInteractiveUnpublish: async (value) => {
        assert.equal(session.ispublishedVideo, false);
        assert.equal(value, stage);
        finalized = true;
      },
      restoreInteractiveUnpublish: async () => {},
    },
  );

  assert.equal(stagedSessionId, sessionId);
  assert.equal(finalized, true);
  assert.equal(session.ispublishedVideo, false);
  assert.equal(session.publishedPublicationId, null);
  assert.equal(session.publishedVideoURL, null);
  assert.deepEqual(response, { sessionId, ispublishedVideo: false });
});

test('central unpublish restores publication visibility when session clearing fails', async () => {
  const session = {
    _id: sessionId,
    userId,
    narrativeType: 'branched',
    ispublishedVideo: true,
    publishedPublicationId: interactiveResult.id,
    publishedVideoURL: interactiveResult.manifest.outputs.paths[0].contentUrl,
  };
  const stage = { publicationId: interactiveResult.id, token: 'unpublish-token', existed: true };
  let restoreCalls = 0;
  let finalizeCalls = 0;

  await assert.rejects(
    () => unpublishSessionVideo(
      userId,
      { sessionId },
      {
        connectToDatabase: async () => {},
        videoSessionModel: {
          findById: async () => session,
          findOneAndUpdate: async () => {
            throw new Error('simulated session clear failure');
          },
        },
        stageInteractiveUnpublish: async () => stage,
        restoreInteractiveUnpublish: async (value) => {
          assert.equal(value, stage);
          restoreCalls += 1;
        },
        finalizeInteractiveUnpublish: async () => {
          finalizeCalls += 1;
        },
      },
    ),
    /simulated session clear failure/,
  );

  assert.equal(restoreCalls, 1);
  assert.equal(finalizeCalls, 0);
  assert.equal(session.ispublishedVideo, true);
  assert.equal(session.publishedVideoURL,
    interactiveResult.manifest.outputs.paths[0].contentUrl);
});
