import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVidgenieLanguageFields,
  resolveSubtitleLanguageOverride,
} from './vidgenieSubtitleLanguage.mjs';

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

test('adds the selected audio language to both T2V and I2V render inputs', () => {
  for (const mode of ['T2V', 'I2V']) {
    const modeInput = mode === 'T2V'
      ? { prompt: 'A launch film' }
      : { image_urls: [{ image_url: 'https://example.com/frame.png' }] };
    const requestInput = {
      ...modeInput,
      ...buildVidgenieLanguageFields({
        audioLanguage: ' JA ',
        enableSubtitles: false,
        subtitleLanguage: 'es',
      }),
    };

    assert.equal(requestInput.language, 'ja', `${mode} should include the selected language`);
    assert.equal(requestInput.enable_subtitles, false);
    assert.equal('subtitle_language' in requestInput, false);
  }
});

test('keeps subtitle language independent from the render audio language', () => {
  assert.deepEqual(buildVidgenieLanguageFields({
    audioLanguage: 'en',
    enableSubtitles: true,
    subtitleLanguage: 'ES',
  }), {
    language: 'en',
    enable_subtitles: true,
    subtitle_language: 'es',
  });
});
