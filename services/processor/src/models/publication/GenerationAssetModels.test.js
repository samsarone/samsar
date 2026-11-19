import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPublicationGenerationAssetModels } from './GenerationAssetModels.js';

function fakeModel(rows, queries) {
  return { find(query) {
    queries.push(query);
    const matches = rows.filter((row) => row.sessionId === query.sessionId && query.$or.some((clause) => (
      Object.entries(clause).some(([field, condition]) => condition.$in.some((pattern) => pattern.test(row[field] || '')))
    )));
    return { select() { return { lean: async () => matches }; } };
  } };
}

test('accepted asset URLs resolve persisted models without adding rejected generations', async () => {
  const imageQueries = [];
  const videoQueries = [];
  const result = await loadPublicationGenerationAssetModels({
    _id: 'session-one',
    generations: [{ src: 'generations/session-one/rejected.png' }],
    layers: [{
      imageSession: { activeItemList: [{ type: 'image', src: 'https://cdn.example/assets_v2/generations/session-one/chosen.png?signature=value' }],
        activeGeneratedImage: 'generations/session-one/rejected.png' },
      aiVideoLayer: 'ai_video/generations/session-one/base.mp4',
      lipSyncRemoteLink: 'https://cdn.example/assets_v2/ai_video/lip_sync/session-one/lipsync.mp4',
    }],
  }, {
    generatedImageModel: fakeModel([
      { sessionId: 'session-one', url: 'generations/session-one/chosen.png', model: 'IMAGE_USED' },
      { sessionId: 'session-one', url: 'generations/session-one/rejected.png', model: 'REJECTED_IMAGE' },
      { sessionId: 'other-session', url: 'generations/session-one/chosen.png', model: 'WRONG_SESSION' },
    ], imageQueries),
    generatedVideoModel: fakeModel([
      { sessionId: 'session-one', url: 'https://media.example/assets/ai_video/generations/session-one/base.mp4', model: 'VIDEO_USED' },
      { sessionId: 'session-one', remoteUrl: 'https://cdn.example/assets_v2/ai_video/lip_sync/session-one/lipsync.mp4', model: 'LIPSYNC_USED' },
      { sessionId: 'session-one', url: 'ai_video/generations/session-one/discarded.mp4', model: 'REJECTED_VIDEO' },
    ], videoQueries),
  });
  assert.deepEqual(result, { image: ['IMAGE_USED'], video: ['VIDEO_USED', 'LIPSYNC_USED'] });
  assert.equal(imageQueries[0].sessionId, 'session-one');
  assert.equal(videoQueries[0].sessionId, 'session-one');
});

test('matches exact paths and literal regex metacharacters, excluding history and hidden items', async () => {
  const queries = [];
  const result = await loadPublicationGenerationAssetModels({ _id: 'session-one', layers: [{
    imageSession: { activeItemList: [
      { type: 'image', src: '/assets/generations/session-one/a[1].png' },
      { type: 'image', src: 'generations/session-one/hidden.png', hidden: true },
    ], previousActiveItemList: [{ type: 'image', src: 'generations/session-one/old.png' }] },
    filterPasses: [{ src: 'generations/session-one/rejected.png' }],
  }] }, {
    generatedImageModel: fakeModel([
      { sessionId: 'session-one', url: 'generations/session-one/a[1].png', model: 'ACTUAL' },
      { sessionId: 'session-one', url: 'generations/other/a[1].png', model: 'SAME_BASENAME' },
      { sessionId: 'session-one', url: 'generations/session-one/a1.png', model: 'REGEX_FALSE_POSITIVE' },
      { sessionId: 'session-one', url: 'generations/session-one/hidden.png', model: 'HIDDEN' },
    ], queries), generatedVideoModel: fakeModel([], []),
  });
  assert.deepEqual(result, { image: ['ACTUAL'], video: [] });
});

test('legacy image selections and branch timelines resolve without model defaults', async () => {
  const result = await loadPublicationGenerationAssetModels({ _id: 'session-one', layers: [{
    imageSession: { activeGeneratedImage: 'generations/session-one/legacy.png' },
  }, { _id: 'branch-layer', aiVideoLayer: 'ai_video/generations/session-one/branch.mp4' }],
  branchRenderPaths: [{ timeline: [{ layerId: 'branch-layer', assetKey: 'scene:1:hash', frames: [] }] }] }, {
    generatedImageModel: fakeModel([{ sessionId: 'session-one', url: 'generations/session-one/legacy.png', model: 'RETIRED_IMAGE' }], []),
    generatedVideoModel: fakeModel([{ sessionId: 'session-one', url: 'ai_video/generations/session-one/branch.mp4', model: 'RETIRED_VIDEO' }], []),
  });
  assert.deepEqual(result, { image: ['RETIRED_IMAGE'], video: ['RETIRED_VIDEO'] });
  assert.deepEqual(await loadPublicationGenerationAssetModels({}), { image: [], video: [] });
});

test('URI encoded asset paths and raw persisted paths identify the same selected assets', async () => {
  const result = await loadPublicationGenerationAssetModels({ _id: 'session-one', layers: [{
    imageSession: { activeItemList: [
      { type: 'image', src: 'https://cdn.example/assets_v2/generations/session-one/space%20%5B1%5D.png' },
      { type: 'image', src: 'generations/session-one/snow ☃.png' },
    ] },
  }] }, {
    generatedImageModel: fakeModel([
      { sessionId: 'session-one', url: 'generations/session-one/space [1].png', model: 'RAW_PATH' },
      { sessionId: 'session-one', url: 'https://cdn.example/assets_v2/generations/session-one/snow%20%E2%98%83.png', model: 'ENCODED_PATH' },
    ], []), generatedVideoModel: fakeModel([], []),
  });
  assert.deepEqual(result, { image: ['RAW_PATH', 'ENCODED_PATH'], video: [] });
});
