import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assessLipSyncStage,
  findConnectedSpeechAudioLayer,
  hasLipSyncOutput,
} from './LipSyncStage.js';

function characterLayer(id, overrides = {}) {
  return {
    _id: id,
    layerAiVideoType: 'character',
    layerBaseAiImageType: 'character',
    hasAiVideoLayer: true,
    aiVideoLayer: `/assets_v2/ai_video/${id}.mp4`,
    lipSyncGenerationPending: true,
    lipSyncVideoGenerationStatus: 'INIT',
    ...overrides,
  };
}

function speechLayer(id, connectedLayerId, connectedLayerIndex) {
  return {
    _id: id,
    generationType: 'speech',
    generationStatus: 'COMPLETED',
    connectedLayerId,
    connectedLayerIndex,
  };
}

test('branched canonical lip sync completes only when every required layer has output', () => {
  const layers = [
    characterLayer('shared', {
      lipSyncGenerationPending: false,
      lipSyncVideoGenerationStatus: 'COMPLETED',
      hasLipSyncVideoLayer: true,
      lipSyncVideoLayer: '/assets_v2/lip/shared.mp4',
    }),
    characterLayer('branch-a', {
      lipSyncGenerationPending: false,
      lipSyncVideoGenerationStatus: 'COMPLETED',
      hasLipSyncVideoLayer: true,
      lipSyncRemoteLink: 'https://static.example/lip/branch-a.mp4',
    }),
  ];
  const audioLayers = [
    speechLayer('audio-shared', 'shared', 0),
    speechLayer('audio-branch-a', 'branch-a', 1),
  ];

  const result = assessLipSyncStage(layers, audioLayers);
  assert.equal(result.state, 'COMPLETED');
  assert.equal(result.required.length, 2);
  assert.equal(result.completed.length, 2);
});

test('one failed branch layer fails the aggregate instead of looking completed', () => {
  const layers = [
    characterLayer('shared', {
      lipSyncGenerationPending: false,
      lipSyncVideoGenerationStatus: 'COMPLETED',
      hasLipSyncVideoLayer: true,
      lipSyncVideoLayer: '/assets_v2/lip/shared.mp4',
    }),
    characterLayer('branch-b', {
      lipSyncGenerationPending: false,
      lipSyncVideoGenerationStatus: 'FAILED',
      lipSyncVideoGenerationError: 'Provider rejected the audio input.',
    }),
  ];
  const audioLayers = [
    speechLayer('audio-shared', 'shared', 0),
    speechLayer('audio-branch-b', 'branch-b', 1),
  ];

  const result = assessLipSyncStage(layers, audioLayers);
  assert.equal(result.state, 'FAILED');
  assert.equal(result.failed[0].layerId, 'branch-b');
});

test('detects a historical silent skip after layerAiVideoType was downgraded', () => {
  const layer = characterLayer('branch-c', {
    layerAiVideoType: 'ai_video',
    lipSyncGenerationPending: false,
  });
  const result = assessLipSyncStage(
    [layer],
    [speechLayer('audio-branch-c', 'branch-c', 0)],
  );

  assert.equal(result.state, 'INCOMPLETE');
  assert.equal(result.incomplete[0].layerId, 'branch-c');
});

test('connected audio selection ignores music and falls back to canonical layer index', () => {
  const layer = characterLayer('branch-d');
  const audioLayers = [
    {
      _id: 'music',
      generationType: 'music',
      connectedLayerId: 'branch-d',
      connectedLayerIndex: 0,
    },
    speechLayer('speech', null, 0),
  ];

  assert.equal(
    findConnectedSpeechAudioLayer(audioLayers, layer, 0)?._id,
    'speech',
  );
});

test('lip sync output requires the completion flag and a persisted media reference', () => {
  assert.equal(hasLipSyncOutput({ lipSyncVideoLayer: '/lip.mp4' }), false);
  assert.equal(hasLipSyncOutput({ hasLipSyncVideoLayer: true }), false);
  assert.equal(
    hasLipSyncOutput({ hasLipSyncVideoLayer: true, lipSyncVideoLayer: '/lip.mp4' }),
    true,
  );
});
