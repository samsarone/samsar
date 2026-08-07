import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildExternalImageToVideoInput,
  buildExternalStepImageToVideoInput,
  buildExternalVideoToVideoInput,
  getExternalVideoAttemptId,
  getStartImageReference,
  resolveExternalVideoRoute,
  shouldUseSamsarExternalVideoProvider,
} from './base/SamsarExternalVideoListener.js';
import { resolveDockerVideoProvider } from './consts/DockerProviderPriority.js';

const originalFetch = globalThis.fetch;

test.beforeEach(() => {
  globalThis.fetch = async (url) => {
    const normalizedUrl = String(url);
    const contentType = /\.mp3(?:$|\?)/i.test(normalizedUrl)
      ? 'audio/mpeg'
      : 'video/mp4';
    return {
      ok: true,
      status: 206,
      url: normalizedUrl,
      headers: { get: () => contentType },
      body: { cancel: async () => {} },
    };
  };
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

const ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_MEDIA_DELIVERY_MODE',
  'MEDIA_DELIVERY_MODE',
  'SAMSAR_PUBLIC_MEDIA_BASE_URL',
  'SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL',
  'SAMSAR_MEDIA_TUNNEL_PUBLIC_URL',
  'MEDIA_PUBLIC_URL',
  'STATIC_CDN_URL',
  'SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL',
  'SAMSAR_VALIDATE_PUBLIC_MEDIA_URL',
  'SAMSAR_MEDIA_TUNNEL_REFRESH_WAIT_MS',
  'SAMSAR_MEDIA_TUNNEL_REFRESH_POLL_MS',
  'SAMSAR_MEDIA_TUNNEL_REFRESH_REQUEST_PATH',
  'SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED',
  'SAMSAR_EXTERNAL_PROVIDERS_ENABLED',
  'FAL_API_KEY',
  'SAMSAR_API_KEY',
];

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = snapshot[key];
    }
  }
}

function configureDockerPublicMedia() {
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_MEDIA_DELIVERY_MODE = 'docker-local';
  process.env.MEDIA_DELIVERY_MODE = 'docker-local';
  process.env.SAMSAR_PUBLIC_MEDIA_BASE_URL = 'http://localhost:3002/';
  process.env.SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL = 'http://localhost:3002/';
  process.env.SAMSAR_MEDIA_TUNNEL_PUBLIC_URL = 'https://media-tunnel.trycloudflare.com';
  process.env.MEDIA_PUBLIC_URL = 'http://localhost:3002/';
  process.env.STATIC_CDN_URL = 'http://localhost:3002/';
  process.env.SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL = 'http://203.0.113.10/api';
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_WAIT_MS = '1';
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_POLL_MS = '10';
}

test('a persisted provider selection keeps INIT retries on the selected adapter', () => {
  const envSnapshot = snapshotEnv();
  try {
    configureDockerPublicMedia();
    assert.equal(shouldUseSamsarExternalVideoProvider({
      model: 'COSMOS3SUPERI2V',
      status: 'INIT',
      dockerVideoProvider: 'fal',
    }), false);
    assert.equal(shouldUseSamsarExternalVideoProvider({
      model: 'COSMOS3SUPERI2V',
      status: 'INIT',
      dockerVideoProvider: 'samsar',
    }), true);
  } finally {
    restoreEnv(envSnapshot);
  }
});

test('Seedance 2.5 external requests stay on the internal Fal adapter path', () => {
  const envSnapshot = snapshotEnv();
  try {
    configureDockerPublicMedia();
    process.env.SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED = 'true';
    process.env.FAL_API_KEY = 'fal-test-key';
    process.env.SAMSAR_API_KEY = 'samsar-test-key';

    assert.equal(
      resolveDockerVideoProvider('SEEDANCE2.5I2V'),
      'fal',
    );
    assert.equal(
      shouldUseSamsarExternalVideoProvider({
        model: 'SEEDANCE2.5I2V',
        status: 'INIT',
      }),
      false,
    );
  } finally {
    restoreEnv(envSnapshot);
  }
});

test('Samsar external image-to-video payload includes start image URL compatibility aliases', () => {
  const startImageUrl = 'https://media.example.com/assets_v2/session/start.png';
  const input = buildExternalImageToVideoInput({
    _id: 'local-generation-id',
    numRetries: 1,
    prompt: 'camera pan',
    originalVideoModel: 'MODEL_A',
    aspectRatio: '9:16',
    duration: 6,
  }, startImageUrl);

  assert.equal(input.image_url, startImageUrl);
  assert.deepEqual(input.image_urls, [startImageUrl]);
  assert.equal(input.start_image_url, startImageUrl);
  assert.equal(input.startImage, startImageUrl);
  assert.equal(input.video_model, 'MODEL_A');
  assert.equal(input.client_request_id, 'local-generation-id:attempt:1');
  assert.equal(input.metadata.local_attempt_number, 1);
  assert.equal(Object.hasOwn(input, 'image_model'), false);
  assert.equal(Object.hasOwn(input, 'requires_enhancement'), false);
  assert.equal(getExternalVideoAttemptId({
    _id: 'local-generation-id',
    numRetries: 1,
  }), 'local-generation-id:attempt:1');
});

