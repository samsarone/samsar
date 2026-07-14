import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getSubtitleEndFrameExclusive,
  isItemActiveAtFrame,
} from './FrameTimingUtils.js';

test('listener-style mapped subtitle duration uses compatible timed-word end', () => {
  const item = {
    type: 'text',
    subType: 'subtitle',
    config: { frameOffset: 0, frameDuration: 11 },
    words: [{ word: 'HELLO', frameOffset: 0, frameDuration: 12 }],
  };

  assert.equal(getSubtitleEndFrameExclusive(item), 12);
  assert.equal(isItemActiveAtFrame(item, 0), true);
  assert.equal(isItemActiveAtFrame(item, 11), true);
  assert.equal(isItemActiveAtFrame(item, 12), false);
});

test('listener-style item-relative word timing extends a nonzero subtitle offset', () => {
  const item = {
    type: 'text',
    subType: 'subtitle',
    config: { frameOffset: 24, frameDuration: 11 },
    words: [{ word: 'HELLO', frameOffset: 0, frameDuration: 12 }],
  };

  assert.equal(getSubtitleEndFrameExclusive(item), 36);
  assert.equal(isItemActiveAtFrame(item, 35), true);
  assert.equal(isItemActiveAtFrame(item, 36), false);
});

test('session-global listener timings are normalized by the layer offset', () => {
  const item = {
    type: 'text',
    subType: 'subtitle',
    config: { frameOffset: 0, frameDuration: 11 },
    words: [{ word: 'HELLO', frameOffset: 120, frameDuration: 12 }],
  };
  const timingContext = { durationOffsetFrames: 120 };

  assert.equal(getSubtitleEndFrameExclusive(item, timingContext), 12);
  assert.equal(isItemActiveAtFrame(item, 11, timingContext), true);
  assert.equal(isItemActiveAtFrame(item, 12, timingContext), false);
});

test('conventional subtitle ranges are half-open at adjacent boundaries', () => {
  const firstItem = {
    type: 'text',
    subType: 'subtitle',
    config: { frameOffset: 0, frameDuration: 12 },
    words: [],
  };
  const secondItem = {
    type: 'text',
    subType: 'subtitle',
    config: { frameOffset: 12, frameDuration: 12 },
    words: [],
  };

  assert.equal(isItemActiveAtFrame(firstItem, 11), true);
  assert.equal(isItemActiveAtFrame(firstItem, 12), false);
  assert.equal(isItemActiveAtFrame(secondItem, 12), true);
});

test('non-subtitle items retain their inclusive legacy end boundary', () => {
  const item = {
    type: 'image',
    config: { frameOffset: 5, frameDuration: 10 },
  };

  assert.equal(isItemActiveAtFrame(item, 15), true);
  assert.equal(isItemActiveAtFrame(item, 16), false);
});

test('incompatible word time-bases do not extend a subtitle item range', () => {
  const item = {
    type: 'text',
    subType: 'subtitle',
    config: { frameOffset: 0, frameDuration: 12 },
    words: [{ word: 'GLOBAL', frameOffset: 100, frameDuration: 8 }],
  };

  assert.equal(getSubtitleEndFrameExclusive(item), 12);
  assert.equal(isItemActiveAtFrame(item, 12), false);
});

test('invalid negative item durations never become visible', () => {
  const item = {
    type: 'text',
    subType: 'subtitle',
    config: { frameOffset: 5, frameDuration: -1 },
  };

  assert.equal(getSubtitleEndFrameExclusive(item), null);
  assert.equal(isItemActiveAtFrame(item, 5), false);
});
