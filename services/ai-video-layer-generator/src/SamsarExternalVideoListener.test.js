import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildExternalImageToVideoInput,
  buildExternalStepImageToVideoInput,
  getStartImageReference,
  resolveExternalVideoRoute,
} from './base/SamsarExternalVideoListener.js';

test('Samsar external image-to-video payload includes start image URL compatibility aliases', () => {
  const startImageUrl = 'https://media.example.com/assets_v2/session/start.png';
  const input = buildExternalImageToVideoInput({
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
    assert.equal(resolveExternalVideoRoute({ [key]: 'https://media.example.com/start.png' }), 'image_to_video', key);
  }
});

test('Samsar external route detection prefers image-to-video when a stale text route has a start image', () => {
  assert.equal(
    resolveExternalVideoRoute({
      samsarExternalVideoRoute: 'text_to_video',
      startImage: 'https://media.example.com/start.png',
    }),
    'image_to_video',
  );
});
