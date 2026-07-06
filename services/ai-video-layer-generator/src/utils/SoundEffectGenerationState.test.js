import test from 'node:test';
import assert from 'node:assert/strict';

import { isStaleSoundEffectGenerationForLayer } from './SoundEffectGenerationState.js';

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
