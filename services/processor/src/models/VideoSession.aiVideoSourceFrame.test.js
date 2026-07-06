import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeStudioAiVideoSourceFramePayload } from '../utils/StudioAiVideoSourceFrame.js';

const rawImageItem = {
  id: 'item_0',
  type: 'image',
  src: '/assets_v2/generations/session/generated.png',
  x: 80,
  y: 128,
  width: 864,
  height: 1536,
  sourceWidth: 864,
  sourceHeight: 1536,
  aiVideoSourceOriginal: true,
};

function layer(id, activeItemList, previousActiveItemList = []) {
  return {
    _id: {
      toString: () => id,
    },
    imageSession: {
      activeItemList,
      previousActiveItemList,
    },
  };
}

test('studio AI video generation uses raw generated image instead of combined canvas for single raw source', () => {
  const currentLayer = layer('layer_1', [rawImageItem]);
  const payload = {
    combineLayers: true,
    useStartFrame: true,
    useEndFrame: false,
  };

  const normalized = normalizeStudioAiVideoSourceFramePayload(
    payload,
    { layers: [currentLayer] },
    currentLayer
  );

  assert.equal(normalized.combineLayers, false);
  assert.equal(payload.combineLayers, true);
});

test('studio AI video generation keeps combined canvas when visible overlay items exist', () => {
  const currentLayer = layer('layer_1', [
    rawImageItem,
    {
      id: 'item_1',
      type: 'text',
      text: 'Overlay',
      x: 100,
      y: 100,
    },
  ]);

  const normalized = normalizeStudioAiVideoSourceFramePayload(
    {
      combineLayers: true,
      useStartFrame: true,
      useEndFrame: false,
    },
    { layers: [currentLayer] },
    currentLayer
  );

  assert.equal(normalized.combineLayers, true);
});

test('studio AI video generation keeps combined canvas for manually positioned non-raw images', () => {
  const currentLayer = layer('layer_1', [
    {
      ...rawImageItem,
      aiVideoSourceOriginal: false,
    },
  ]);

  const normalized = normalizeStudioAiVideoSourceFramePayload(
    {
      combineLayers: true,
      useStartFrame: true,
      useEndFrame: false,
    },
    { layers: [currentLayer] },
    currentLayer
  );

  assert.equal(normalized.combineLayers, true);
});

test('studio AI video generation preserves end-frame composition when next layer has overlays', () => {
  const currentLayer = layer('layer_1', [rawImageItem]);
  const nextLayer = layer('layer_2', [
    rawImageItem,
    {
      id: 'item_1',
      type: 'shape',
      shape: 'rectangle',
    },
  ]);

  const normalized = normalizeStudioAiVideoSourceFramePayload(
    {
      combineLayers: true,
      useStartFrame: true,
      useEndFrame: true,
    },
    { layers: [currentLayer, nextLayer] },
    currentLayer
  );

  assert.equal(normalized.combineLayers, true);
});
