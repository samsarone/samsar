import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildNormalizedVideoSessionPreview,
  normalizeResponseAssetUrl,
  resolveVideoHasFooter,
} from './StatusAPI.js';

const DOCKER_LOCAL_ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_MEDIA_DELIVERY_MODE',
  'MEDIA_DELIVERY_MODE',
  'SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED',
  'EXTERNAL_MEDIA_PUBLISH_ENABLED',
  'STATIC_CDN_URL',
  'SAMSAR_DOCKER_PUBLIC_ASSET_BASE_URL',
  'SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL',
  'SAMSAR_DOCKER_LOCAL_MEDIA_BASE_URL',
  'SAMSAR_LOCAL_MEDIA_BASE_URL',
  'API_SERVER',
  'PUBLIC_API_BASE_URL',
  'PROCESSOR_API',
  'PROCESSOR_URL',
];

function withDockerLocalMediaEnv(callback) {
  const envSnapshot = Object.fromEntries(DOCKER_LOCAL_ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_MEDIA_DELIVERY_MODE = 'docker-local';
  process.env.STATIC_CDN_URL = 'http://localhost:8080/';
  delete process.env.SAMSAR_DOCKER_PUBLIC_ASSET_BASE_URL;
  delete process.env.SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL;
  delete process.env.SAMSAR_DOCKER_LOCAL_MEDIA_BASE_URL;
  delete process.env.SAMSAR_LOCAL_MEDIA_BASE_URL;
  delete process.env.API_SERVER;
  delete process.env.PUBLIC_API_BASE_URL;
  delete process.env.PROCESSOR_API;
  delete process.env.PROCESSOR_URL;
  delete process.env.MEDIA_DELIVERY_MODE;
  delete process.env.SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED;
  delete process.env.EXTERNAL_MEDIA_PUBLISH_ENABLED;

  try {
    callback();
  } finally {
    for (const key of DOCKER_LOCAL_ENV_KEYS) {
      if (envSnapshot[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = envSnapshot[key];
      }
    }
  }
}

test('resolveVideoHasFooter reports true for active top-level footer metadata', () => {
  assert.equal(resolveVideoHasFooter({
    addFooterAnimation: true,
    footerMetadata: [{ url: 'https://example.com', title: 'Learn more' }],
  }), true);
});

test('resolveVideoHasFooter reports true for footer logo rerenders', () => {
  assert.equal(resolveVideoHasFooter({
    addFooterAnimation: true,
    footerMetadata: [],
    footerLogoImagePath: 'video/footer_logo/session/footer_logo.png',
  }), true);
});

test('resolveVideoHasFooter reports true for layer-scoped footer metadata', () => {
  assert.equal(resolveVideoHasFooter({
    addFooterAnimation: false,
    footerMetadata: [],
    layers: [
      { addFooterAnimation: false },
      {
        addFooterAnimation: true,
        footerMetadata: { url: 'https://example.com', title: 'Book now' },
      },
    ],
  }), true);
});

test('resolveVideoHasFooter reports false without an active footer flag', () => {
  assert.equal(resolveVideoHasFooter({
    addFooterAnimation: false,
    footerMetadata: [{ url: 'https://example.com', title: 'Stale metadata' }],
    layers: [
      {
        addFooterAnimation: false,
        footerMetadata: { url: 'https://example.com', title: 'Stale metadata' },
      },
    ],
  }), false);
});

test('resolveVideoHasFooter reports false for enabled footer without attached metadata', () => {
  assert.equal(resolveVideoHasFooter({
    addFooterAnimation: true,
    footerMetadata: [],
    layers: [{ addFooterAnimation: true, footerMetadata: null }],
  }), false);
});

test('buildNormalizedVideoSessionPreview returns minimal preview assets with normalized timing', () => {
  const preview = buildNormalizedVideoSessionPreview({
    _id: 'session_123',
    aspectRatio: '16:9',
    framesPerSecond: 24,
    subtitleLanguage: 'th',
    subtitleLanguageString: 'Thai',
    subtitleLanguageExplicit: true,
    subtitleTranslationRequired: true,
    expressGenerationStatus: {
      prompt_generation: 'COMPLETED',
      image_generation: 'COMPLETED',
      speech_generation: 'COMPLETED',
      music_generation: 'COMPLETED',
      audio_generation: 'COMPLETED',
      ai_video_generation: 'COMPLETED',
      lip_sync_generation: 'INIT',
      frame_generation: 'INIT',
      video_generation: 'INIT',
    },
    layers: [
      {
        _id: 'layer_1',
        prompt: 'Opening scene',
        durationOffset: 4,
        duration: 6,
        imageSession: {
          generationStatus: 'COMPLETED',
          activeItemList: [
            {
              id: 'base',
              type: 'image',
              src: 'https://cdn.example.com/scene-1.png',
              is_base_image: true,
            },
          ],
        },
        aiVideoGenerationStatus: 'COMPLETED',
        aiVideoRemoteLink: 'https://cdn.example.com/scene-1.mp4',
      },
    ],
    audioLayers: [
      {
        _id: 'speech_1',
        generationType: 'speech',
        generationStatus: 'COMPLETED',
        startTime: 4,
        endTime: 10,
        duration: 6,
        prompt: 'Narration line',
        subtitleText: 'ข้อความบรรยาย',
        subtitleLanguage: 'th',
        speechLanguage: 'en',
        subtitleTranslationRequired: true,
        addTranscriptionsRequired: false,
        selectedRemoteAudioLink: 'https://cdn.example.com/speech-1.mp3',
      },
    ],
  }, {
    request_id: 'request_123',
    provider: 'VEO',
  });

  assert.equal(preview.currentStage, 'lip_sync_generation');
  assert.equal(preview.previewStage, 'ai_video_generation');
  assert.equal(preview.layers[0].startTime, 4);
  assert.equal(preview.layers[0].endTime, 10);
  assert.equal(preview.layers[0].image.url, 'https://cdn.example.com/scene-1.png');
  assert.equal(preview.layers[0].aiVideo.url, 'https://cdn.example.com/scene-1.mp4');
  assert.equal(preview.layers[0].preview.type, 'video');
  assert.equal(preview.audioLayers[0].url, 'https://cdn.example.com/speech-1.mp3');
  assert.equal(preview.subtitleLanguage, 'th');
  assert.equal(preview.subtitleLanguageExplicit, true);
  assert.equal(preview.subtitleTranslationRequired, true);
  assert.equal(preview.audioLayers[0].subtitleText, 'ข้อความบรรยาย');
  assert.equal(preview.audioLayers[0].speechLanguage, 'en');
  assert.equal(preview.audioLayers[0].subtitleTranslationRequired, true);
  assert.equal(preview.audioLayers[0].addTranscriptionsRequired, false);
  assert.equal(Object.prototype.hasOwnProperty.call(preview.layers[0], 'durationOffset'), false);
});

test('normalizeResponseAssetUrl returns Docker-local public processor URLs for secure assets', () => {
  withDockerLocalMediaEnv(() => {
    assert.equal(
      normalizeResponseAssetUrl('assets_v2/video/output/session-1/final.mp4'),
      'http://localhost:3002/assets_v2/video/output/session-1/final.mp4',
    );
    assert.equal(
      normalizeResponseAssetUrl('https://static.samsar.one/assets_v2/video/output/session-1/final.mp4?Expires=old'),
      'http://localhost:3002/assets_v2/video/output/session-1/final.mp4',
    );
    assert.equal(
      normalizeResponseAssetUrl('user_resources/user-1/audio/speech.mp3'),
      'http://localhost:3002/assets_v2/user_resources/user-1/audio/speech.mp3',
    );
    process.env.PROCESSOR_API = 'http://localhost:3999/';
    assert.equal(
      normalizeResponseAssetUrl('assets_v2/video/output/session-1/final-override.mp4'),
      'http://localhost:3999/assets_v2/video/output/session-1/final-override.mp4',
    );
  });
});

test('buildNormalizedVideoSessionPreview keeps signed asset urls out of persistent image item references', () => {
  const signedImageUrl = 'https://static.samsar.one/assets_v2/generations/session_123/scene.png?Expires=123&Signature=oldsig&Key-Pair-Id=KOLD';
  const preview = buildNormalizedVideoSessionPreview({
    _id: 'session_123',
    expressGenerationStatus: {
      image_generation: 'COMPLETED',
    },
    layers: [
      {
        _id: 'layer_1',
        imageSession: {
          generationStatus: 'COMPLETED',
          activeItemList: [
            {
              id: 'base',
              type: 'image',
              src: signedImageUrl,
              image: signedImageUrl,
              is_base_image: true,
            },
          ],
        },
      },
    ],
  }, { request_id: 'request_123' });

  const item = preview.layers[0].image.items[0];
  assert.equal(item.rawUrl, 'assets_v2/generations/session_123/scene.png');
  assert.equal(item.src, 'assets_v2/generations/session_123/scene.png');
  assert.equal(item.image, 'assets_v2/generations/session_123/scene.png');
  assert.ok(item.url.startsWith('https://static.samsar.one/assets_v2/generations/session_123/scene.png'));
  assert.equal(item.url.includes('Signature=oldsig'), false);
});

test('buildNormalizedVideoSessionPreview refreshes stale signed ai video urls', () => {
  const staleSignedVideoUrl = 'https://static.samsar.one/assets_v2/user_resources/user_1/ai_videos/session_123/layer_1/scene.mp4?Expires=123&Signature=oldsig&Key-Pair-Id=KOLD';
  const preview = buildNormalizedVideoSessionPreview({
    _id: 'session_123',
    expressGenerationStatus: {
      image_generation: 'COMPLETED',
      ai_video_generation: 'COMPLETED',
    },
    layers: [
      {
        _id: 'layer_1',
        duration: 5,
        imageSession: {
          generationStatus: 'COMPLETED',
          activeItemList: [
            {
              id: 'base',
              type: 'image',
              src: 'assets_v2/generations/session_123/scene.png',
              is_base_image: true,
            },
          ],
        },
        aiVideoGenerationStatus: 'COMPLETED',
        aiVideoRemoteLink: staleSignedVideoUrl,
        aiVideoLayer: 'assets_v2/ai_video/generations/session_123/layer_1/scene.mp4',
      },
    ],
  }, { request_id: 'request_123' });

  assert.ok(
    preview.layers[0].aiVideo.url.startsWith('https://static.samsar.one/assets_v2/user_resources/user_1/ai_videos/session_123/layer_1/scene.mp4'),
  );
  assert.equal(preview.layers[0].aiVideo.url.includes('Signature=oldsig'), false);
  assert.equal(preview.layers[0].preview.type, 'video');
});

test('buildNormalizedVideoSessionPreview refreshes stale signed cloudfront ai video urls', () => {
  const staleSignedVideoUrl = 'https://dgyheyjs5bch6.cloudfront.net/assets_v2/user_resources/user_1/ai_videos/session_123/layer_1/scene.mp4?Expires=123&Signature=oldsig&Key-Pair-Id=KOLD';
  const preview = buildNormalizedVideoSessionPreview({
    _id: 'session_123',
    expressGenerationStatus: {
      ai_video_generation: 'COMPLETED',
    },
    layers: [
      {
        _id: 'layer_1',
        aiVideoGenerationStatus: 'COMPLETED',
        aiVideoRemoteLink: staleSignedVideoUrl,
      },
    ],
  }, { request_id: 'request_123' });

  assert.ok(
    preview.layers[0].aiVideo.url.startsWith('https://static.samsar.one/assets_v2/user_resources/user_1/ai_videos/session_123/layer_1/scene.mp4'),
  );
  assert.equal(preview.layers[0].aiVideo.url.includes('Signature=oldsig'), false);
});

test('buildNormalizedVideoSessionPreview exposes editedImage for image-to-video detailed status', () => {
  const preview = buildNormalizedVideoSessionPreview({
    _id: 'session_123',
    isStepVideoGeneration: true,
    expressStepGeneration: {
      routeType: 'image_to_video',
    },
    expressGenerationStatus: {
      image_generation: 'COMPLETED',
      ai_video_generation: 'PENDING',
    },
    layers: [
      {
        _id: 'layer_1',
        imageSession: {
          generationStatus: 'COMPLETED',
          editStatus: 'COMPLETED',
          activeEditedImage: '/assets_v2/generations/session_123/edited.png',
          activeItemList: [
            {
              id: 'base',
              type: 'image',
              src: 'assets_v2/generations/session_123/base.png',
              is_base_image: true,
            },
          ],
        },
      },
    ],
  }, { request_id: 'request_123' });

  assert.equal(
    preview.layers[0].image.editedImage.startsWith('https://static.samsar.one/assets_v2/generations/session_123/edited.png'),
    true,
  );
  assert.equal(preview.layers[0].image.editedImageRawUrl, 'assets_v2/generations/session_123/edited.png');
  assert.equal(preview.layers[0].editedImage.rawUrl, 'assets_v2/generations/session_123/edited.png');
});
