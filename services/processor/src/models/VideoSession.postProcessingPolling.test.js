import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import VideoSession from '../schema/VideoSession.js';
import VideoGeneration from '../schema/VideoGeneration.js';
import UserVideoUploadTask from '../schema/UserVideoUploadTask.js';
import GeneratedImage from '../schema/generations/GeneratedImage.js';
import { cancelPendingRenderForSession, getVideoRenderStatus, refreshLayersForSession } from './VideoSession.js';
import { buildVideoStatusDetailedResponse, VIDEO_STATUS_DETAILED_SESSION_PROJECTION } from './api/StatusAPI.js';

const sessionId = '507f1f77bcf86cd799439011';
const imageUrl = 'https://media.example/scene.png';
const videoUrl = 'https://media.example/scene.mp4';

function query(value) {
  return {
    select() { return this; },
    sort() { return this; },
    async lean() { return value; },
  };
}

function pendingSession({ withVideo = false } = {}) {
  return {
    _id: sessionId,
    userId: 'owner',
    isExpressGeneration: true,
    expressGenerationPending: true,
    videoGenerationPending: false,
    videoLink: null,
    remoteURL: null,
    expressGenerationStatus: {
      status: 'PENDING',
      image_generation: 'COMPLETED',
      ai_video_generation: withVideo ? 'COMPLETED' : 'INIT',
      frame_generation: 'INIT',
      video_generation: 'INIT',
    },
    layers: [{
      _id: 'scene',
      duration: 5,
      durationOffset: 0,
      imageSession: { activeGeneratedImage: imageUrl, activeItemList: [] },
      ...(withVideo ? { aiVideoGenerationStatus: 'COMPLETED', aiVideoRemoteLink: videoUrl } : {}),
    }],
    audioLayers: [{
      _id: 'speech',
      generationType: 'speech',
      generationStatus: 'COMPLETED',
      selectedRemoteAudioLink: 'https://media.example/speech.mp3',
      duration: 5,
      startTime: 0,
      endTime: 5,
    }],
  };
}

test('Studio render polling exposes copied layers as soon as a blank post-processing session is populated', async (t) => {
  t.mock.method(mongoose, 'connect', async () => mongoose);
  let session = {
    _id: sessionId, userId: 'owner', layers: [], audioLayers: [],
    videoLink: null, remoteURL: null,
  };
  t.mock.method(VideoSession, 'findOne', async () => session);
  t.mock.method(UserVideoUploadTask, 'find', () => query([]));
  t.mock.method(GeneratedImage, 'find', () => query([]));

  const blank = await getVideoRenderStatus({ id: sessionId, userId: 'owner' });
  assert.equal(blank.status, 'IDLE');
  assert.deepEqual(blank.session.layers, []);

  session.postProcessingPreparationPending = true;
  const preparing = await getVideoRenderStatus({ id: sessionId, userId: 'owner' });
  assert.equal(preparing.status, 'PENDING');
  assert.deepEqual(preparing.session.layers, []);
  const detailed = await buildVideoStatusDetailedResponse({
    sessionId, sessionSnapshot: session, baseStatus: { status: 'PENDING' },
  });
  assert.equal(detailed.session.postProcessingPreparationPending, true);
  for (const [flag, status] of [
    ['expressGenerationFailed', 'FAILED'], ['expressGenerationCancelled', 'CANCELLED'], ['expressGenerationPaused', 'PAUSED'],
  ]) {
    session[flag] = true;
    assert.equal((await getVideoRenderStatus({ id: sessionId, userId: 'owner' })).status, status);
    delete session[flag];
  }

  session = pendingSession();
  const pending = await getVideoRenderStatus({ id: sessionId, userId: 'owner' });
  assert.equal(pending.status, 'PENDING');
  assert.equal(pending.session.layers.length, 1);
  assert.equal(pending.session.layers[0].imageSession.activeItemList[0].src, imageUrl);
  assert.equal(pending.session.audioLayers[0].selectedRemoteAudioLink, 'https://media.example/speech.mp3');
  assert.equal(pending.session.videoLink, null);
});

test('cancelling preparation in Studio prevents the pending clone from activating', async (t) => {
  t.mock.method(mongoose, 'connect', async () => mongoose);
  const session = { _id: sessionId, userId: 'owner', postProcessingPreparationPending: true };
  t.mock.method(VideoSession, 'findById', async () => session);
  t.mock.method(VideoSession, 'findByIdAndUpdate', async (id, update) => {
    assert.equal(id, sessionId);
    return Object.assign(session, update.$set);
  });
  t.mock.method(VideoGeneration, 'deleteMany', async () => ({}));

  const cancelled = await cancelPendingRenderForSession('owner', { id: sessionId });
  assert.equal(cancelled.postProcessingPreparationPending, false);
  assert.equal(cancelled.expressGenerationCancelled, true);
  assert.equal(cancelled.expressGenerationPending, false);
});

