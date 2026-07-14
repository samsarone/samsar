import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSubtitleLanguageOverride } from './vidgenieSubtitleLanguage.mjs';

test('omits subtitle language when subtitles are disabled', () => {
  assert.equal(resolveSubtitleLanguageOverride({
    enableSubtitles: false,
    audioLanguage: 'en',
    subtitleLanguage: 'es',
  }), null);
});

test('omits subtitle language for the default and same-as-audio paths', () => {
  assert.equal(resolveSubtitleLanguageOverride({
    enableSubtitles: true,
    audioLanguage: 'en',
    subtitleLanguage: '',
  }), null);
  assert.equal(resolveSubtitleLanguageOverride({
    enableSubtitles: true,
    audioLanguage: 'en',
    subtitleLanguage: 'EN',
  }), null);
  assert.equal(resolveSubtitleLanguageOverride({
    enableSubtitles: true,
    audioLanguage: 'en',
    subtitleLanguage: 'auto',
  }), null);
});

test('returns a concrete differing subtitle language', () => {
  assert.equal(resolveSubtitleLanguageOverride({
    enableSubtitles: true,
    audioLanguage: 'en',
    subtitleLanguage: ' es ',
  }), 'es');
  assert.equal(resolveSubtitleLanguageOverride({
    enableSubtitles: true,
    audioLanguage: 'auto',
    subtitleLanguage: 'ja',
  }), 'ja');
});
