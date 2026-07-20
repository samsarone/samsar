import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldCarryGeneratedLastFrameToNextLayer } from './NextLayerFrameCarry.js';

test('normal studio end-frame generation does not rewrite the next layer', () => {
  assert.equal(shouldCarryGeneratedLastFrameToNextLayer({
    endImage: 'next-layer-start.png',
    combineLayers: false,
  }, {
    imageSession: { activeItemList: [{ type: 'image', src: 'next-layer-start.png' }] },
  }), false);
});

test('explicit combine-layers generation may carry the final frame into an image layer', () => {
  assert.equal(shouldCarryGeneratedLastFrameToNextLayer({
    endImage: 'next-layer-start.png',
    combineLayers: true,
  }, {
    imageSession: { activeItemList: [{ type: 'image', src: 'next-layer-start.png' }] },
  }), true);
});

test('generated final frames never replace an existing user-video visual', () => {
  assert.equal(shouldCarryGeneratedLastFrameToNextLayer({
    endImage: 'next-layer-start.png',
    combineLayers: true,
  }, {
    hasUserVideoLayer: true,
    userVideoLayer: '/assets_v2/user-video.mp4',
  }), false);
});

test('generated final frames do not race a pending user-video upload', () => {
  assert.equal(shouldCarryGeneratedLastFrameToNextLayer({
    endImage: 'next-layer-start.png',
    combineLayers: true,
  }, {
    userVideoGenerationPending: true,
  }), false);
});

test('generated final frames never replace any existing video-backed visual', () => {
  assert.equal(shouldCarryGeneratedLastFrameToNextLayer({
    endImage: 'next-layer-start.png',
    combineLayers: true,
  }, {
    hasAiVideoLayer: true,
    aiVideoLayer: '/assets_v2/generated-video.mp4',
  }), false);
});
