import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach } from 'node:test';

import {
  DOCKER_AUDIO_PROVIDER,
  DOCKER_SPEECH_PROVIDER_PRIORITY_BY_TTS_PROVIDER,
  getGenBlazeSpeechModelMapping,
  resolveDockerSpeechProvider,
} from './DockerProviderPriority.js';

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

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

function clearProviderCredentials() {
  for (const key of [
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

test('keeps GMICloud below native and Fal but above Samsar speech adapters', () => {
  assert.deepEqual(DOCKER_SPEECH_PROVIDER_PRIORITY_BY_TTS_PROVIDER.OPENAI, [
    DOCKER_AUDIO_PROVIDER.OPENAI,
    DOCKER_AUDIO_PROVIDER.GMICLOUD,
    DOCKER_AUDIO_PROVIDER.SAMSAR,
  ]);
  assert.deepEqual(DOCKER_SPEECH_PROVIDER_PRIORITY_BY_TTS_PROVIDER.ELEVENLABS, [
    DOCKER_AUDIO_PROVIDER.ELEVENLABS,
    DOCKER_AUDIO_PROVIDER.FAL,
    DOCKER_AUDIO_PROVIDER.GMICLOUD,
    DOCKER_AUDIO_PROVIDER.SAMSAR,
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
  assert.equal(resolveDockerSpeechProvider('ELEVENLABS', { status: 'INIT' }), 'gmicloud');
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

test('uses native and Fal providers before GMICloud, then falls back to Samsar', (t) => {
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
  assert.equal(resolveDockerSpeechProvider('ELEVENLABS', { status: 'INIT' }), 'elevenlabs');

  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.FAL_API_KEY;
  process.env.SAMSAR_GENBLAZE_ENABLED = 'false';
  assert.equal(resolveDockerSpeechProvider('ELEVENLABS', { status: 'INIT' }), 'samsar');
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
