import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeSelectedVideoGenerationMediaPayload } from './VideoGenerationMediaPayload.js';

test('normalizes only the selected image-to-video inputs', async () => {
  const calls = [];
  const payload = await normalizeSelectedVideoGenerationMediaPayload({
    model: 'WANI2V',
    startImage: '/assets_v2/generations/start.png',
    endImage: '/assets_v2/generations/unused-end.png',
    videoLink: '/assets_v2/video/unused.mp4',
    audioLink: '/assets_v2/audio/unused.mp3',
  }, async (value, options) => {
    calls.push([value, options.mediaKind]);
    return `https://fresh.example/${options.mediaKind}`;
  });

  assert.deepEqual(calls, [['/assets_v2/generations/start.png', 'image']]);
  assert.equal(payload.startImage, 'https://fresh.example/image');
  assert.equal(payload.endImage, '/assets_v2/generations/unused-end.png');
  assert.equal(payload.videoLink, '/assets_v2/video/unused.mp4');
  assert.equal(payload.audioLink, '/assets_v2/audio/unused.mp3');
});

test('normalizes both selected first/last frame inputs', async () => {
  const calls = [];
  await normalizeSelectedVideoGenerationMediaPayload({
    model: 'VEO3.1FLIV',
    startImage: '/assets_v2/generations/start.png',
    endImage: '/assets_v2/generations/end.png',
    fallbackImage: '/assets_v2/generations/unused.png',
  }, async (value, { mediaKind }) => {
    calls.push([value, mediaKind]);
    return value;
  });

  assert.deepEqual(calls, [
    ['/assets_v2/generations/start.png', 'image'],
    ['/assets_v2/generations/end.png', 'image'],
  ]);
});

test('normalizes video/audio for lip sync, video only for sound effects, and none for text-to-video', async () => {
  const calls = [];
  const normalize = async (value, { mediaKind }) => {
    calls.push([value, mediaKind]);
    return value;
  };

  await normalizeSelectedVideoGenerationMediaPayload({
    model: 'LATENTSYNC',
    videoLink: '/assets_v2/video/source.mp4',
    audioLink: '/assets_v2/audio/source.mp3',
    startImage: '/assets_v2/generations/unused.png',
  }, normalize);
  await normalizeSelectedVideoGenerationMediaPayload({
    model: 'MMAUDIOV2',
    videoLink: '/assets_v2/video/source-2.mp4',
    audioLink: '/assets_v2/audio/unused.mp3',
  }, normalize);
  await normalizeSelectedVideoGenerationMediaPayload({
    model: 'VEO',
    startImage: '/assets_v2/generations/unused-2.png',
  }, normalize);

  assert.deepEqual(calls, [
    ['/assets_v2/video/source.mp4', 'video'],
    ['/assets_v2/audio/source.mp3', 'audio'],
    ['/assets_v2/video/source-2.mp4', 'video'],
  ]);
});

test('media normalization errors identify the exact provider field that failed', async () => {
  await assert.rejects(
    () => normalizeSelectedVideoGenerationMediaPayload({
      model: 'SYNCLIPSYNC',
      videoLink: '/assets_v2/video/source.mp4',
      audioLink: '/assets_v2/audio/missing.wav',
    }, async (value, { mediaKind }) => {
      if (mediaKind === 'audio') {
        throw new Error('CDN cache prime returned status 403');
      }
      return value;
    }),
    (error) => (
      error?.mediaKind === 'audio'
      && error?.mediaField === 'audioLink'
      && /provider audio field audioLink/.test(error.message)
    ),
  );
});