test('both Studio polls and detailed status separate the copied reroll preview from new generation output', async (t) => {
  t.mock.method(mongoose, 'connect', async () => mongoose);
  const session = pendingSession();
  session.postProcessingBilling = { operation: 'reroll_layers' };
  const layer = session.layers[0];
  layer.imageSession = { generationStatus: 'PENDING', activeItemList: [{ id: 'title', type: 'text' }] };
  layer.rerollPreview = { type: 'video', url: videoUrl };
  t.mock.method(VideoSession, 'findOne', () => Object.assign(Promise.resolve(session), { populate: async () => session }));
  t.mock.method(VideoSession, 'findById', () => query(session));
  t.mock.method(UserVideoUploadTask, 'find', () => query([]));
  t.mock.method(GeneratedImage, 'find', () => query([]));
  const projection = VIDEO_STATUS_DETAILED_SESSION_PROJECTION.split(' ');
  for (const field of ['postProcessingBilling.operation', 'layers.rerollPreview', 'layers.imageSession.videoRenderStartFrameImage']) {
    assert.ok(projection.includes(field));
  }

  async function readLayers() {
    const render = await getVideoRenderStatus({ id: sessionId, userId: 'owner' });
    const refresh = await refreshLayersForSession(sessionId, 'owner');
    assert.deepEqual(render.session.layers, refresh.layers);
    const detailed = await buildVideoStatusDetailedResponse({ sessionId });
    return [render.session.layers[0], detailed.session.layers[0]];
  }
  for (const legacy of [false, true]) {
    if (legacy) {
      delete layer.rerollPreview;
      layer.imageSession.videoRenderStartFrameImage = imageUrl;
    }
    const [studio, detailed] = await readLayers();
    const preview = legacy ? { type: 'image', url: imageUrl } : { type: 'video', url: videoUrl };
    assert.deepEqual(studio.rerollPreview, preview);
    assert.deepEqual(detailed.rerollPreview, preview);
    assert.deepEqual(studio.imageSession.activeItemList, layer.imageSession.activeItemList);
    assert.equal(studio.aiVideoLayer, undefined);
    assert.equal(detailed.preview, undefined);
    assert.equal(detailed.image.url, undefined);
    assert.equal(detailed.image.status, 'PENDING');
  }
  layer.rerollPreview = { type: 'video', url: videoUrl };
  layer.imageSession.activeGeneratedImage = 'https://media.example/new.png';
  const [studio, detailed] = await readLayers();
  assert.equal(studio.rerollPreview, undefined);
  assert.equal(detailed.rerollPreview, undefined);
  assert.equal(studio.imageSession.activeItemList[0].src, layer.imageSession.activeGeneratedImage);
  const sharedSnapshot = await getVideoRenderStatus({ id: sessionId });
  assert.equal(sharedSnapshot.session.layers[0].imageSession.activeItemList[0].src, layer.imageSession.activeGeneratedImage);
  assert.equal(detailed.preview.url, layer.imageSession.activeGeneratedImage);
  layer.imageSession.activeGeneratedImage = '';
  layer.rerollPreview = {
    type: 'video',
    url: `https://static.samsar.one/assets_v2/video/output/${sessionId}/scene.mp4?Expires=1&Signature=old&Key-Pair-Id=old`,
  };
  const [refreshedCopy, detailedCopy] = await readLayers();
  for (const item of [refreshedCopy, detailedCopy]) {
    const url = new URL(item.rerollPreview.url);
    assert.equal(url.pathname, `/assets_v2/video/output/${sessionId}/scene.mp4`);
    assert.notEqual(url.searchParams.get('Signature'), 'old');
  }
  session.expressGenerationPending = false;
  assert.equal((await readLayers())[0].rerollPreview, undefined);
});

for (const withVideo of [false, true]) {
  test(`detailed post-processing polling exposes ${withVideo ? 'video' : 'image'} layers before final rendering`, async (t) => {
    t.mock.method(mongoose, 'connect', async () => mongoose);
    t.mock.method(VideoSession, 'findById', () => query(pendingSession({ withVideo })));
    t.mock.method(GeneratedImage, 'find', () => query([]));

    const result = await buildVideoStatusDetailedResponse({ sessionId });
    assert.equal(result.status, 'PENDING');
    assert.equal(result.result_url, undefined);
    assert.equal(result.session.stages.video_generation, 'INIT');
    assert.equal(result.session.layers[0].image.url, imageUrl);
    assert.equal(result.session.layers[0].preview.type, withVideo ? 'video' : 'image');
    assert.equal(result.session.layers[0].preview.url, withVideo ? videoUrl : imageUrl);
    assert.equal(result.session.audioLayers[0].url, 'https://media.example/speech.mp3');
  });
}
