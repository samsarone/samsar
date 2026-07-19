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

test('sound-effect aggregate requires completed output from every tracked layer', () => {
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

  assert.equal(result.state, 'FAILED');
  assert.equal(result.failed[0].layerId, 'two');
});

test('sound-effect aggregate detects failure after layerAiVideoType fallback', () => {
  const result = assessSoundEffectStage([
    soundEffectLayer('fallback', {
      layerAiVideoType: 'ai_video',
      soundEffectGenerationPending: false,
      soundEffectVideoGenerationStatus: 'FAILED',
    }),
  ]);

  assert.equal(result.state, 'FAILED');
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

  assert.equal(assessSoundEffectStage([
    soundEffectLayer('missing-output', {
      soundEffectGenerationPending: false,
      soundEffectVideoGenerationStatus: 'COMPLETED',
      hasSoundEffectVideoLayer: true,
    }),
  ]).state, 'INCOMPLETE');
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
