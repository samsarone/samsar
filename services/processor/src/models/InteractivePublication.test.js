import assert from 'node:assert/strict';
import test from 'node:test';

import {
  abortInteractivePublicationPublish,
  buildInteractivePublishedSessionUpdate,
  createInteractivePublicationForSessionVideo,
  deleteInteractivePublicationForSession,
  getInteractivePublicationPublishRevision,
  isInteractivePublicationPubliclyRenderable,
  markInteractivePublicationPublished,
  resolveInteractiveMediaConcurrency,
  serializeInteractivePublication,
} from './InteractivePublication.js';

const completedBranching = {
  schema: 'branched_video_status.v1',
  status: 'COMPLETED',
  default_path_id: 'root.1',
  tree: {
    root_node_id: 'root',
    choice_points: [{
      branch_point_id: 'choice-root',
      parent_node_id: 'root',
      switch_at_seconds: 6,
      options: [
        { child_node_id: 'root.1', leaf_path_ids: ['root.1'] },
        { child_node_id: 'root.2', leaf_path_ids: ['root.2'] },
      ],
    }],
  },
  outputs: {
    ready: true,
    default_path_id: 'root.1',
    default_url: 'https://private.example/root.1.mp4',
    paths: [
      {
        path_id: 'root.1',
        url: 'https://private.example/root.1.mp4',
        duration: 12,
        is_default: true,
      },
      {
        path_id: 'root.2',
        url: 'https://private.example/root.2.mp4',
        duration: 13,
        is_default: false,
      },
    ],
  },
};

const session = {
  _id: '507f1f77bcf86cd799439011',
  narrativeType: 'branched',
  branchRenderCompletionFinalized: true,
  sessionName: 'Fork in the road',
  sessionDescription: 'Pick a direction.',
  aspectRatio: '16:9',
  sessionLanguage: 'EN',
  hasSubtitles: true,
  branchRenderPaths: completedBranching.outputs.paths.map((path, ordinal) => ({
    pathId: path.path_id,
    ordinal,
    duration: path.duration,
    videoGenerationStatus: 'COMPLETED',
    remoteURL: path.url,
  })),
};

function createMemoryModel() {
  let stored = null;
  let upsertCount = 0;
  const matches = (filter = {}) => {
    if (!stored) return false;
    for (const [key, expected] of Object.entries(filter)) {
      if (key === 'isDeleted' && expected?.$ne === true) {
        if (stored.isDeleted === true) return false;
      } else if (key === 'isPublished' && expected?.$ne === true) {
        if (stored.isPublished === true) return false;
      } else if (stored[key]?.toString?.() !== expected?.toString?.()) {
        return false;
      }
    }
    return true;
  };
  const applyUpdate = (update, inserted = false) => {
    stored = {
      _id: stored?._id || '507f1f77bcf86cd799439012',
      ...(inserted ? update.$setOnInsert : {}),
      ...stored,
      ...update.$set,
    };
    Object.keys(update.$unset || {}).forEach((key) => delete stored[key]);
  };
  return {
    get stored() {
      return stored;
    },
    get upsertCount() {
      return upsertCount;
    },
    mutateStored(mutator) {
      stored = mutator({ ...stored }) || stored;
    },
    findOne(filter = {}) {
      return { lean: async () => (matches(filter) ? stored : null) };
    },
    async findOneAndUpdate(filter, update) {
      if (filter.sessionId) {
        upsertCount += 1;
      }
      const inserted = !stored;
      if (!inserted && !matches(filter)) {
        return null;
      }
      applyUpdate(update, inserted);
      return stored;
    },
    async updateOne(filter, update) {
      if (!matches(filter)) return { matchedCount: 0 };
      applyUpdate(update);
      return { matchedCount: 1 };
    },
    async deleteOne(filter = {}) {
      if (!matches(filter)) return { deletedCount: 0 };
      stored = null;
      return { deletedCount: 1 };
    },
  };
}

const preparePathMedia = async (_session, path, { revisionId, isDefault } = {}) => ({
  pathId: path.pathId,
  revisionId,
  videoUrl: `https://static.samsar.one/published/${session._id}/interactive/revisions/${revisionId}/paths/${path.pathId}/video.mp4`,
  thumbnailUrl: `https://static.samsar.one/published/${session._id}/interactive/revisions/${revisionId}/paths/${path.pathId}/thumbnail.png`,
  ...(isDefault
    ? {
      mainThumbnailUrl: `https://static.samsar.one/published/${session._id}/interactive/revisions/${revisionId}/main/thumbnail.png`,
    }
    : {}),
});

