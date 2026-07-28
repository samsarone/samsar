import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hasConnectedSpeechAudioLayer,
  reconcileOrphanedLipSyncGenerationState,
} from './LipSyncLayerState.js';

test('only initializes lip sync when a character scene has connected speech', () => {
  const audioLayers = [{
    _id: 'speech-1',
    generationType: 'speech',
    connectedLayerIndex: 1,
  }];

  assert.equal(hasConnectedSpeechAudioLayer(audioLayers, {}, 0), false);
  assert.equal(hasConnectedSpeechAudioLayer(audioLayers, {}, 1), true);
});

test('clears a pending lip-sync flag after its connected speech layer is removed', () => {
  const session = {
    lipSyncGenerationPending: true,
    layers: [{
      _id: 'layer-1',
      lipSyncGenerationPending: true,
      lipSyncVideoGenerationStatus: 'PENDING',
      lipSyncVideoGenerationError: 'old error',
      hasLipSyncVideoLayer: false,
    }],
    audioLayers: [{
      _id: 'sound-1',
      generationType: 'sound_effect',
      connectedLayerId: 'layer-1',
    }],
  };

  const result = reconcileOrphanedLipSyncGenerationState(session);

  assert.deepEqual(result.clearedLayerIds, ['layer-1']);
  assert.equal(session.layers[0].lipSyncGenerationPending, false);
  assert.equal(session.layers[0].lipSyncVideoGenerationStatus, 'INIT');
  assert.equal(session.layers[0].lipSyncVideoGenerationError, null);
  assert.equal(session.lipSyncGenerationPending, false);
});

test('preserves a real pending lip-sync task with connected speech', () => {
  const session = {
    lipSyncGenerationPending: true,
    layers: [{
      _id: 'layer-1',
      lipSyncGenerationPending: true,
      lipSyncVideoGenerationStatus: 'PENDING',
    }],
    audioLayers: [{
      _id: 'speech-1',
      generationType: 'speech',
      connectedLayerId: 'layer-1',
    }],
  };

  const result = reconcileOrphanedLipSyncGenerationState(session);

  assert.equal(result.changed, false);
  assert.equal(session.layers[0].lipSyncGenerationPending, true);
  assert.equal(session.layers[0].lipSyncVideoGenerationStatus, 'PENDING');
  assert.equal(session.lipSyncGenerationPending, true);
});

test('matches legacy speech bindings by connected layer index', () => {
  const session = {
    layers: [{
      _id: 'layer-1',
      lipSyncGenerationPending: true,
      lipSyncVideoGenerationStatus: 'PENDING',
    }],
    audioLayers: [{
      _id: 'speech-1',
      generationType: 'speech',
      connectedLayerIndex: '0',
    }],
  };

  const result = reconcileOrphanedLipSyncGenerationState(session);

  assert.equal(result.changed, false);
  assert.equal(session.layers[0].lipSyncGenerationPending, true);
});

test('preserves completed lip-sync output while clearing an orphan pending flag', () => {
  const session = {
    layers: [{
      _id: 'layer-1',
      lipSyncGenerationPending: true,
      lipSyncVideoGenerationStatus: 'COMPLETED',
      hasLipSyncVideoLayer: true,
      lipSyncVideoLayer: '/assets/lip-sync.mp4',
    }],
    audioLayers: [],
  };

  reconcileOrphanedLipSyncGenerationState(session);

  assert.equal(session.layers[0].lipSyncGenerationPending, false);
  assert.equal(session.layers[0].lipSyncVideoGenerationStatus, 'COMPLETED');
  assert.equal(session.layers[0].lipSyncVideoLayer, '/assets/lip-sync.mp4');
});
