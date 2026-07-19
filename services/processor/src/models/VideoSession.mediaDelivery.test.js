import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { __testOnly__ } from './VideoSession.js';

const staleFinalVideoUrl = 'https://static.samsar.one/assets_v2/video/output/session_123/final.mp4?Expires=1&Signature=old&Key-Pair-Id=old';
const staleThumbnailUrl = 'https://static.samsar.one/assets_v2/generations/session_123/thumb.png?Expires=1&Signature=old&Key-Pair-Id=old';
const staleAudioUrl = 'https://static.samsar.one/assets_v2/user_resources/user_123/audio/session_123.mp3?Expires=1&Signature=old&Key-Pair-Id=old';

test('owner session media hydration refreshes final video, thumbnails, image assets, video assets, and audio assets', () => {
  const hydrated = __testOnly__.hydrateStudioSessionMediaForResponse({
    _id: 'session_123',
    videoLink: staleFinalVideoUrl,
    remoteURL: staleFinalVideoUrl,
    splashImage: staleThumbnailUrl,
    layers: [{
      aiVideoLayer: staleFinalVideoUrl,
      aiVideoRemoteLink: staleFinalVideoUrl,
      aiLayerStartFrame: staleThumbnailUrl,
      imageSession: {
        activeGeneratedImage: staleThumbnailUrl,
        activeItemList: [{
          id: 'base',
          type: 'image',
          src: staleThumbnailUrl,
          image: staleThumbnailUrl,
        }],
      },
    }],
    generations: [{
      src: staleThumbnailUrl,
      url: staleThumbnailUrl,
    }],
    audioLayers: [{
      selectedRemoteAudioLink: staleAudioUrl,
      remoteAudioLinks: [staleAudioUrl],
      remoteAudioData: [{ audio_url: staleAudioUrl }],
    }],
  });

  for (const value of [
    hydrated.videoLink,
    hydrated.remoteURL,
    hydrated.splashImage,
    hydrated.layers[0].aiVideoLayer,
    hydrated.layers[0].aiVideoRemoteLink,
    hydrated.layers[0].aiLayerStartFrame,
    hydrated.layers[0].imageSession.activeGeneratedImage,
    hydrated.layers[0].imageSession.activeItemList[0].url,
    hydrated.generations[0].url,
    hydrated.audioLayers[0].selectedRemoteAudioLink,
    hydrated.audioLayers[0].remoteAudioLinks[0],
    hydrated.audioLayers[0].remoteAudioData[0].audio_url,
  ]) {
    assert.equal(value.includes('Signature=old'), false);
    assert.equal(value.includes('Expires=1'), false);
  }

  assert.match(hydrated.videoLink, /^https:\/\/[^/]+\/assets_v2\/video\/output\/session_123\/final\.mp4/);
  assert.match(hydrated.splashImage, /^https:\/\/[^/]+\/assets_v2\/generations\/session_123\/thumb\.png/);
  assert.equal(hydrated.layers[0].imageSession.activeItemList[0].src, 'assets_v2/generations/session_123/thumb.png');
});

test('studio media hydration preserves unrelated external URLs', () => {
  const hydrated = __testOnly__.hydrateStudioSessionMediaForResponse({
    videoLink: 'https://cdn.example.com/final.mp4',
    layers: [{
      aiVideoRemoteLink: 'https://cdn.example.com/scene.mp4',
      imageSession: {
        activeGeneratedImage: 'https://cdn.example.com/scene.png',
      },
    }],
  });

  assert.equal(hydrated.videoLink, 'https://cdn.example.com/final.mp4');
  assert.equal(hydrated.layers[0].aiVideoRemoteLink, 'https://cdn.example.com/scene.mp4');
  assert.equal(hydrated.layers[0].imageSession.activeGeneratedImage, 'https://cdn.example.com/scene.png');
});

