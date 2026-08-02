import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite';

const CLIENT_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DEPLOYMENT_ENV_KEYS = [
  'VITE_SAMSAR_DEPLOYMENT_EDITION',
  'VITE_CURRENT_ENV',
  'VITE_DOCKER_INSTALL',
];

async function loadAvailabilityModuleForEdition(edition) {
  const previousEnvironment = Object.fromEntries(
    DEPLOYMENT_ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  process.env.VITE_SAMSAR_DEPLOYMENT_EDITION = edition;
  delete process.env.VITE_CURRENT_ENV;
  delete process.env.VITE_DOCKER_INSTALL;

  const server = await createServer({
    root: CLIENT_ROOT,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true },
  });

  return {
    module: await server.ssrLoadModule('/src/constants/audioProviderAvailability.js'),
    async close() {
      await server.close();
      for (const key of DEPLOYMENT_ENV_KEYS) {
        if (previousEnvironment[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = previousEnvironment[key];
        }
      }
    },
  };
}

test('standalone audio availability fails closed while configuration is unavailable', async (context) => {
  const loaded = await loadAvailabilityModuleForEdition('standalone');
  context.after(() => loaded.close());

  const speakers = [
    { value: 'alloy', provider: 'OPENAI' },
    { value: 'voice-1', provider: 'ELEVENLABS' },
  ];
  const providers = [
    { value: 'OPENAI', label: 'OpenAI' },
    { value: 'ELEVENLABS', label: 'ElevenLabs' },
  ];

  assert.equal(
    loaded.module.hasAudioAvailabilityRules(loaded.module.DEFAULT_AUDIO_AVAILABILITY),
    true,
  );
  assert.deepEqual(
    loaded.module.filterSpeakersForAudioAvailability(
      speakers,
      loaded.module.DEFAULT_AUDIO_AVAILABILITY,
    ),
    [],
  );
  assert.deepEqual(
    loaded.module.filterTtsProviderOptionsForAudioAvailability(
      providers,
      loaded.module.DEFAULT_AUDIO_AVAILABILITY,
    ),
    [],
  );
});

test('hosted audio availability keeps the unfiltered production behavior', async (context) => {
  const loaded = await loadAvailabilityModuleForEdition('production');
  context.after(() => loaded.close());

  const speakers = [{ value: 'alloy', provider: 'OPENAI' }];
  assert.equal(
    loaded.module.hasAudioAvailabilityRules(loaded.module.DEFAULT_AUDIO_AVAILABILITY),
    false,
  );
  assert.equal(
    loaded.module.filterSpeakersForAudioAvailability(
      speakers,
      loaded.module.DEFAULT_AUDIO_AVAILABILITY,
    ),
    speakers,
  );
});