test('interactive media concurrency is a CPU-aware upper bound', () => {
  assert.equal(
    resolveInteractiveMediaConcurrency({
      env: {},
      cpuBudget: 8,
    }),
    2,
  );
  assert.equal(
    resolveInteractiveMediaConcurrency({
      env: { SAMSAR_PROCESSOR_MAX_INTERACTIVE_MEDIA_TASKS: '6' },
      cpuBudget: 3,
    }),
    3,
  );
  assert.equal(
    resolveInteractiveMediaConcurrency({
      env: { SAMSAR_PROCESSOR_MAX_INTERACTIVE_MEDIA_TASKS: '6' },
      cpuBudget: 1,
    }),
    1,
  );
});

test('branched publish upserts and returns only the optimized InteractivePublication JSON', async () => {
  const publicationModel = createMemoryModel();
  const result = await createInteractivePublicationForSessionVideo(
    '507f191e810c19729de860ea',
    {
      title: 'Published fork',
      tags: ['interactive'],
      categories: ['Education'],
      topics: ['decision making'],
    },
    {
      sessionData: session,
      publicationModel,
      preparePathMedia,
      buildBranchingStatus: () => completedBranching,
      cleanupPathMedia: async () => {},
    },
  );

  assert.equal(publicationModel.upsertCount, 1);
  assert.equal(result.type, 'InteractiveVideo');
  assert.equal(result.schema, 'interactive_publication.v1');
  assert.equal(result.title, 'Published fork');
  assert.deepEqual(result.categories, ['Education']);
  assert.deepEqual(result.topics, ['decision making']);
  assert.equal(result.manifest.schema, 'interactive_video_manifest.v1');
  assert.equal(result.manifest.outputs.paths.length, 2);
  assert.equal(result.manifest.outputs.paths[0].contentUrl.includes('/root.1/video.mp4'), true);
  assert.equal(result.manifest.outputs.paths[0].thumbnailUrl.includes('/root.1/thumbnail.png'), true);
  assert.equal(result.mainVideoUrl, result.manifest.outputs.paths[0].contentUrl);
  assert.match(result.mainThumbnailUrl, /\/main\/thumbnail\.png$/);
  assert.equal(result.thumbnailUrl, result.mainThumbnailUrl);
  assert.notEqual(result.mainThumbnailUrl, result.manifest.outputs.paths[0].thumbnailUrl);
  assert.equal(result.duration, result.manifest.outputs.paths[0].duration);
  assert.equal('sessionId' in result, false);
  assert.equal('createdBy' in result, false);
  assert.equal('branchRenderPaths' in result, false);
  assert.equal('mediaRevision' in result, false);
  assert.equal(publicationModel.stored.isPublished, false);
  assert.equal(publicationModel.stored.isRenderable, true);
  assert.equal(
    publicationModel.stored.publicRenderableVersion,
    'interactive_publication.v1',
  );
});

test('interactive publication becomes public only when explicitly finalized', async () => {
  const publicationModel = createMemoryModel();
  const created = await createInteractivePublicationForSessionVideo(
    '507f191e810c19729de860ea',
    {},
    {
      sessionData: session,
      publicationModel,
      preparePathMedia,
      buildBranchingStatus: () => completedBranching,
      cleanupPathMedia: async () => {},
    },
  );

  assert.equal(publicationModel.stored.isPublished, false);
  assert.equal(isInteractivePublicationPubliclyRenderable(publicationModel.stored), false);
  const finalized = await markInteractivePublicationPublished(created.id, { publicationModel });
  assert.equal(publicationModel.stored.isPublished, true);
  assert.equal(isInteractivePublicationPubliclyRenderable(publicationModel.stored), true);
  assert.equal(finalized.id, created.id);
  assert.equal('isPublished' in finalized, false);
});