test('studio media hydration serves locally finalized user videos from assets_v2', (t) => {
  const relativePath = path.join(
    'assets_v2',
    'ai_video',
    'generations',
    `media_delivery_${process.pid}_${Date.now()}`,
    'layer_123',
    'user_video_test.mp4',
  );
  const absolutePath = path.resolve(relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, 'test-video');
  t.after(() => fs.rmSync(path.join(process.cwd(), 'assets_v2', 'ai_video', 'generations', path.basename(path.dirname(path.dirname(absolutePath)))), {
    recursive: true,
    force: true,
  }));

  const staleSignedUrl = `https://static.samsar.one/${relativePath.replaceAll(path.sep, '/')}?Expires=1&Signature=old&Key-Pair-Id=old`;
  const hydrated = __testOnly__.hydrateStudioSessionMediaForResponse({
    layers: [{
      userVideoLayer: `/${relativePath.replaceAll(path.sep, '/')}`,
      userVideoRemoteLink: staleSignedUrl,
    }],
  });

  const expectedPathname = `/${relativePath.replaceAll(path.sep, '/')}`;
  for (const value of [
    hydrated.layers[0].userVideoLayer,
    hydrated.layers[0].userVideoRemoteLink,
  ]) {
    const resolvedUrl = new URL(value, 'https://processor.example.com');
    assert.equal(resolvedUrl.pathname, expectedPathname);
    assert.equal(resolvedUrl.search, '');
    assert.notEqual(resolvedUrl.hostname, 'static.samsar.one');
  }
});

test('studio media hydration resolves legacy generated images from durable temp_images keys', () => {
  const hydrated = __testOnly__.hydrateStudioSessionMediaForResponse({
    aspectRatio: '16:9',
    layers: [{
      _id: 'layer_legacy',
      imageSession: {
        activeSelectedImage: '/generations/generation_123.png',
        activeItemList: [],
      },
    }],
  });

  const imageSession = hydrated.layers[0].imageSession;
  assert.equal(new URL(imageSession.activeSelectedImage).pathname, '/temp_images/generation_123.png');
  assert.equal(imageSession.activeItemList.length, 1);
  assert.equal(
    new URL(imageSession.activeItemList[0].previewUrl).pathname,
    '/temp_images/generation_123.png',
  );
});

test('studio media hydration strips stale signatures from legacy public CDN image keys', () => {
  const staleLegacyImageUrl = 'https://static.samsar.one/temp_images/generation_123.png?Expires=1&Signature=old&Key-Pair-Id=old';
  const hydrated = __testOnly__.hydrateStudioSessionMediaForResponse({
    layers: [{
      imageSession: {
        activeItemList: [{
          id: 'base',
          type: 'image',
          src: staleLegacyImageUrl,
          is_base_image: true,
        }],
      },
    }],
  });

  const previewUrl = new URL(hydrated.layers[0].imageSession.activeItemList[0].previewUrl);
  assert.equal(previewUrl.pathname, '/temp_images/generation_123.png');
  assert.equal(previewUrl.search, '');
});

test('studio media hydration recovers legacy ai video URLs from generated video records', () => {
  const generatedAiVideoByLayerId = new Map([[
    'layer_legacy',
    {
      layerId: 'layer_legacy',
      remoteUrl: 'user_resources/user_123/ai_videos/session_123/layer_legacy/scene.mp4',
    },
  ]]);
  const hydrated = __testOnly__.hydrateStudioSessionMediaForResponse({
    layers: [{
      _id: 'layer_legacy',
      aiVideoLayer: '/ai_video/generations/session_123/layer_legacy/scene.mp4',
      aiVideoRemoteLink: '',
    }],
  }, { generatedAiVideoByLayerId });

  const expectedPath = '/user_resources/user_123/ai_videos/session_123/layer_legacy/scene.mp4';
  assert.equal(new URL(hydrated.layers[0].aiVideoLayer).pathname, expectedPath);
  assert.equal(new URL(hydrated.layers[0].aiVideoRemoteLink).pathname, expectedPath);
});

test('session list thumbnails prefer durable selected images over transient boundary frames', () => {
  const selectedImage = '/assets_v2/generations/session_123/selected.png';
  const missingBoundaryFrame = '/assets_v2/generations/session_123/transient-frame.png';
  const payload = __testOnly__.buildSessionListThumbnailPayload({
    aspectRatio: '16:9',
    layers: [{
      durationOffset: 0,
      aiLayerStartFrame: missingBoundaryFrame,
      imageSession: {
        activeSelectedImage: selectedImage,
        activeItemList: [{
          id: 'base',
          type: 'image',
          src: selectedImage,
          is_base_image: true,
        }],
      },
    }],
  }, 'session_123');

  assert.equal(payload.thumbnail, selectedImage);
  assert.equal(new URL(payload.thumbnailUrl).pathname, selectedImage);
  assert.equal(new URL(payload.thumbnailUrls[1]).pathname, missingBoundaryFrame);
});
