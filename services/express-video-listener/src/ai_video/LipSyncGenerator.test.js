import test from 'node:test';
import assert from 'node:assert/strict';

import { __testOnly__ } from './LipSyncGenerator.js';

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