test('branched republish is idempotent by session ID', async () => {
  const publicationModel = createMemoryModel();
  const cleanupCalls = [];
  const dependencies = {
    sessionData: session,
    publicationModel,
    preparePathMedia,
    buildBranchingStatus: () => completedBranching,
    cleanupPathMedia: async (...args) => cleanupCalls.push(args),
  };

  const first = await createInteractivePublicationForSessionVideo(
    '507f191e810c19729de860ea',
    { title: 'First title' },
    dependencies,
  );
  const firstRevision = publicationModel.stored.mediaRevision;
  const originalCreator = publicationModel.stored.createdBy;
  await markInteractivePublicationPublished(first.id, {
    expectedRevision: firstRevision,
    publicationModel,
  });
  const firstLiveUrl = publicationModel.stored.manifest.outputs.paths[0].contentUrl;
  const second = await createInteractivePublicationForSessionVideo(
    '507f191e810c19729de860eb',
    { title: 'Updated title' },
    dependencies,
  );

  assert.equal(first.id, second.id);
  assert.equal(second.title, 'Updated title');
  assert.equal(publicationModel.upsertCount, 2);
  assert.notEqual(
    first.manifest.outputs.paths[0].contentUrl,
    second.manifest.outputs.paths[0].contentUrl,
  );
  assert.equal(publicationModel.stored.manifest.outputs.paths[0].contentUrl, firstLiveUrl);
  assert.ok(publicationModel.stored.pendingMediaRevision);
  assert.equal(cleanupCalls.length, 0);
  const secondRevision = publicationModel.stored.pendingMediaRevision;
  await markInteractivePublicationPublished(second.id, {
    expectedRevision: secondRevision,
    publicationModel,
    cleanupPathMedia: dependencies.cleanupPathMedia,
  });
  assert.equal(cleanupCalls.length, 1);
  assert.equal(cleanupCalls[0][2].revisionId, firstRevision);
  assert.equal(publicationModel.stored.manifest.outputs.paths[0].contentUrl,
    second.manifest.outputs.paths[0].contentUrl);
  assert.equal(publicationModel.stored.createdBy, originalCreator);
});

test('stale republish staging cannot overwrite a newer live revision', async () => {
  const publicationModel = createMemoryModel();
  const first = await createInteractivePublicationForSessionVideo(
    '507f191e810c19729de860ea',
    { title: 'First title' },
    {
      sessionData: session,
      publicationModel,
      preparePathMedia,
      buildBranchingStatus: () => completedBranching,
      cleanupPathMedia: async () => {},
    },
  );
  await markInteractivePublicationPublished(first.id, { publicationModel });
  let interleaved = false;
  let preparedRevision = null;
  let cleanedRevision = null;

  await assert.rejects(
    () => createInteractivePublicationForSessionVideo(
      '507f191e810c19729de860ea',
      { title: 'Stale contender' },
      {
        sessionData: session,
        publicationModel,
        buildBranchingStatus: () => completedBranching,
        preparePathMedia: async (sourceSession, path, options) => {
          preparedRevision ||= options.revisionId;
          if (!interleaved) {
            interleaved = true;
            publicationModel.mutateStored((stored) => ({
              ...stored,
              mediaRevision: 'newer-live-revision',
              title: 'Newer live title',
            }));
          }
          return preparePathMedia(sourceSession, path, options);
        },
        cleanupPathMedia: async (_sessionId, _paths, options) => {
          cleanedRevision = options.revisionId;
        },
      },
    ),
    /superseded/,
  );

  assert.equal(cleanedRevision, preparedRevision);
  assert.equal(publicationModel.stored.mediaRevision, 'newer-live-revision');
  assert.equal(publicationModel.stored.title, 'Newer live title');
  assert.equal(publicationModel.stored.isPublished, true);
});

test('aborting a republish preserves the live manifest and removes only its draft revision', async () => {
  const publicationModel = createMemoryModel();
  const dependencies = {
    sessionData: session,
    publicationModel,
    preparePathMedia,
    buildBranchingStatus: () => completedBranching,
    cleanupPathMedia: async () => {},
  };
  const first = await createInteractivePublicationForSessionVideo(
    '507f191e810c19729de860ea',
    { title: 'Live title' },
    dependencies,
  );
  await markInteractivePublicationPublished(first.id, { publicationModel });
  const liveUrl = publicationModel.stored.manifest.outputs.paths[0].contentUrl;
  const draft = await createInteractivePublicationForSessionVideo(
    '507f191e810c19729de860ea',
    { title: 'Draft title' },
    dependencies,
  );
  const draftRevision = publicationModel.stored.pendingMediaRevision;
  let cleanedRevision = null;

  const result = await abortInteractivePublicationPublish(draft.id, {
    expectedRevision: draftRevision,
    publicationModel,
    cleanupPathMedia: async (_sessionId, _paths, options) => {
      cleanedRevision = options.revisionId;
    },
  });

  assert.deepEqual(result, { aborted: true, deleted: false });
  assert.equal(cleanedRevision, draftRevision);
  assert.equal(publicationModel.stored.pendingMediaRevision, undefined);
  assert.equal(publicationModel.stored.manifest.outputs.paths[0].contentUrl, liveUrl);
  assert.equal(publicationModel.stored.isPublished, true);
});

