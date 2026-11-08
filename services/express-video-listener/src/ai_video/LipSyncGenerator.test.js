import test from 'node:test';
import assert from 'node:assert/strict';

import { __testOnly__, generateLipSyncForLayer } from './LipSyncGenerator.js';
import VideoSession from '../schema/VideoSession.js';
import AIVideoLayerGeneration from '../schema/AIVideoLayerGeneration.js';

test('lip sync accepts original AI video layers with remote-only video references', () => {
  assert.equal(
    __testOnly__.hasReusableBaseAiVideo({
      hasAiVideoLayer: true,
      aiVideoRemoteLink: 'https://static.samsar.one/assets_v2/user_resources/user-1/ai_videos/session/layer/video.mp4',
    }),
    true,
  );
});

test('lip sync active request query is scoped to one session layer', () => {
  assert.deepEqual(
    __testOnly__.buildActiveLipSyncRequestQuery({
      sessionId: 'session-1',
      layerId: 'layer-1',
    }),
    {
      sessionId: 'session-1',
      layerId: 'layer-1',
      generationType: 'lip_sync',
      status: { $in: ['INIT', 'PENDING'] },
    },
  );
});

test('lip sync queues the stable local audio reference instead of a provider URL', () => {
  assert.equal(
    __testOnly__.getCanonicalAudioReference(
      '/assets_v2/user_resources/user-1/audio/padded.wav',
      'https://expired-tunnel.trycloudflare.com/assets_v2/temp_audio/padded.wav',
    ),
    '/assets_v2/user_resources/user-1/audio/padded.wav',
  );
});

test('lip sync preserves an independently hosted audio reference when no local asset exists', () => {
  assert.equal(
    __testOnly__.getCanonicalAudioReference(
      '',
      'https://provider.example/audio/speech.wav?token=provider-owned',
    ),
    'https://provider.example/audio/speech.wav?token=provider-owned',
  );
});

test('lip sync queues the uploaded padded object instead of an unpublished local padded path', () => {
  assert.equal(
    __testOnly__.getUploadedAudioReference(
      'https://static.samsar.one/assets_v2/temp_audio/session_layer_audio_speech_padded.wav',
      '/assets_v2/video/audio/session/audio/speech_padded.wav',
      'https://static.samsar.one/assets_v2/video/audio/session/audio/speech.mp3',
    ),
    'https://static.samsar.one/assets_v2/temp_audio/session_layer_audio_speech_padded.wav',
  );
});

test('Docker-local lip sync keeps the uploaded stable processor URL for dispatch-time tunneling', () => {
  assert.equal(
    __testOnly__.getUploadedAudioReference(
      'http://localhost:3002/assets_v2/temp_audio/session_layer_speech_padded.wav',
      '/assets_v2/video/audio/session/audio/speech_padded.wav',
      '',
    ),
    'http://localhost:3002/assets_v2/temp_audio/session_layer_speech_padded.wav',
  );
});

test('lip sync connected-audio lookup ignores non-speech layers', () => {
  const currentLayer = { _id: 'layer-1' };
  const connectedAudio = __testOnly__.findConnectedAudioLayer([
    {
      _id: 'music-1',
      generationType: 'music',
      connectedLayerId: 'layer-1',
      connectedLayerIndex: 0,
    },
    {
      _id: 'speech-1',
      generationType: 'speech',
      connectedLayerId: 'layer-1',
      connectedLayerIndex: 0,
    },
  ], currentLayer, 0);

  assert.equal(connectedAudio?._id, 'speech-1');
});

test('production Docker retains production lip sync retry behavior', () => {
  assert.equal(__testOnly__.shouldRetryLipSyncFailure({
    CURRENT_ENV: 'production',
    SAMSAR_DEPLOYMENT_EDITION: 'production',
    SAMSAR_RUNTIME: 'docker',
  }), true);
});

test('standalone and legacy Docker editions disable lip sync retry-on-fail', () => {
  assert.equal(__testOnly__.shouldRetryLipSyncFailure({
    SAMSAR_DEPLOYMENT_EDITION: 'standalone',
    SAMSAR_RUNTIME: 'docker',
  }), false);
  assert.equal(__testOnly__.shouldRetryLipSyncFailure({ CURRENT_ENV: 'docker' }), false);
});

