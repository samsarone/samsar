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
const { resolveAvatarSpeechAdapterProvider } = await import('./AvatarVoiceoverSpeech.js');

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

function resetProviders() {
  for (const key of [
    'OPENAI_API_KEY',
    'ELEVENLABS_API_KEY',
    'ELEVENLABS_API_TOKEN',
    'FAL_API_KEY',
    'SAMSAR_API_KEY',
    'SAMSAR_GENBLAZE_ENABLED',
    'SAMSAR_GENBLAZE_MODEL_CATALOG_PATH',
  ]) delete process.env[key];
  process.env.CURRENT_ENV = 'standalone';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
  process.env.SAMSAR_DOCKER_AUDIO_PROVIDER_ROUTING_ENABLED = 'true';
}

test('avatar timeline speech selects GenBlaze only when its exact audio mapping exists', (t) => {
  resetProviders();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-avatar-gmi-'));
  const catalogPath = path.join(directory, 'genblaze-model-catalog.json');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(catalogPath, JSON.stringify({
    version: 1,
    provider: 'gmicloud',
    models: {
      ELEVENLABS: {
        audio: { modelId: 'elevenlabs-tts-v3', operation: 'audio.generate' },
      },
    },
  }));
  process.env.SAMSAR_GENBLAZE_ENABLED = 'true';
  process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH = catalogPath;

  assert.equal(resolveAvatarSpeechAdapterProvider({
    ttsProvider: 'ELEVENLABS',
    speaker: 'voice-123',
  }), 'gmicloud');
  assert.equal(resolveAvatarSpeechAdapterProvider({
    ttsProvider: 'OPENAI',
    speaker: 'alloy',
  }), '');
});

test('avatar timeline speech preserves native and Fal priority above GenBlaze', (t) => {
  resetProviders();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-avatar-priority-'));
  const catalogPath = path.join(directory, 'genblaze-model-catalog.json');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(catalogPath, JSON.stringify({
    models: {
      OPENAI_TTS: { audio: { modelId: 'gpt-4o-mini-tts' } },
      ELEVENLABS: { audio: { modelId: 'elevenlabs-tts-v3' } },
    },
  }));
  process.env.SAMSAR_GENBLAZE_ENABLED = 'true';
  process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH = catalogPath;

  process.env.OPENAI_API_KEY = 'openai-key';
  assert.equal(resolveAvatarSpeechAdapterProvider({ ttsProvider: 'OPENAI' }), 'openai');

  process.env.FAL_API_KEY = 'fal-key';
  assert.equal(resolveAvatarSpeechAdapterProvider({ ttsProvider: 'ELEVENLABS' }), 'fal');
});