test('a retry resumes the draft already referenced by session markers without replacing its media', async () => {
  const publicationModel = createMemoryModel();
  const dependencies = {
    sessionData: session,
    publicationModel,
    preparePathMedia,
    buildBranchingStatus: () => completedBranching,
    cleanupPathMedia: async () => {},
  };
  const first = await createInteractivePublicationForSessionVideo(
    '507f191e810c19729de860ea',
    { title: 'Live title' },
    dependencies,
  );
  await markInteractivePublicationPublished(first.id, { publicationModel });
  const draft = await createInteractivePublicationForSessionVideo(
    '507f191e810c19729de860ea',
    { title: 'Draft title' },
    dependencies,
  );
  const draftRevision = publicationModel.stored.pendingMediaRevision;
  let prepareCalls = 0;
  const resumed = await createInteractivePublicationForSessionVideo(
    '507f191e810c19729de860ea',
    { title: 'Ignored until the interrupted draft is finalized' },
    {
      ...dependencies,
      sessionData: {
        ...session,
        publishedPublicationId: first.id,
        publishedVideoURL: draft.manifest.outputs.paths[0].contentUrl,
      },
      preparePathMedia: async (...args) => {
        prepareCalls += 1;
        return preparePathMedia(...args);
      },
    },
  );

  assert.equal(prepareCalls, 0);
  assert.equal(resumed.title, 'Draft title');
  assert.equal(getInteractivePublicationPublishRevision(resumed), draftRevision);
});

test('a retry resumes an initial hidden publication already referenced by session markers', async () => {
  const publicationModel = createMemoryModel();
  const created = await createInteractivePublicationForSessionVideo(
    '507f191e810c19729de860ea',
    { title: 'Initial draft' },
    {
      sessionData: session,
      publicationModel,
      preparePathMedia,
      buildBranchingStatus: () => completedBranching,
      cleanupPathMedia: async () => {},
    },
  );
  const revision = publicationModel.stored.mediaRevision;
  let prepareCalls = 0;
  const resumed = await createInteractivePublicationForSessionVideo(
    '507f191e810c19729de860ea',
    { title: 'Retry title' },
    {
      sessionData: {
        ...session,
        publishedPublicationId: created.id,
        publishedVideoURL: created.manifest.outputs.paths[0].contentUrl,
      },
      publicationModel,
      preparePathMedia: async (...args) => {
        prepareCalls += 1;
        return preparePathMedia(...args);
      },
      buildBranchingStatus: () => completedBranching,
      cleanupPathMedia: async () => {},
    },
  );

  assert.equal(prepareCalls, 0);
  assert.equal(resumed.title, 'Initial draft');
  assert.equal(getInteractivePublicationPublishRevision(resumed), revision);
});

