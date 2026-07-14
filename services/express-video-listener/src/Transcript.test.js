import test from 'node:test';
import assert from 'node:assert/strict';

import { __testOnly__ } from './Transcript.js';

test('translated subtitle context ignores auto audio values and compares concrete languages', () => {
  const context = __testOnly__.getTranslatedSubtitleContext(
    {
      enableSubtitles: true,
      sessionLanguage: 'EN',
      subtitleLanguage: 'th',
      subtitleTranslationRequired: true,
    },
    {
      languageCode: 'auto',
      subtitleText: 'ข้อความภาษาไทย',
    },
  );

  assert.equal(context.audioLanguage, 'EN');
  assert.equal(context.subtitleLanguage, 'th');
  assert.equal(context.translationRequired, true);
  assert.equal(context.isTranslated, true);
});

test('per-layer detected speech language overrides TTS and session language fallbacks', () => {
  const context = __testOnly__.getTranslatedSubtitleContext(
    {
      enableSubtitles: true,
      sessionLanguage: 'EN',
      subtitleLanguage: 'en',
      subtitleLanguageExplicit: true,
    },
    {
      speechLanguage: 'ja',
      languageCode: 'en-US',
      subtitleLanguage: 'en',
      subtitleTranslationRequired: true,
    },
  );

  assert.equal(context.audioLanguage, 'ja');
  assert.equal(context.subtitleLanguage, 'en');
  assert.equal(context.isTranslated, true);
});

test('same-language regional and ISO aliases retain the aligned subtitle path', () => {
  assert.equal(__testOnly__.normalizeComparableLanguageCode('eng'), 'en');
  assert.equal(__testOnly__.normalizeComparableLanguageCode('en-US'), 'en');
  assert.equal(__testOnly__.normalizeComparableLanguageCode('auto'), '');

  const context = __testOnly__.getTranslatedSubtitleContext(
    {
      enableSubtitles: true,
      sessionLanguage: 'eng',
      subtitleLanguage: 'en-US',
      subtitleTranslationRequired: true,
    },
  );

  assert.equal(context.isTranslated, false);
});

test('static translated subtitle timing spans the connected scene', () => {
  const session = {
    layers: [
      { _id: 'scene-1', durationOffset: 0, duration: 2 },
      { _id: 'scene-2', durationOffset: 2, duration: 4.5 },
    ],
  };
  const timing = __testOnly__.getStaticSubtitleTiming(session, {
    connectedLayerId: 'scene-2',
    connectedLayerIndex: 0,
    startTime: 2.5,
    duration: 2,
  });

  assert.deepEqual(timing, {
    frameOffsetSeconds: -0.5,
    durationSeconds: 4.5,
    source: 'connected_scene',
  });
});

test('static translated subtitle item has safe font, scene timing, and no word animation data', () => {
  const item = __testOnly__.buildStaticTranslatedSubtitleItem({
    subtitleText: 'ข้อความภาษาไทย',
    canvasDimensions: { width: 1024, height: 1792 },
    subtitleFont: 'Poppins',
    audioLayerId: 'audio-1',
    aspectRatio: '9:16',
    speakerDetails: {
      showSpeaker: true,
      speaker: 'Narrator',
      speakerFont: 'Poppins',
    },
    subtitleLanguage: 'th',
    audioLanguage: 'en',
    audioDurationSeconds: 4.5,
    frameOffsetSeconds: -0.5,
    framesPerSecond: 24,
  });

  assert.equal(item.text, 'ข้อความภาษาไทย');
  assert.equal(item.isStaticSubtitle, true);
  assert.equal(item.subtitleRenderMode, 'static');
  assert.equal(item.config.staticSubtitle, true);
  assert.equal(item.config.autoWrap, true);
  assert.equal(item.config.fontFamily, 'Sarabun');
  assert.equal(item.config.speakerFontFamily, 'Sarabun');
  assert.equal(item.config.frameOffset, -12);
  assert.equal(item.config.frameDuration, 108);
  assert.deepEqual(item.animations, []);
  assert.deepEqual(item.words, []);
  assert.equal(item.wordAnimation, null);
  assert.equal(item.textAccent, null);
  assert.equal(Object.hasOwn(item, 'animation'), false);
});

test('translated font preferences resolve against the subtitle language', () => {
  const fonts = __testOnly__.resolveLanguageFontCandidates({
    languageCode: 'bn',
    fontPreferencesByLanguage: {},
    hasFontPreferences: false,
    defaultTextFont: 'Poppins',
    defaultSpeakerFont: 'Arial',
  });

  assert.equal(fonts.subtitleFont, 'Noto Sans Bengali');
  assert.equal(fonts.speakerFont, 'Noto Sans Bengali');
});
