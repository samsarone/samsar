import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTranslatedSubtitleRerunFallback,
  resolveGeneratedSubtitleLayers,
} from './SubtitleRerunFallback.js';

test('translated rerun fallback uses target text, safe font, timing, and localized speaker', () => {
  const fallback = buildTranslatedSubtitleRerunFallback({
    audioLayer: {
      _id: { toString: () => 'audio-1' },
      prompt: 'Welcome home.',
      subtitleText: 'ยินดีต้อนรับกลับบ้าน',
      speechLanguage: 'en',
      subtitleLanguage: 'th',
      subtitleTranslationRequired: true,
      duration: 2.5,
      subtitleSpeakerCharacterName: 'ผู้นำทาง',
      speakerCharacterName: 'Guide',
    },
    session: { sessionLanguage: 'EN', subtitleLanguage: 'th' },
    canvasDimensions: { width: 1080, height: 1920 },
    subtitleFont: 'Poppins',
    speakerFont: 'Arial',
    framesPerSecond: 24,
  });

  assert.ok(fallback);
  assert.equal(fallback.text, 'ยินดีต้อนรับกลับบ้าน');
  assert.equal(fallback.speaker, 'ผู้นำทาง');
  assert.equal(fallback.audioLayerId, 'audio-1');
  assert.equal(fallback.subtitleRenderMode, 'static');
  assert.equal(fallback.isStaticSubtitle, true);
  assert.equal(fallback.config.staticSubtitle, true);
  assert.equal(fallback.config.fontFamily, 'Sarabun');
  assert.equal(fallback.config.speakerFontFamily, 'Sarabun');
  assert.equal(fallback.config.frameOffset, 0);
  assert.equal(fallback.config.frameDuration, 60);
  assert.deepEqual(fallback.words, []);
  assert.equal(fallback.wordAnimation, null);
});

test('translated language mismatch can produce fallback even when the rollout flag is absent', () => {
  const fallback = buildTranslatedSubtitleRerunFallback({
    audioLayer: {
      subtitleText: 'Bonjour.',
      speechLanguage: 'eng',
      subtitleLanguage: 'fr-FR',
      startTime: 1,
      endTime: 2,
    },
    framesPerSecond: 30,
  });

  assert.ok(fallback);
  assert.equal(fallback.text, 'Bonjour.');
  assert.equal(fallback.config.frameDuration, 30);
});

test('existing generated subtitle layers remain unchanged', () => {
  const existing = [{ text: 'Already aligned' }];
  assert.equal(
    resolveGeneratedSubtitleLayers(existing, { requireNonEmpty: true }),
    existing,
  );
});

test('required same-language rerun throws instead of silently reporting empty success', () => {
  assert.throws(
    () => resolveGeneratedSubtitleLayers([], {
      requireNonEmpty: true,
      audioLayer: {
        _id: { toString: () => 'audio-2' },
        prompt: 'Hello.',
        speechLanguage: 'en',
        subtitleLanguage: 'en',
      },
      session: { sessionLanguage: 'en', subtitleLanguage: 'en' },
    }),
    /produced no subtitle layers for audio layer audio-2/,
  );
});

test('translated rerun without target text also fails rather than persisting source speech', () => {
  assert.throws(
    () => resolveGeneratedSubtitleLayers([], {
      requireNonEmpty: true,
      audioLayer: {
        _id: { toString: () => 'audio-3' },
        prompt: 'Hello.',
        speechLanguage: 'en',
        subtitleLanguage: 'fr',
        subtitleTranslationRequired: true,
      },
    }),
    /produced no subtitle layers for audio layer audio-3/,
  );
});