test('first-publish cleanup waits for concurrent path workers to stop', async () => {
  const publicationModel = createMemoryModel();
  let secondWorkerFinished = false;
  let cleanupSawFinishedWorker = false;

  await assert.rejects(
    () => createInteractivePublicationForSessionVideo(
      '507f191e810c19729de860ea',
      {},
      {
        sessionData: session,
        publicationModel,
        buildBranchingStatus: () => completedBranching,
        preparePathMedia: async (_session, path) => {
          if (path.pathId === 'root.1') {
            throw new Error('simulated media failure');
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
          secondWorkerFinished = true;
          return preparePathMedia(_session, path);
        },
        cleanupPathMedia: async () => {
          cleanupSawFinishedWorker = secondWorkerFinished;
        },
      },
    ),
    /simulated media failure/,
  );

  assert.equal(secondWorkerFinished, true);
  assert.equal(cleanupSawFinishedWorker, true);
  assert.equal(publicationModel.upsertCount, 0);
});

test('failed manifest persistence removes the complete new media revision', async () => {
  const publicationModel = createMemoryModel();
  publicationModel.findOneAndUpdate = async () => {
    throw new Error('simulated persistence failure');
  };
  let preparedRevision = null;
  let cleanupRevision = null;

  await assert.rejects(
    () => createInteractivePublicationForSessionVideo(
      '507f191e810c19729de860ea',
      {},
      {
        sessionData: session,
        publicationModel,
        buildBranchingStatus: () => completedBranching,
        preparePathMedia: async (sourceSession, path, options) => {
          preparedRevision ||= options.revisionId;
          assert.equal(options.revisionId, preparedRevision);
          return preparePathMedia(sourceSession, path, options);
        },
        cleanupPathMedia: async (_sessionId, _paths, options) => {
          cleanupRevision = options.revisionId;
        },
      },
    ),
    /simulated persistence failure/,
  );

  assert.ok(preparedRevision);
  assert.equal(cleanupRevision, preparedRevision);
});

test('interactive delete removes the stored path media and document', async () => {
  const publicationModel = createMemoryModel();
  await createInteractivePublicationForSessionVideo(
    '507f191e810c19729de860ea',
    {},
    {
      sessionData: session,
      publicationModel,
      preparePathMedia,
      buildBranchingStatus: () => completedBranching,
    },
  );
  let cleanupInput = null;
  let cleanupRevision = null;
  const result = await deleteInteractivePublicationForSession(session._id, {
    publicationModel,
    cleanupPathMedia: async (_sessionId, paths, options) => {
      assert.equal(publicationModel.stored.isPublished, false);
      assert.equal(publicationModel.stored.isRenderable, false);
      cleanupInput = paths;
      cleanupRevision = options.revisionId;
    },
  });

  assert.equal(result.deleted, true);
  assert.deepEqual(cleanupInput.map((path) => path.path_id), ['root.1', 'root.2']);
  assert.ok(cleanupRevision);
  assert.equal(publicationModel.stored, null);
});

test('interactive delete removes both live and staged path revisions', async () => {
  const publicationModel = createMemoryModel();
  const dependencies = {
    sessionData: session,
    publicationModel,
    preparePathMedia,
    buildBranchingStatus: () => completedBranching,
    cleanupPathMedia: async () => {},
  };
  const live = await createInteractivePublicationForSessionVideo(
    '507f191e810c19729de860ea',
    { title: 'Live' },
    dependencies,
  );
  await markInteractivePublicationPublished(live.id, { publicationModel });
  await createInteractivePublicationForSessionVideo(
    '507f191e810c19729de860ea',
    { title: 'Staged' },
    dependencies,
  );
  const expectedRevisions = [
    publicationModel.stored.mediaRevision,
    publicationModel.stored.pendingMediaRevision,
  ].sort();
  const cleanedRevisions = [];

  await deleteInteractivePublicationForSession(session._id, {
    publicationModel,
    cleanupPathMedia: async (_sessionId, _paths, options) => {
      cleanedRevisions.push(options.revisionId);
    },
  });

  assert.deepEqual(cleanedRevisions.sort(), expectedRevisions);
  assert.equal(publicationModel.stored, null);
});

test('interactive delete retains a retryable hidden record when object cleanup is incomplete', async () => {
  const publicationModel = createMemoryModel();
  await createInteractivePublicationForSessionVideo(
    '507f191e810c19729de860ea',
    {},
    {
      sessionData: session,
      publicationModel,
      preparePathMedia,
      buildBranchingStatus: () => completedBranching,
      cleanupPathMedia: async () => {},
    },
  );

  await assert.rejects(
    () => deleteInteractivePublicationForSession(session._id, {
      publicationModel,
      cleanupPathMedia: async () => ({
        failed: [{ key: 'video.mp4', error: 'temporary storage error' }],
      }),
    }),
    /cleanup is incomplete/,
  );

  assert.ok(publicationModel.stored);
  assert.ok(publicationModel.stored.unpublishToken);
  assert.equal(publicationModel.stored.isPublished, false);
  assert.equal(publicationModel.stored.isRenderable, false);

  const retried = await deleteInteractivePublicationForSession(session._id, {
    publicationModel,
    cleanupPathMedia: async () => ({ failed: [] }),
  });
  assert.equal(retried.deleted, true);
  assert.equal(publicationModel.stored, null);
});

test('interactive serializer does not expose persistence or generation internals', () => {
  const result = serializeInteractivePublication({
    _id: '507f1f77bcf86cd799439012',
    schemaVersion: 'interactive_publication.v1',
    type: 'InteractiveVideo',
    sessionId: session._id,
    createdBy: '507f191e810c19729de860ea',
    title: 'Safe response',
    categories: ['Education'],
    topics: ['cell biology'],
    thumbnailUrl: 'https://static.samsar.one/published/default.png',
    manifest: {
      schemaVersion: 'interactive_video_manifest.v1',
      default_path_id: 'root.1',
      timing: { origin: 'media', unit: 'seconds' },
      tree: { root_node_id: 'root', choice_points: [] },
      outputs: { paths: [] },
    },
    billing: { credits: 99 },
    mediaRevision: 'private-revision',
    pendingMediaRevision: 'private-pending-revision',
    pendingPublicationData: { title: 'Private draft' },
  });

  assert.equal(result.sessionId, undefined);
  assert.equal(result.createdBy, undefined);
  assert.equal(result.billing, undefined);
  assert.equal(result.mediaRevision, undefined);
  assert.equal(result.pendingMediaRevision, undefined);
  assert.equal(result.pendingPublicationData, undefined);
  assert.deepEqual(result.categories, ['Education']);
  assert.deepEqual(result.topics, ['cell biology']);
});

test('interactive publication maps its default public path to existing session markers', () => {
  const publication = {
    id: '507f1f77bcf86cd799439012',
    type: 'InteractiveVideo',
    schema: 'interactive_publication.v1',
    title: 'Published fork',
    description: 'Pick a path.',
    tags: ['interactive'],
    thumbnailUrl: 'https://static.samsar.one/published/default-thumbnail.png',
    aspectRatio: '16:9',
    inLanguage: 'EN',
    hasSubtitles: true,
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
          duration: 12,
          is_default: true,
        }],
      },
    },
  };
  const publishedAt = new Date('2026-07-19T00:00:00.000Z');
  const update = buildInteractivePublishedSessionUpdate(
    publication,
    { inputPrompt: 'A branching story', expressGenerativeVideoModel: 'RUNWAYML' },
    {},
    publishedAt,
  );

  assert.equal(update.publishedPublicationId, publication.id);
  assert.equal(update.publishedVideoURL, publication.manifest.outputs.paths[0].contentUrl);
  assert.equal(update.publishedSplashImage, publication.manifest.outputs.paths[0].thumbnailUrl);
  assert.equal(update.ispublishedVideo, true);
  assert.equal(update.publishedAt, publishedAt);
  assert.equal('splashImage' in update, false);
});

