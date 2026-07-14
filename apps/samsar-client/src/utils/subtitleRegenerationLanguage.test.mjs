import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSubtitleRegenerationLanguageFields,
  isTranslatedSubtitleRegeneration,
  resolveSessionAudioLanguage,
  resolveSessionSubtitleLanguage,
  resolveSubtitleRegenerationDefault,
} from './subtitleRegenerationLanguage.mjs';

test('defaults regeneration to an existing subtitle language before the audio language', () => {
  const session = {
    sessionLanguage: 'EN',
    subtitleLanguage: 'es',
  };

  assert.equal(resolveSessionAudioLanguage(session), 'en');
  assert.equal(resolveSessionSubtitleLanguage(session), 'es');
  assert.equal(resolveSubtitleRegenerationDefault(session), 'es');
});

test('falls back to the session audio language and normalizes language aliases', () => {
  const session = {
    input: {
      language: 'CN',
    },
  };

  assert.equal(resolveSubtitleRegenerationDefault(session), 'zh');
  assert.deepEqual(buildSubtitleRegenerationLanguageFields({
    selectedLanguage: '',
    audioLanguage: 'CN',
  }), {
    subtitle_language: 'zh',
  });
});

test('sends an explicit same-as-audio language when switching back from translated subtitles', () => {
  assert.deepEqual(buildSubtitleRegenerationLanguageFields({
    selectedLanguage: 'en',
    audioLanguage: 'en',
  }), {
    subtitle_language: 'en',
  });
  assert.equal(isTranslatedSubtitleRegeneration({
    selectedLanguage: 'en',
    audioLanguage: 'en',
  }), false);
});

test('identifies a different subtitle language as translated regeneration', () => {
  assert.deepEqual(buildSubtitleRegenerationLanguageFields({
    selectedLanguage: 'Japanese',
    audioLanguage: 'en-US',
  }), {
    subtitle_language: 'ja',
  });
  assert.equal(isTranslatedSubtitleRegeneration({
    selectedLanguage: 'ja',
    audioLanguage: 'en-US',
  }), true);
});

test('omits unsupported and unavailable languages instead of changing audio settings', () => {
  assert.deepEqual(buildSubtitleRegenerationLanguageFields({
    selectedLanguage: 'unsupported',
    audioLanguage: '',
  }), {});
});
