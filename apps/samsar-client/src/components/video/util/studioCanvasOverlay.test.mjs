import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isBlankStudioCanvas,
  resolveBlankCanvasOverlayMaxHeight,
  resolveStudioCanvasLayerKey,
  shouldRestoreBlankCanvasOverlay,
  shouldShowBlankCanvasOverlay,
} from './studioCanvasOverlay.mjs';

test('a studio canvas is blank only when it has neither canvas items nor video', () => {
  assert.equal(isBlankStudioCanvas([], ''), true);
  assert.equal(isBlankStudioCanvas(undefined, null), true);
  assert.equal(isBlankStudioCanvas([{ id: 'image-1', type: 'image' }], ''), false);
  assert.equal(isBlankStudioCanvas([], 'https://media.example/video.mp4'), false);
});

test('blank canvas overlay identity follows the selected layer', () => {
  assert.equal(resolveStudioCanvasLayerKey({ _id: 'layer-a', durationOffset: 0 }), 'layer:layer-a');
  assert.equal(resolveStudioCanvasLayerKey({ durationOffset: 2 }), 'offset:2');
  assert.equal(resolveStudioCanvasLayerKey(null, 'session-a'), 'fallback:session-a');
});

test('dismissal remains effective on the same blank layer', () => {
  assert.equal(shouldRestoreBlankCanvasOverlay({
    isCanvasBlank: true,
    wasCanvasBlank: true,
    layerKey: 'layer:a',
    previousLayerKey: 'layer:a',
  }), false);
});

test('a different blank layer or a newly emptied layer restores the overlay', () => {
  assert.equal(shouldRestoreBlankCanvasOverlay({
    isCanvasBlank: true,
    wasCanvasBlank: true,
    layerKey: 'layer:b',
    previousLayerKey: 'layer:a',
  }), true);
  assert.equal(shouldRestoreBlankCanvasOverlay({
    isCanvasBlank: true,
    wasCanvasBlank: false,
    layerKey: 'layer:a',
    previousLayerKey: 'layer:a',
  }), true);
});

test('blank canvas visibility depends on canvas state, not right-panel layout', () => {
  assert.equal(shouldShowBlankCanvasOverlay({
    isCanvasBlank: true,
    isEditImageView: false,
    isOverlayOpen: true,
  }), true);
  assert.equal(shouldShowBlankCanvasOverlay({
    isCanvasBlank: true,
    isEditImageView: true,
    isOverlayOpen: true,
  }), false);
  assert.equal(shouldShowBlankCanvasOverlay({
    isCanvasBlank: true,
    isEditImageView: false,
    isOverlayOpen: false,
  }), false);
});

test('blank overlay height follows the visible Studio scrollport', () => {
  assert.equal(resolveBlankCanvasOverlayMaxHeight({
    frameTop: 80,
    scrollportTop: 56,
    scrollportBottom: 587,
  }), 495);
  assert.equal(resolveBlankCanvasOverlayMaxHeight({
    frameTop: 20,
    scrollportTop: 56,
    scrollportBottom: 587,
  }), 507);
});

test('blank overlay height rejects incomplete geometry', () => {
  assert.equal(resolveBlankCanvasOverlayMaxHeight({
    frameTop: undefined,
    scrollportTop: 56,
    scrollportBottom: 587,
  }), null);
});