test('public rendering rejects the entire manifest when any path media is not public', () => {
  const publication = {
    _id: '507f1f77bcf86cd799439012',
    type: 'InteractiveVideo',
    schemaVersion: 'interactive_publication.v1',
    publicRenderableVersion: 'interactive_publication.v1',
    isPublished: true,
    isRenderable: true,
    title: 'Public fork',
    thumbnailUrl: 'https://static.samsar.one/published/session/default.png',
    manifest: {
      schemaVersion: 'interactive_video_manifest.v1',
      default_path_id: 'root.1',
      timing: { origin: 'media', unit: 'seconds' },
      tree: {
        root_node_id: 'root',
        choice_points: [{
          branch_point_id: 'choice-root',
          parent_node_id: 'root',
          switch_at_seconds: 5,
          options: [{ child_node_id: 'root.1', leaf_path_ids: ['root.1'] }],
        }],
      },
      outputs: {
        paths: [{
          path_id: 'root.1',
          contentUrl: 'https://static.samsar.one/published/session/root.1/video.mp4',
          thumbnailUrl: 'https://static.samsar.one/published/session/root.1/thumbnail.png',
          encodingFormat: 'video/mp4',
          duration: 10,
          is_default: true,
        }],
      },
    },
  };

  assert.equal(isInteractivePublicationPubliclyRenderable(publication), true);
  const brokenGraph = structuredClone(publication);
  brokenGraph.manifest.tree.choice_points[0].options[0].leaf_path_ids = ['missing-path'];
  assert.equal(isInteractivePublicationPubliclyRenderable(brokenGraph), false);
  publication.manifest.outputs.paths[0].thumbnailUrl = 'https://private.example/thumbnail.png';
  assert.equal(isInteractivePublicationPubliclyRenderable(publication), false);
});
