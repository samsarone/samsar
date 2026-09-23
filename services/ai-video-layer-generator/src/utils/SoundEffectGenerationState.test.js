import test from 'node:test';
import assert from 'node:assert/strict';

import { isSoundEffectGenerationForLayer, isStaleSoundEffectGenerationForLayer } from './SoundEffectGenerationState.js';

const soundEffectModels = ['MMAUDIOV2', 'VEO3.1I2V'];

test('stale sound-effect generation is skipped only for audio-video jobs on non-sound-effect layers', () => {
  assert.equal(
    isStaleSoundEffectGenerationForLayer({
      model: 'MMAUDIOV2',
      isAudioVideoGeneration: true,
      currentLayer: { layerAiVideoType: 'ai_video' },
      soundEffectModels,
    }),
    true,
  );

  assert.equal(
    isStaleSoundEffectGenerationForLayer({
      model: 'VEO3.1I2V',
      isAudioVideoGeneration: false,
      currentLayer: { layerAiVideoType: 'ai_video' },
      soundEffectModels,
    }),
    false,
  );

  assert.equal(
    isStaleSoundEffectGenerationForLayer({
      model: 'MMAUDIOV2',
      isAudioVideoGeneration: true,
      currentLayer: { layerAiVideoType: 'sound_effect' },
      soundEffectModels,
    }),
    false,
  );
});

test('a pending audio-video retry retains its original sound-effect identity', () => {
  const currentLayer = {
    layerAiVideoType: 'ai_video',
    layerBaseAiImageType: 'sound_effect',
    isAudioVideoLayer: true,
    aiVideoGenerationPending: true,
  };
  assert.equal(isSoundEffectGenerationForLayer(currentLayer), true);
  assert.equal(isStaleSoundEffectGenerationForLayer({
    model: 'SEEDANCE2.0I2V',
    isAudioVideoGeneration: true,
    currentLayer,
    soundEffectModels: ['SEEDANCE2.0I2V'],
  }), false);
  assert.equal(isSoundEffectGenerationForLayer({ ...currentLayer, aiVideoGenerationPending: false }), false);
});

test('a later dedicated sound-effect request is current after silent base-video fallback', () => {
  const currentLayer = {
    layerAiVideoType: 'ai_video',
    layerBaseAiImageType: 'sound_effect',
    isAudioVideoLayer: false,
    aiVideoGenerationPending: false,
    soundEffectGenerationPending: true,
  };
  assert.equal(isSoundEffectGenerationForLayer(currentLayer, 'sound_effect'), true);
  assert.equal(isStaleSoundEffectGenerationForLayer({
    model: 'MIRELOAI', isAudioVideoGeneration: true, generationType: 'sound_effect',
    currentLayer, soundEffectModels: ['MIRELOAI'],
  }), false);
  assert.equal(isSoundEffectGenerationForLayer({ ...currentLayer, soundEffectGenerationPending: false }, 'sound_effect'), false);
});
