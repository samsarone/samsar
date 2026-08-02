import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  applyDockerSubtitleAvailability,
  assertSubtitleGenerationAvailable,
  getAvailableDockerTTSProviders,
  isDockerAudioAvailabilityFilteringEnabled,
  isSubtitleGenerationAvailable,
} from './DockerAudioAvailability.js';

const ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_DEPLOYMENT_EDITION',
  'SAMSAR_EDITION',
  'SAMSAR_RUNTIME',
  'SAMSAR_DOCKER_AUDIO_PROVIDER_ROUTING_ENABLED',
  'SAMSAR_GENBLAZE_ENABLED',
  'SAMSAR_GENBLAZE_MODEL_CATALOG_PATH',
  'OPENAI_API_KEY',
  'FAL_API_KEY',
  'ELEVENLABS_API_KEY',
  'ELEVENLABS_API_TOKEN',
  'SAMSAR_API_KEY',
  'SAMSAR_AVAILABLE_MODELS_PATH',
];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function clearEnv() {
  ENV_KEYS.forEach((key) => delete process.env[key]);
}

test.afterEach(() => {
  ENV_KEYS.forEach((key) => {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  });
});

test('Docker subtitle generation requires OpenAI or Samsar credentials', () => {
  clearEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_DOCKER_AUDIO_PROVIDER_ROUTING_ENABLED = 'false';
  assert.equal(isSubtitleGenerationAvailable(), false);
  assert.throws(
    () => assertSubtitleGenerationAvailable(),
    (error) => error.code === 'SUBTITLE_PROVIDER_NOT_CONFIGURED' && error.status === 503,
  );

  process.env.OPENAI_API_KEY = 'openai-key';
  assert.equal(isSubtitleGenerationAvailable(), true);
  assert.doesNotThrow(() => assertSubtitleGenerationAvailable());

  delete process.env.OPENAI_API_KEY;
  process.env.SAMSAR_API_KEY = 'samsar-key';
  assert.equal(isSubtitleGenerationAvailable(), true);
  assert.doesNotThrow(() => assertSubtitleGenerationAvailable());
});

test('production Docker retains production subtitle and audio-provider behavior', () => {
  clearEnv();
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'production';
  process.env.SAMSAR_RUNTIME = 'docker';
  assert.equal(isSubtitleGenerationAvailable(), true);
  assert.equal(isDockerAudioAvailabilityFilteringEnabled(), false);

  const payload = { enable_subtitles: true, subtitle_language: 'th' };
  assert.equal(applyDockerSubtitleAvailability(payload), payload);
});

test('Docker precheck disables subtitle generation and translation intent without credentials', () => {
  clearEnv();
  process.env.CURRENT_ENV = 'docker';

  const payload = applyDockerSubtitleAvailability({
    enable_subtitles: true,
    addSubtitles: true,
    subtitle_language: 'th',
    subtitleTranslationRequired: true,
    subtitles_translation_required: true,
    translateSubtitles: true,
    prompt: 'Keep this field.',
  });

  assert.equal(payload.enable_subtitles, false);
  assert.equal(payload.enableSubtitles, false);
  assert.equal(payload.add_subtitles, false);
  assert.equal(payload.addSubtitles, false);
  assert.equal(payload.subtitleTranslationRequired, false);
  assert.equal(payload.subtitle_translation_required, false);
  assert.equal(payload.subtitlesTranslationRequired, false);
  assert.equal(payload.subtitles_translation_required, false);
  assert.equal(payload.translate_subtitles, false);
  assert.equal(payload.translateSubtitles, false);
  assert.equal(payload.subtitle_language, undefined);
  assert.equal(payload.subtitleLanguage, undefined);
  assert.equal(payload.prompt, 'Keep this field.');
});

test('Docker precheck preserves subtitle intent when Samsar credentials are configured', () => {
  clearEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_API_KEY = 'samsar-key';
  const payload = { enable_subtitles: true, subtitle_language: 'th' };
  assert.equal(applyDockerSubtitleAvailability(payload), payload);
});

test('Docker preserves PlayAI speech when Fal or Samsar can serve it', () => {
  clearEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.FAL_API_KEY = 'fal-key';
  assert.deepEqual(getAvailableDockerTTSProviders(), ['ELEVENLABS', 'PLAYAI']);

  delete process.env.FAL_API_KEY;
  process.env.SAMSAR_API_KEY = 'samsar-key';
  assert.deepEqual(
    getAvailableDockerTTSProviders(),
    ['OPENAI', 'GOOGLE', 'ELEVENLABS', 'PLAYAI'],
  );
});

test('Docker TTS availability includes credential-scoped GenBlaze audio routes', (context) => {
  clearEnv();
  process.env.CURRENT_ENV = 'docker';
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-gmi-audio-'));
  context.after(() => fs.rmSync(tempDirectory, { recursive: true, force: true }));
  const availableModelsPath = path.join(tempDirectory, 'available-models.json');
  fs.writeFileSync(availableModelsPath, JSON.stringify({
    providers: ['gmicloud'],
    models: ['ELEVENLABS'],
    actions: ['audio'],
    audio: {
      providers: ['gmicloud'],
      ttsProviders: ['ELEVENLABS'],
      musicProviders: [],
      soundEffectProviders: [],
      source: 'docker-audio-provider-config',
    },
  }));
  process.env.SAMSAR_AVAILABLE_MODELS_PATH = availableModelsPath;
  process.env.SAMSAR_GENBLAZE_ENABLED = 'true';
  process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH = path.join(
    tempDirectory,
    'genblaze-model-catalog.json',
  );
  fs.writeFileSync(process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH, JSON.stringify({
    provider: 'gmicloud',
    models: {
      ELEVENLABS: {
        audio: {
          modelId: 'elevenlabs-tts-multilingual-v2',
          operation: 'audio.generate',
        },
      },
    },
  }));

  assert.deepEqual(getAvailableDockerTTSProviders(), ['ELEVENLABS']);
});

test('Docker ignores stale GMICloud TTS availability without its runtime catalog route', (context) => {
  clearEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_GENBLAZE_ENABLED = 'true';
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-stale-gmi-audio-'));
  context.after(() => fs.rmSync(tempDirectory, { recursive: true, force: true }));
  process.env.SAMSAR_AVAILABLE_MODELS_PATH = path.join(tempDirectory, 'available-models.json');
  process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH = path.join(
    tempDirectory,
    'genblaze-model-catalog.json',
  );
  fs.writeFileSync(process.env.SAMSAR_AVAILABLE_MODELS_PATH, JSON.stringify({
    audio: {
      providers: ['gmicloud'],
      ttsProviders: ['OPENAI', 'ELEVENLABS'],
    },
  }));
  fs.writeFileSync(process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH, JSON.stringify({
    provider: 'gmicloud',
    models: {},
  }));

  assert.deepEqual(getAvailableDockerTTSProviders(), []);
});
