import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach } from 'node:test';

import {
  DOCKER_AUDIO_PROVIDER,
  DOCKER_SPEECH_PROVIDER_PRIORITY_BY_TTS_PROVIDER,
  getGenBlazeSpeechModelMapping,
  resolveDockerMusicProvider,
  resolveDockerSoundEffectProvider,
  resolveDockerSpeechProvider,
} from './DockerProviderPriority.js';

const ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_DEPLOYMENT_EDITION',
  'SAMSAR_DOCKER_AUDIO_PROVIDER_ROUTING_ENABLED',
  'SAMSAR_GENBLAZE_ENABLED',
  'SAMSAR_GENBLAZE_MODEL_CATALOG_PATH',
  'SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH',
  'GOOGLE_LYRIA_GEMINI_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_LYRIA_API_PROVIDER',
  'OPENAI_API_KEY',
  'ELEVENLABS_API_KEY',
  'ELEVENLABS_API_TOKEN',
  'FAL_API_KEY',
  'SAMSAR_API_KEY',
  'GOOGLE_CLOUD_PROJECT',
  'K_SERVICE',
];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

function clearProviderCredentials() {
  for (const key of [
    'GOOGLE_LYRIA_GEMINI_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_LYRIA_API_PROVIDER',
  'OPENAI_API_KEY',
    'ELEVENLABS_API_KEY',
    'ELEVENLABS_API_TOKEN',
    'FAL_API_KEY',
    'SAMSAR_API_KEY',
    'SAMSAR_GENBLAZE_ENABLED',
    'SAMSAR_GENBLAZE_MODEL_CATALOG_PATH',
  ]) {
    delete process.env[key];
  }
  process.env.CURRENT_ENV = 'standalone';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
  process.env.SAMSAR_DOCKER_AUDIO_PROVIDER_ROUTING_ENABLED = 'true';
}

function installCatalog(t, models) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-audio-gmi-'));
  const catalogPath = path.join(directory, 'genblaze-model-catalog.json');
  fs.writeFileSync(catalogPath, JSON.stringify({
    version: 1,
    provider: 'gmicloud',
    models,
  }));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  process.env.SAMSAR_GENBLAZE_ENABLED = 'true';
  process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH = catalogPath;
  return catalogPath;
}

test('keeps GMICloud for compatible OpenAI speech and keeps ElevenLabs speaker ids off GMICloud', () => {
  assert.deepEqual(DOCKER_SPEECH_PROVIDER_PRIORITY_BY_TTS_PROVIDER.OPENAI, [
    DOCKER_AUDIO_PROVIDER.OPENAI,
    DOCKER_AUDIO_PROVIDER.GMICLOUD,
    DOCKER_AUDIO_PROVIDER.SAMSAR,
  ]);
  assert.deepEqual(DOCKER_SPEECH_PROVIDER_PRIORITY_BY_TTS_PROVIDER.ELEVENLABS, [
    DOCKER_AUDIO_PROVIDER.FAL,
  ]);
});

test('routes only exact credential-scoped audio catalog mappings', (t) => {
  clearProviderCredentials();
  installCatalog(t, {
    OPENAI_TTS: {
      audio: { modelId: 'gpt-4o-mini-tts', operation: 'audio.generate' },
    },
    ELEVENLABS: {
      audio: { modelId: 'elevenlabs-tts-multilingual-v2', operation: 'audio.generate' },
    },
  });

  assert.equal(resolveDockerSpeechProvider('OPENAI', { status: 'INIT' }), 'gmicloud');
  assert.equal(resolveDockerSpeechProvider('ELEVENLABS', { status: 'INIT' }), '');
  assert.deepEqual(getGenBlazeSpeechModelMapping('ELEVENLABS'), {
    logicalModel: 'ELEVENLABS',
    modelId: 'elevenlabs-tts-multilingual-v2',
    operation: 'audio.generate',
  });
  assert.equal(resolveDockerSpeechProvider('GOOGLE', { status: 'INIT' }), '');
});

test('does not infer speech support from another modality or unsafe operation', (t) => {
  clearProviderCredentials();
  const catalogPath = installCatalog(t, {
    OPENAI_TTS: { text: { modelId: 'gpt-4o-mini-tts' } },
    ELEVENLABS: {
      audio: { modelId: 'elevenlabs-tts-v3', operation: 'attacker.operation' },
    },
  });

  assert.equal(resolveDockerSpeechProvider('OPENAI', { status: 'INIT' }), '');
  assert.equal(resolveDockerSpeechProvider('ELEVENLABS', { status: 'INIT' }), '');

  fs.writeFileSync(catalogPath, '{not-json');
  assert.equal(resolveDockerSpeechProvider('ELEVENLABS', { status: 'INIT' }), '');
});

test('routes new Docker ElevenLabs speech through Fal only', (t) => {
  clearProviderCredentials();
  installCatalog(t, {
    OPENAI_TTS: { audio: { modelId: 'gpt-4o-mini-tts' } },
    ELEVENLABS: { audio: { modelId: 'elevenlabs-tts-v3' } },
  });

  process.env.SAMSAR_API_KEY = 'samsar-key';
  assert.equal(resolveDockerSpeechProvider('OPENAI', { status: 'INIT' }), 'gmicloud');
  process.env.OPENAI_API_KEY = 'openai-key';
  assert.equal(resolveDockerSpeechProvider('OPENAI', { status: 'INIT' }), 'openai');

  delete process.env.OPENAI_API_KEY;
  process.env.FAL_API_KEY = 'fal-key';
  assert.equal(resolveDockerSpeechProvider('ELEVENLABS', { status: 'INIT' }), 'fal');
  process.env.ELEVENLABS_API_KEY = 'elevenlabs-key';
  assert.equal(resolveDockerSpeechProvider('ELEVENLABS', { status: 'INIT' }), 'fal');

  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.FAL_API_KEY;
  assert.equal(resolveDockerSpeechProvider('ELEVENLABS', { status: 'INIT' }), '');
  process.env.SAMSAR_GENBLAZE_ENABLED = 'false';
  assert.equal(resolveDockerSpeechProvider('ELEVENLABS', { status: 'INIT' }), '');
});

