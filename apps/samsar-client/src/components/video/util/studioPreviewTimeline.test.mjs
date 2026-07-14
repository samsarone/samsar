import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findLayerIndexAtDisplayFrame,
  getLayerDisplayFrameRange,
  resolveTimelineDuration,
} from './studioPreviewTimeline.mjs';

const layers = [
  { _id: 'scene-1', durationOffset: 0, duration: 2 },
  { _id: 'scene-2', durationOffset: 2, duration: 3 },
  { _id: 'scene-3', durationOffset: 5, duration: 1 },
];

test('selects the exact scene after a delayed playback frame jump', () => {
  assert.equal(findLayerIndexAtDisplayFrame(layers, 5.5 * 30), 2);
});

test('switches scenes on the exact end-frame boundary', () => {
  assert.equal(getLayerDisplayFrameRange(layers[0]).endFrame, 60);
  assert.equal(findLayerIndexAtDisplayFrame(layers, 60), 1);
});

test('uses the latest offset end for an offset-based timeline', () => {
  assert.equal(resolveTimelineDuration(layers), 6);
});

test('falls back to summed duration for legacy layers without offsets', () => {
  const legacyLayers = [
    { duration: 2 },
    { duration: 3 },
  ];
  assert.equal(resolveTimelineDuration(legacyLayers), 5);
  assert.equal(findLayerIndexAtDisplayFrame(legacyLayers, 2.5 * 30), 1);
});

test('prefers an explicit session timeline duration', () => {
  assert.equal(resolveTimelineDuration(layers, { totalDuration: 7.25 }), 7.25);
});