test('Samsar external step image-to-video payload includes start image URL compatibility aliases', () => {
  const startImageUrl = 'https://media.example.com/assets_v2/session/start.png';
  const input = buildExternalStepImageToVideoInput({ model: 'MODEL_B' }, startImageUrl);

  assert.equal(input.image_url, startImageUrl);
  assert.deepEqual(input.image_urls, [startImageUrl]);
  assert.equal(input.start_image_url, startImageUrl);
  assert.equal(input.startImage, startImageUrl);
  assert.equal(input.video_model, 'MODEL_B');
  assert.equal(input.auto_render_full_video, true);
});

test('Samsar external route detection treats start image aliases as image-to-video', () => {
  for (const key of ['start_image_url', 'startImageUrl', 'start_image', 'startImage']) {
    assert.equal(
      getStartImageReference({ [key]: 'https://media.example.com/start.png' }),
      'https://media.example.com/start.png',
      key,
    );
    assert.equal(resolveExternalVideoRoute({ [key]: 'https://media.example.com/start.png' }), 'direct_image_to_video', key);
  }
});

test('Samsar external route detection prefers image-to-video when a stale text route has a start image', () => {
  assert.equal(
    resolveExternalVideoRoute({
      samsarExternalVideoRoute: 'text_to_video',
      startImage: 'https://media.example.com/start.png',
    }),
    'direct_image_to_video',
  );
});

test('legacy configured image-to-video route is forced through the direct provider path', () => {
  assert.equal(
    resolveExternalVideoRoute({
      samsarExternalVideoRoute: 'image_to_video',
      startImage: 'https://media.example.com/start.png',
    }),
    'direct_image_to_video',
  );
});

test('Samsar external route detection treats lip-sync model video/audio payloads as lip sync', () => {
  assert.equal(
    resolveExternalVideoRoute({
      model: 'SYNCLIPSYNC',
      videoLink: 'https://media.example.com/source.mp4',
      audioLink: 'https://media.example.com/speech.mp3',
    }),
    'lip_sync',
  );
});

test('Samsar external route detection overrides stale text route for lip-sync video/audio payloads', () => {
  assert.equal(
    resolveExternalVideoRoute({
      samsarExternalVideoRoute: 'text_to_video',
      model: 'SYNCLIPSYNC',
      videoLink: 'https://media.example.com/source.mp4',
      audioLink: 'https://media.example.com/speech.mp3',
    }),
    'lip_sync',
  );
});

test('Samsar external route detection treats source-video-only payloads as sound effect', () => {
  assert.equal(
    resolveExternalVideoRoute({
      model: 'MIRELOAI',
      videoLink: 'https://media.example.com/source.mp4',
    }),
    'sound_effect',
  );
});

test('Samsar external lip sync payload resolves Docker video and audio URLs to the media tunnel', async () => {
  const envSnapshot = snapshotEnv();
  configureDockerPublicMedia();

  try {
    const input = await buildExternalVideoToVideoInput({
      videoLink: 'http://localhost:3002/assets_v2/ai_video/generations/64b000000000000000000001/64b000000000000000000002/video.mp4',
      audioLink: 'http://localhost:3002/assets_v2/temp_audio/64b000000000000000000001_64b000000000000000000002_speech_padded.mp3',
      model: 'SYNCLIPSYNC',
      aspectRatio: '9:16',
      duration: 6,
    }, 'lip_sync');

    assert.equal(
      input.video_url,
      'https://media-tunnel.trycloudflare.com/assets_v2/ai_video/generations/64b000000000000000000001/64b000000000000000000002/video.mp4'
    );
    assert.equal(
      input.audio_url,
      'https://media-tunnel.trycloudflare.com/assets_v2/temp_audio/64b000000000000000000001_64b000000000000000000002_speech_padded.mp3'
    );
    assert.equal(input.lip_sync_model, 'SYNCLIPSYNC');
    assert.equal(input.duration, 6);
    assert.equal(input.audio_duration, 6);
  } finally {
    restoreEnv(envSnapshot);
  }
});

test('Samsar external lip sync payload preserves express audioDuration when duration is absent', async () => {
  const envSnapshot = snapshotEnv();
  configureDockerPublicMedia();

  try {
    const input = await buildExternalVideoToVideoInput({
      videoLink: 'http://localhost:3002/assets_v2/ai_video/generations/64b000000000000000000001/64b000000000000000000002/video.mp4',
      audioLink: 'http://localhost:3002/assets_v2/temp_audio/64b000000000000000000001_64b000000000000000000002_speech_padded.mp3',
      model: 'SYNCLIPSYNC',
      aspectRatio: '9:16',
      audioDuration: 7.875,
      retryOnFail: false,
    }, 'lip_sync');

    assert.equal(input.duration, 8);
    assert.equal(input.audio_duration, 8);
    assert.equal(input.lip_sync_model, 'SYNCLIPSYNC');
  } finally {
    restoreEnv(envSnapshot);
  }
});

test('Samsar external sound-effect payload resolves Docker source video URLs to the media tunnel', async () => {
  const envSnapshot = snapshotEnv();
  configureDockerPublicMedia();

  try {
    const input = await buildExternalVideoToVideoInput({
      videoLink: 'assets_v2/ai_video/generations/64b000000000000000000001/64b000000000000000000002/video.mp4',
      model: 'MIRELOAI',
    }, 'sound_effect');

    assert.equal(
      input.video_url,
      'https://media-tunnel.trycloudflare.com/assets_v2/ai_video/generations/64b000000000000000000001/64b000000000000000000002/video.mp4'
    );
    assert.equal(input.sound_effect_model, 'MIRELOAI');
    assert.equal(Object.hasOwn(input, 'audio_url'), false);
  } finally {
    restoreEnv(envSnapshot);
  }
});
