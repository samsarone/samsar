import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getInitialGenericVideoAdapter,
  resolveGenericVideoAudioContext,
} from './GenericVideoAdapter.js';

test('production Seedance 2.5 agent queues are born pinned to GMICloud', () => {
  assert.equal(getInitialGenericVideoAdapter('SEEDANCE2.5I2V', {
    CURRENT_ENV: 'production',
    SAMSAR_DEPLOYMENT_EDITION: 'production',
  }), 'gmicloud');
  assert.equal(getInitialGenericVideoAdapter('SEEDANCE2.5I2V', {
    CURRENT_ENV: 'docker',
    SAMSAR_DEPLOYMENT_EDITION: 'standalone',
  }), '');
});

test('Seedance 2.5 native audio follows the actual AI video layer type only', () => {
  assert.deepEqual(
    resolveGenericVideoAudioContext({
      model: 'SEEDANCE2.5I2V',
      generateAudio: true,
      isAudioVideoGeneration: true,
    }, {
      layerAiVideoType: 'narration',
    }),
    {
      generateAudio: false,
      generationType: 'narration',
      layerAiVideoType: 'narration',
    },
  );

  assert.deepEqual(
    resolveGenericVideoAudioContext({ model: 'SEEDANCE2.5I2V' }, {
      layerAiVideoType: 'sound_effect',
    }),
    {
      generateAudio: true,
      generationType: 'sound_effect',
      layerAiVideoType: 'sound_effect',
    },
  );
});

test('generic audio handling for other models remains payload-driven', () => {
  assert.deepEqual(
    resolveGenericVideoAudioContext({ model: 'SEEDANCE2.0I2V' }, {
      layerAiVideoType: 'sound_effect',
    }),
    {
      generateAudio: false,
      generationType: undefined,
      layerAiVideoType: undefined,
    },
  );
});
