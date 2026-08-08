import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeImageToVideoStartImagePayload } from './VideoInputPayloadAliases.js';
import { __testOnly__ } from './StepVideoAPI.js';

test('step image-to-video accepts start image URL aliases', () => {
  const startImageUrl = 'https://media.example.com/assets_v2/session/start.png';

  for (const key of ['start_image_url', 'startImageUrl', 'start_image', 'startImage']) {
    const normalized = normalizeImageToVideoStartImagePayload({ [key]: startImageUrl });
    assert.deepEqual(normalized.image_urls, [startImageUrl], key);
  }
});

test('step image-to-video preserves explicit image_urls over aliases', () => {
  const explicitImageUrls = ['https://media.example.com/assets_v2/session/explicit.png'];
  const normalized = normalizeImageToVideoStartImagePayload({
    image_urls: explicitImageUrls,
    startImage: 'https://media.example.com/assets_v2/session/start.png',
  });

  assert.equal(normalized.image_urls, explicitImageUrls);
});

test('step status preserves a terminal provider failure detected by the base status endpoint', () => {
  assert.equal(__testOnly__.normalizeStepStatus({
    isStepVideoGeneration: true,
    expressGenerationFailed: false,
  }, {
    status: 'PENDING',
  }, {
    status: 'FAILED',
    generationError: 'Provider rejected the source image.',
  }), 'FAILED');
});

test('Docker-local step status exposes mounted video and audio references', () => {
  const previousCurrentEnv = process.env.CURRENT_ENV;
  const previousMode = process.env.SAMSAR_MEDIA_DELIVERY_MODE;
  const previousProcessorApi = process.env.PROCESSOR_API;
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_MEDIA_DELIVERY_MODE = 'docker-local';
  process.env.PROCESSOR_API = 'http://localhost:3002';
  try {
    const video = __testOnly__.serializeLayer({
      aiVideoLayer: 'assets_v2/ai_video/generations/session-1/scene.mp4',
      aiVideoRemoteLink: 'https://provider.example/expiring-scene.mp4',
      lipSyncVideoLayer: 'assets_v2/ai_video/generations/session-1/lip-sync.mp4',
      lipSyncRemoteLink: 'https://provider.example/expiring-lip-sync.mp4',
      soundEffectVideoLayer: 'assets_v2/ai_video/generations/session-1/sound-effect.mp4',
      soundEffectRemoteLink: 'https://provider.example/expiring-sound-effect.mp4',
    });
    const audio = __testOnly__.serializeAudioLayer({
      selectedLocalAudioLink: 'assets_v2/user_resources/user-1/audio/speech.mp3',
      localAudioLinks: ['assets_v2/user_resources/user-1/audio/speech.mp3'],
      selectedRemoteAudioLink: 'https://provider.example/expiring-speech.mp3',
      remoteAudioLinks: ['https://provider.example/expiring-speech.mp3'],
    });

    assert.equal(
      video.ai_video_url,
      'http://localhost:3002/assets_v2/ai_video/generations/session-1/scene.mp4',
    );
    assert.equal(
      audio.selected_audio_url,
      'http://localhost:3002/assets_v2/user_resources/user-1/audio/speech.mp3',
    );
    assert.equal(
      video.lip_sync_url,
      'http://localhost:3002/assets_v2/ai_video/generations/session-1/lip-sync.mp4',
    );
    assert.equal(
      video.sound_effect_url,
      'http://localhost:3002/assets_v2/ai_video/generations/session-1/sound-effect.mp4',
    );
    assert.deepEqual(audio.remote_audio_links, [
      'http://localhost:3002/assets_v2/user_resources/user-1/audio/speech.mp3',
    ]);
  } finally {
    if (previousCurrentEnv === undefined) delete process.env.CURRENT_ENV;
    else process.env.CURRENT_ENV = previousCurrentEnv;
    if (previousMode === undefined) delete process.env.SAMSAR_MEDIA_DELIVERY_MODE;
    else process.env.SAMSAR_MEDIA_DELIVERY_MODE = previousMode;
    if (previousProcessorApi === undefined) delete process.env.PROCESSOR_API;
    else process.env.PROCESSOR_API = previousProcessorApi;
  }
});