test('one lip-sync enqueue failure marks its layer and still queues other character layers', async () => {
  const generated = [];
  const failed = [];
  const layers = ['first', 'second'].map((id) => ({
    _id: id,
    layerAiVideoType: 'character',
    hasAiVideoLayer: true,
    aiVideoLayer: `/base/${id}.mp4`,
  }));
  const audioLayers = ['first', 'second'].map((id) => ({
    _id: `speech-${id}`,
    generationType: 'speech',
    connectedLayerId: id,
  }));

  await __testOnly__.enqueueLipSyncLayers('session', layers, audioLayers, {
    generateLayer: async (_sessionId, layer) => {
      generated.push(layer._id);
      if (layer._id === 'first') throw new Error('Audio upload failed');
    },
    markFailed: async (_sessionId, layerId, error) => failed.push([layerId, error.message]),
    log: () => {},
  });

  assert.deepEqual(generated, ['first', 'second']);
  assert.deepEqual(failed, [['first', 'Audio upload failed']]);
  assert.deepEqual(layers.map((layer) => layer.aiVideoLayer), ['/base/first.mp4', '/base/second.mp4']);
  assert.deepEqual(audioLayers.map((layer) => layer._id), ['speech-first', 'speech-second']);
});


test('an active lip-sync request is reused before media padding or publication can change its inputs', async t => {
  const active = { _id: 'accepted-request', status: 'PENDING', videoLink: 'https://original.example/video.mp4', audioLink: 'https://original.example/audio.wav' };
  const session = { userId: 'user' };
  Object.defineProperty(session, 'audioLayers', { get() { throw new Error('Active provider request must not prepare audio again'); } });
  t.mock.method(VideoSession, 'findOne', async () => session);
  t.mock.method(VideoSession, 'updateOne', async () => ({ modifiedCount: 1 }));
  t.mock.method(AIVideoLayerGeneration, 'findOne', () => ({ sort: async () => active }));
  const result = await generateLipSyncForLayer('session', { _id: 'layer' }, { _id: 'speech' });
  assert.equal(result, active);
  assert.equal(result.videoLink, 'https://original.example/video.mp4');
  assert.equal(result.audioLink, 'https://original.example/audio.wav');
});


test('terminal media publication failure stops enqueueing further layers without optional fallback', async () => {
  const generated = [], failed = [];
  const layers = ['first', 'second'].map(_id => ({ _id, layerAiVideoType: 'character', hasAiVideoLayer: true, aiVideoLayer: `/${_id}.mp4` }));
  const audio = layers.map(layer => ({ _id: `speech-${layer._id}`, generationType: 'speech', connectedLayerId: layer._id }));
  await __testOnly__.enqueueLipSyncLayers('session', layers, audio, {
    generateLayer: async (_session, layer) => {
      generated.push(layer._id);
      throw Object.assign(new Error('Network recovery exhausted'), { code: 'PROVIDER_MEDIA_PREPARATION_FAILED', lipSyncInfrastructureFailure: true });
    },
    markFailed: async (_session, layerId, error) => failed.push([layerId, error.code]),
    log: () => {},
  });
  assert.deepEqual(generated, ['first']);
  assert.deepEqual(failed, [['first', 'PROVIDER_MEDIA_PREPARATION_FAILED']]);
});

test('lip sync preparation writes preserve pause, cancellation, terminal failure and completed output', () => {
  const filter = __testOnly__.buildLipSyncLayerWriteGuard('session', 'layer');
  assert.deepEqual(filter.expressGenerationPaused, { $ne: true });
  assert.deepEqual(filter.expressGenerationCancelled, { $ne: true });
  assert.deepEqual(filter.expressGenerationFailed, { $ne: true });
  assert.deepEqual(filter.layers.$elemMatch, { _id: 'layer', lipSyncVideoGenerationStatus: { $ne: 'COMPLETED' } });
});
