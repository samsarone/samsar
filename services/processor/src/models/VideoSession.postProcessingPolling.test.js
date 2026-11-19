import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import VideoSession from '../schema/VideoSession.js';
import UserVideoUploadTask from '../schema/UserVideoUploadTask.js';
import GeneratedImage from '../schema/generations/GeneratedImage.js';
import { getVideoRenderStatus } from './VideoSession.js';
import { buildVideoStatusDetailedResponse } from './api/StatusAPI.js';

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

  const blank = await getVideoRenderStatus({ id: sessionId, userId: 'owner' });
  assert.equal(blank.status, 'IDLE');
  assert.deepEqual(blank.session.layers, []);

  session = pendingSession();
  const pending = await getVideoRenderStatus({ id: sessionId, userId: 'owner' });
  assert.equal(pending.status, 'PENDING');
  assert.equal(pending.session.layers.length, 1);
  assert.equal(pending.session.layers[0].imageSession.activeItemList[0].src, imageUrl);
  assert.equal(pending.session.audioLayers[0].selectedRemoteAudioLink, 'https://media.example/speech.mp3');
  assert.equal(pending.session.videoLink, null);
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
