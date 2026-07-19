import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyDockerSubtitleAvailability,
  assertSubtitleGenerationAvailable,
  isSubtitleGenerationAvailable,
} from './DockerAudioAvailability.js';

const ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_DOCKER_AUDIO_PROVIDER_ROUTING_ENABLED',
  'OPENAI_API_KEY',
  'SAMSAR_API_KEY',
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

test('non-Docker deployments retain subtitle generation behavior', () => {
  clearEnv();
  process.env.CURRENT_ENV = 'production';
  assert.equal(isSubtitleGenerationAvailable(), true);
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
