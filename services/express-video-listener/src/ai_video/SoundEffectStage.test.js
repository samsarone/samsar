import test from 'node:test';
import assert from 'node:assert/strict';

import { assessSoundEffectStage } from './SoundEffectStage.js';

function soundEffectLayer(id, overrides = {}) {
  return {
    _id: id,
    layerAiVideoType: 'sound_effect',
    layerBaseAiImageType: 'sound_effect',
    hasAiVideoLayer: true,
    aiVideoLayer: `/assets_v2/ai_video/${id}.mp4`,
    soundEffectGenerationPending: true,
    soundEffectVideoGenerationStatus: 'INIT',
    ...overrides,
  };
}

test('sound-effect aggregate falls back after a terminal layer failure', () => {
  const result = assessSoundEffectStage([
    soundEffectLayer('one', {
      soundEffectGenerationPending: false,
      soundEffectVideoGenerationStatus: 'COMPLETED',
      hasSoundEffectVideoLayer: true,
      soundEffectVideoLayer: '/assets_v2/sound/one.mp4',
    }),
    soundEffectLayer('two', {
      soundEffectGenerationPending: false,
      soundEffectVideoGenerationStatus: 'FAILED',
      soundEffectVideoGenerationError: 'Provider failed.',
    }),
  ]);

  assert.equal(result.state, 'FALLBACK');
  assert.equal(result.failed[0].layerId, 'two');
  assert.equal(result.skipped[0].layerId, 'two');
});

test('sound-effect aggregate detects fallback after layerAiVideoType changes', () => {
  const result = assessSoundEffectStage([
    soundEffectLayer('fallback', {
      layerAiVideoType: 'ai_video',
      soundEffectGenerationPending: false,
      soundEffectVideoGenerationStatus: 'FAILED',
    }),
  ]);

  assert.equal(result.state, 'FALLBACK');
  assert.equal(result.required.length, 1);
});

test('sound-effect aggregate completes only with flag, status, and media link', () => {
  assert.equal(assessSoundEffectStage([
    soundEffectLayer('complete', {
      soundEffectGenerationPending: false,
      soundEffectVideoGenerationStatus: 'COMPLETED',
      hasSoundEffectVideoLayer: true,
      soundEffectRemoteLink: 'https://static.example/sound/complete.mp4',
    }),
  ]).state, 'COMPLETED');

  const missingOutput = assessSoundEffectStage([
    soundEffectLayer('missing-output', {
      soundEffectGenerationPending: false,
      soundEffectVideoGenerationStatus: 'COMPLETED',
      hasSoundEffectVideoLayer: true,
    }),
  ]);
  assert.equal(missingOutput.state, 'FALLBACK');
  assert.equal(missingOutput.skipped[0].layerId, 'missing-output');
});

test('sound-effect aggregate waits for active layers before applying fallback', () => {
  const result = assessSoundEffectStage([
    soundEffectLayer('failed', {
      soundEffectGenerationPending: false,
      soundEffectVideoGenerationStatus: 'FAILED',
    }),
    soundEffectLayer('pending', {
      soundEffectGenerationPending: true,
      soundEffectVideoGenerationStatus: 'PENDING',
    }),
  ]);

  assert.equal(result.state, 'PENDING');
  assert.equal(result.failed[0].layerId, 'failed');
  assert.equal(result.pending[0].layerId, 'pending');
});

test('remote-only base AI video remains eligible for sound-effect generation', () => {
  const result = assessSoundEffectStage([
    soundEffectLayer('remote-only', {
      aiVideoLayer: null,
      aiVideoRemoteLink: 'https://provider.example/video/source.mp4',
      hasAiVideoLayer: true,
    }),
  ]);

  assert.equal(result.state, 'PENDING');
  assert.equal(result.required[0].layerId, 'remote-only');
});
