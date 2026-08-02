import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDockerAudioAvailability } from './docker-audio-provider-config.mjs';

test('GMICloud audio availability is derived only from credential-scoped mappings', () => {
  const withoutMappings = buildDockerAudioAvailability({
    gmicloud: { enabled: true },
  }, {
    gmiCloudModelMappings: {},
  });
  assert.deepEqual(withoutMappings.ttsProviders, []);

  const withElevenLabs = buildDockerAudioAvailability({
    gmicloud: { enabled: true },
  }, {
    gmiCloudModelMappings: {
      ELEVENLABS: {
        audio: { modelId: 'elevenlabs-tts-multilingual-v2' },
      },
    },
  });
  assert.deepEqual(withElevenLabs.providers, ['gmicloud']);
  assert.deepEqual(withElevenLabs.ttsProviders, ['ELEVENLABS']);

  const withBothExactRoutes = buildDockerAudioAvailability({
    gmicloud: { enabled: true },
  }, {
    gmiCloudModelMappings: {
      OPENAI_TTS: { audio: { modelId: 'gpt-4o-mini-tts' } },
      ELEVENLABS: { audio: { modelId: 'elevenlabs-tts-v3' } },
    },
  });
  assert.deepEqual(withBothExactRoutes.ttsProviders, ['ELEVENLABS', 'OPENAI']);
});

test('GMICloud mappings do not broaden music or sound-effect availability', () => {
  const available = buildDockerAudioAvailability({
    gmicloud: { enabled: true },
  }, {
    gmiCloudModelMappings: {
      ELEVENLABS: { audio: { modelId: 'elevenlabs-tts-v3' } },
      ATTACKER_MUSIC: { audio: { modelId: 'minimax-music-2.5' } },
    },
  });

  assert.deepEqual(available.musicProviders, []);
  assert.deepEqual(available.soundEffectProviders, []);
});