test('keeps a submitted GenBlaze speech request on GMICloud while pending', () => {
  clearProviderCredentials();

  assert.equal(resolveDockerSpeechProvider('OPENAI', {
    status: 'PENDING',
    externalProvider: 'gmicloud',
    genblazeRequestId: 'sealed-job-token',
  }), DOCKER_AUDIO_PROVIDER.GMICLOUD);

  process.env.SAMSAR_API_KEY = 'samsar-key';
  assert.equal(resolveDockerSpeechProvider('ELEVENLABS', {
    status: 'PENDING',
    audioAdapterProvider: 'genblaze',
  }), DOCKER_AUDIO_PROVIDER.GMICLOUD);
});

test('keeps every pending audio request on its submitted adapter', () => {
  clearProviderCredentials();
  process.env.OPENAI_API_KEY = 'new-openai-key';
  process.env.GOOGLE_CLOUD_PROJECT = 'new-google-project';
  process.env.K_SERVICE = 'attached-service-account';

  assert.equal(resolveDockerSpeechProvider('OPENAI', {
    status: 'PENDING',
    submittedAdapter: 'fal',
  }), DOCKER_AUDIO_PROVIDER.FAL);
  assert.equal(resolveDockerMusicProvider('LYRIA3', {
    status: 'PENDING',
    submittedAdapter: 'samsar',
  }), DOCKER_AUDIO_PROVIDER.SAMSAR);
  assert.equal(resolveDockerSoundEffectProvider('SDAUDIO', {
    status: 'PENDING',
    submittedAdapter: 'fal',
  }), DOCKER_AUDIO_PROVIDER.FAL);
});

test('standalone audio uses the highest saved compatible adapter priority', (t) => {
  clearProviderCredentials();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-audio-adapters-'));
  const preferencesPath = path.join(directory, 'model-adapter-preferences.json');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(preferencesPath, JSON.stringify({
    modelProviderPriority: {
      OPENAI_TTS: ['samsar', 'openai'],
      ELEVENLABS_MUSIC: ['fal', 'elevenlabs'],
      SDAUDIO: ['samsar', 'fal'],
    },
  }));
  process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH = preferencesPath;
  process.env.OPENAI_API_KEY = 'openai-key';
  process.env.ELEVENLABS_API_KEY = 'elevenlabs-key';
  process.env.FAL_API_KEY = 'fal-key';
  process.env.SAMSAR_API_KEY = 'samsar-key';

  assert.equal(resolveDockerSpeechProvider('OPENAI', { status: 'INIT' }), 'samsar');
  assert.equal(resolveDockerMusicProvider('ELEVENLABS_MUSIC', { status: 'INIT' }), 'fal');
  assert.equal(resolveDockerSoundEffectProvider('SDAUDIO', { status: 'INIT' }), 'samsar');
});

test('hosted audio ignores standalone adapter preferences', (t) => {
  clearProviderCredentials();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-audio-hosted-'));
  const preferencesPath = path.join(directory, 'model-adapter-preferences.json');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(preferencesPath, JSON.stringify({
    modelProviderPriority: {
      ELEVENLABS_MUSIC: ['fal', 'elevenlabs'],
    },
  }));
  process.env.CURRENT_ENV = 'production';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'production';
  process.env.SAMSAR_DOCKER_AUDIO_PROVIDER_ROUTING_ENABLED = 'true';
  process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH = preferencesPath;
  process.env.ELEVENLABS_API_KEY = 'elevenlabs-key';
  process.env.FAL_API_KEY = 'fal-key';

  assert.equal(resolveDockerMusicProvider('ELEVENLABS_MUSIC', { status: 'INIT' }), 'elevenlabs');
});

test('Lyria chooses the highest available version while keeping Vertex-only installs compatible', () => {
  clearProviderCredentials();
  process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
  process.env.K_SERVICE = 'test-service';
  assert.equal(resolveDockerMusicProvider('LYRIA3', { status: 'INIT' }), 'googleCloud');
  process.env.FAL_API_KEY = 'test-fal';
  assert.equal(resolveDockerMusicProvider('LYRIA3', { status: 'INIT' }), 'fal');
  process.env.GEMINI_API_KEY = 'test-gemini';
  assert.equal(resolveDockerMusicProvider('LYRIA3', { status: 'INIT' }), 'googleCloud');
  assert.equal(resolveDockerMusicProvider('LYRIA2', { status: 'INIT' }), 'googleCloud');
  delete process.env.GEMINI_API_KEY;
  process.env.GOOGLE_LYRIA_API_PROVIDER = 'vertex';
  assert.equal(resolveDockerMusicProvider('LYRIA3', { status: 'INIT' }), 'fal');
  delete process.env.FAL_API_KEY;
  assert.equal(resolveDockerMusicProvider('LYRIA3', { status: 'INIT' }), 'googleCloud');
  delete process.env.K_SERVICE;
  delete process.env.GOOGLE_CLOUD_PROJECT;
  process.env.GOOGLE_LYRIA_API_PROVIDER = 'gemini';
  process.env.GEMINI_API_KEY = 'test-gemini';
  assert.equal(resolveDockerSpeechProvider('GOOGLE', { status: 'INIT' }), '');
});
