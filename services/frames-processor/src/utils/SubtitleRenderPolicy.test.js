import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getSubtitleTranslationContext,
  normalizeComparableSubtitleLanguage,
  prepareLayerSubtitlesForRendering,
} from './SubtitleRenderPolicy.js';

test('subtitle language comparison treats aliases and regional variants as the same language', () => {
  assert.equal(normalizeComparableSubtitleLanguage('eng'), 'en');
  assert.equal(normalizeComparableSubtitleLanguage('en-US'), 'en');
  assert.equal(normalizeComparableSubtitleLanguage('auto'), '');

  const context = getSubtitleTranslationContext({
    enableSubtitles: true,
    sessionLanguage: 'eng',
    subtitleLanguage: 'en-US',
    subtitleTranslationRequired: true,
  });

  assert.equal(context.isTranslated, false);
});

test('same-language subtitle items remain untouched', () => {
  const subtitleItem = {
    type: 'text',
    subType: 'subtitle',
    text: 'HELLO',
    config: { fontFamily: 'Poppins' },
    words: [{ word: 'HELLO', frameOffset: 0, frameDuration: 12 }],
    wordAnimation: 'highlight',
  };
  const layer = { imageSession: { activeItemList: [subtitleItem] } };

  const prepared = prepareLayerSubtitlesForRendering(layer, {
    enableSubtitles: true,
    sessionLanguage: 'en',
    subtitleLanguage: 'en',
  });

  assert.equal(prepared, layer);
  assert.equal(prepared.imageSession.activeItemList[0], subtitleItem);
});

test('detected speech language wins over TTS and session fallbacks', () => {
  const context = getSubtitleTranslationContext({
    enableSubtitles: true,
    sessionLanguage: 'en',
    subtitleLanguage: 'en',
    audioLayers: [
      {
        _id: 'audio-1',
        speechLanguage: 'ja',
        languageCode: 'en-US',
        subtitleLanguage: 'en',
        subtitleTranslationRequired: true,
      },
    ],
  }, {
    type: 'text',
    subType: 'subtitle',
    audioLayerId: 'audio-1',
  });

  assert.equal(context.audioLanguage, 'ja');
  assert.equal(context.subtitleLanguage, 'en');
  assert.equal(context.isTranslated, true);
});

test('translated subtitle items are forced static with a target-language safe font', () => {
  const layer = {
    imageSession: {
      activeItemList: [
        {
          type: 'text',
          subType: 'subtitle',
          text: 'ข้อความภาษาไทย',
          audioLayerId: 'audio-1',
          animation: 'fade-in',
          animations: [{ type: 'typewriter', startFrame: 0, endFrame: 24 }],
          config: {
            fontFamily: 'Poppins',
            speakerFontFamily: 'Arial',
            autoWrap: false,
            breakTextWidth: 824,
          },
          words: [{ word: 'wrong', frameOffset: 0, frameDuration: 5 }],
          wordAnimation: 'highlight',
          textAccent: 'glowing',
        },
      ],
    },
  };
  const session = {
    enableSubtitles: true,
    sessionLanguage: 'en',
    subtitleLanguage: 'th',
    subtitleTranslationRequired: true,
    audioLayers: [
      {
        _id: 'audio-1',
        languageCode: 'auto',
        subtitleLanguage: 'th',
        subtitleTranslationRequired: true,
      },
    ],
  };

  const prepared = prepareLayerSubtitlesForRendering(layer, session);
  const item = prepared.imageSession.activeItemList[0];

  assert.notEqual(prepared, layer);
  assert.equal(item.isStaticSubtitle, true);
  assert.equal(item.subtitleRenderMode, 'static');
  assert.equal(item.config.staticSubtitle, true);
  assert.equal(item.config.autoWrap, true);
  assert.equal(item.config.breakTextWidth, 824);
  assert.equal(item.config.fontFamily, 'Sarabun');
  assert.equal(item.config.speakerFontFamily, 'Sarabun');
  assert.deepEqual(item.animations, []);
  assert.deepEqual(item.words, []);
  assert.equal(item.wordAnimation, null);
  assert.equal(item.textAccent, null);
  assert.equal(Object.hasOwn(item, 'animation'), false);
});

test('an explicit static marker is enforced even when session language metadata is absent', () => {
  const layer = {
    imageSession: {
      activeItemList: [
        {
          type: 'text',
          subType: 'subtitle',
          isStaticSubtitle: true,
          subtitleLanguage: 'bn',
          config: { fontFamily: 'Poppins' },
          words: [{ word: 'stale' }],
        },
      ],
    },
  };

  const item = prepareLayerSubtitlesForRendering(layer, {
    enableSubtitles: true,
  }).imageSession.activeItemList[0];

  assert.equal(item.config.fontFamily, 'Noto Sans Bengali');
  assert.deepEqual(item.words, []);
});
