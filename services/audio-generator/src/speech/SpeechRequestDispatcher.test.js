import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach } from 'node:test';

process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

const ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_DEPLOYMENT_EDITION',
  'SAMSAR_DOCKER_AUDIO_PROVIDER_ROUTING_ENABLED',
  'SAMSAR_GENBLAZE_ENABLED',
  'SAMSAR_GENBLAZE_MODEL_CATALOG_PATH',
  'OPENAI_API_KEY',
  'ELEVENLABS_API_KEY',
  'ELEVENLABS_API_TOKEN',
  'FAL_API_KEY',
  'SAMSAR_API_KEY',
];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const { resolveSpeechProvider } = await import('./SpeechRequestDispatcher.js');

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

function configureGmiCatalog(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-speech-dispatch-'));
  const catalogPath = path.join(directory, 'genblaze-model-catalog.json');
  fs.writeFileSync(catalogPath, JSON.stringify({
    version: 1,
    provider: 'gmicloud',
    models: {
      OPENAI_TTS: {
        audio: { modelId: 'gpt-4o-mini-tts', operation: 'audio.generate' },
      },
      ELEVENLABS: {
        audio: { modelId: 'elevenlabs-tts-v3', operation: 'audio.generate' },
      },
    },
  }));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  for (const key of [
    'OPENAI_API_KEY',
    'ELEVENLABS_API_KEY',
    'ELEVENLABS_API_TOKEN',
    'FAL_API_KEY',
    'SAMSAR_API_KEY',
  ]) delete process.env[key];
  process.env.CURRENT_ENV = 'standalone';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
  process.env.SAMSAR_DOCKER_AUDIO_PROVIDER_ROUTING_ENABLED = 'true';
  process.env.SAMSAR_GENBLAZE_ENABLED = 'true';
  process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH = catalogPath;
}

test('dispatcher keeps ElevenLabs speaker ids on Samsar while retaining compatible GMICloud speech routes', (t) => {
  configureGmiCatalog(t);

  assert.equal(resolveSpeechProvider('OPENAI', { status: 'INIT' }), 'gmicloud');
  assert.equal(resolveSpeechProvider('GOOGLE', { status: 'INIT' }), 'googleCloud');
  assert.equal(resolveSpeechProvider('PLAYAI', { status: 'INIT' }), 'fal');

  process.env.SAMSAR_API_KEY = 'samsar-key';
  assert.equal(resolveSpeechProvider('ELEVENLABS', { status: 'INIT' }), 'samsar');
});

test('dispatcher preserves higher-priority native and Fal routes', (t) => {
  configureGmiCatalog(t);

  process.env.OPENAI_API_KEY = 'openai-key';
  assert.equal(resolveSpeechProvider('OPENAI', { status: 'INIT' }), 'openai');

  process.env.FAL_API_KEY = 'fal-key';
  assert.equal(resolveSpeechProvider('ELEVENLABS', { status: 'INIT' }), 'fal');

  process.env.ELEVENLABS_API_KEY = 'elevenlabs-key';
  assert.equal(resolveSpeechProvider('ELEVENLABS', { status: 'INIT' }), 'elevenlabs');
});

test('dispatcher keeps an in-flight GenBlaze request on its submitting adapter', () => {
  delete process.env.SAMSAR_GENBLAZE_ENABLED;
  delete process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH;
  process.env.OPENAI_API_KEY = 'new-native-key';

  assert.equal(resolveSpeechProvider('OPENAI', {
    status: 'PENDING',
    externalProvider: 'gmicloud',
    genblazeRequestId: 'sealed-job-token',
  }), 'gmicloud');
});
