import test from 'node:test';
import assert from 'node:assert/strict';

import { hasBlockingLayerGenerationForRender } from './studioRenderEligibility.mjs';

test('does not block rendering for an orphaned lip-sync pending flag', () => {
  assert.equal(hasBlockingLayerGenerationForRender({
    layers: [{
      _id: 'layer-1',
      lipSyncGenerationPending: true,
      lipSyncVideoGenerationStatus: 'INIT',
    }],
    audioLayers: [{
      generationType: 'sound_effect',
      connectedLayerId: 'layer-1',
    }],
  }), false);
});

test('blocks rendering while connected speech is genuinely being lip-synced', () => {
  assert.equal(hasBlockingLayerGenerationForRender({
    layers: [{
      _id: 'layer-1',
      lipSyncGenerationPending: true,
      lipSyncVideoGenerationStatus: 'PENDING',
    }],
    audioLayers: [{
      generationType: 'speech',
      connectedLayerId: 'layer-1',
    }],
  }), true);
});

test('supports legacy speech bindings by layer index', () => {
  assert.equal(hasBlockingLayerGenerationForRender({
    layers: [{
      _id: 'layer-1',
      lipSyncGenerationPending: true,
    }],
    audioLayers: [{
      generationType: 'speech',
      connectedLayerIndex: '0',
    }],
  }), true);
});

test('stays conservative when a partial session omits audio layer state', () => {
  assert.equal(hasBlockingLayerGenerationForRender({
    layers: [{
      _id: 'layer-1',
      lipSyncGenerationPending: true,
    }],
  }), true);
});

test('continues to block other active layer generation and upload tasks', () => {
  const activeLayers = [
    { imageSession: { generationStatus: 'PENDING' } },
    { aiVideoGenerationPending: true },
    { soundEffectGenerationPending: true },
    { userVideoGenerationPending: true },
    { videoEditPending: true },
    { userVideoUploadTask: { status: 'PROCESSING' } },
  ];

  activeLayers.forEach((layer) => {
    assert.equal(hasBlockingLayerGenerationForRender({
      layers: [layer],
      audioLayers: [],
    }), true);
  });
});
