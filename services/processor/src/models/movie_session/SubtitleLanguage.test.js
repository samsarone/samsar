import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSpeechSubtitleLayerFields,
  buildSpeechSubtitleTextMap,
  normalizeDetectedSpeechLanguage,
  resolveSpeechLanguageCode,
  resolveSubtitleLanguageOption,
} from './SubtitleLanguage.js';

test('detected ISO-639-2 language aliases normalize to canonical source codes', () => {
  assert.deepEqual(
    ['eng', 'spa', 'fra', 'fre', 'jpn', 'tha', 'zho', 'ben', 'hin', 'san', 'lat']
      .map(normalizeDetectedSpeechLanguage),
    ['en', 'es', 'fr', 'fr', 'ja', 'th', 'zh', 'bn', 'hi', 'sa', 'la'],
  );
});

test('subtitle language defaults to the normalized speech language without coercing auto', () => {
  assert.equal(resolveSpeechLanguageCode('auto'), 'auto');
  assert.deepEqual(resolveSubtitleLanguageOption({}, 'JA'), {
    speechLanguageCode: 'ja',
    subtitleLanguage: 'ja',
    subtitleLanguageString: 'Japanese',
    subtitleLanguageExplicit: false,
    translationRequired: false,
    translationDecisionPending: false,
  });
  assert.deepEqual(resolveSubtitleLanguageOption({}, 'auto'), {
    speechLanguageCode: 'auto',
    subtitleLanguage: 'auto',
    subtitleLanguageString: null,
    subtitleLanguageExplicit: false,
    translationRequired: false,
    translationDecisionPending: false,
  });
  assert.equal(resolveSubtitleLanguageOption({ subtitle_language: '' }, 'fr').subtitleLanguage, 'fr');
  assert.equal(resolveSubtitleLanguageOption({ subtitleLanguage: null }, 'bn').subtitleLanguage, 'bn');
});

test('subtitle language accepts aliases, preserves the propagated explicit bit, and rejects explicit auto', () => {
  const snakeCase = resolveSubtitleLanguageOption({ subtitle_language: 'TH' }, 'en');
  assert.equal(snakeCase.subtitleLanguage, 'th');
  assert.equal(snakeCase.subtitleLanguageExplicit, true);
  assert.equal(snakeCase.translationRequired, true);

  const camelCase = resolveSubtitleLanguageOption({ subtitleLanguage: 'jp' }, 'auto');
  assert.equal(camelCase.subtitleLanguage, 'ja');
  assert.equal(camelCase.subtitleLanguageString, 'Japanese');
  assert.equal(camelCase.translationDecisionPending, true);

  const propagatedSameAsAudio = resolveSubtitleLanguageOption({
    subtitleLanguage: 'auto',
    subtitleLanguageExplicit: false,
  }, 'auto', { allowPropagatedSameAsAudio: true });
  assert.equal(propagatedSameAsAudio.subtitleLanguage, 'auto');
  assert.equal(propagatedSameAsAudio.subtitleLanguageExplicit, false);

  assert.throws(
    () => resolveSubtitleLanguageOption({ subtitle_language: 'auto' }, 'en'),
    /subtitle_language must be one of/,
  );
  assert.throws(
    () => resolveSubtitleLanguageOption({
      subtitle_language: 'auto',
      subtitleLanguageExplicit: false,
    }, 'auto'),
    /subtitle_language must be one of/,
  );
  assert.throws(
    () => resolveSubtitleLanguageOption({ subtitle_language: 'de' }, 'en'),
    /subtitle_language must be one of/,
  );
  assert.throws(
    () => resolveSubtitleLanguageOption({ subtitle_language: 42 }, 'en'),
    /subtitle_language must be one of/,
  );
});

test('explicit-language translation covers narrator and character speech only', async () => {
  const narrator = { type: 'speech', subType: 'narration', audio: 'Welcome.' };
  const character = { type: 'speech', subType: 'character', audio: 'Let us go.' };
  const soundEffect = { type: 'sound_effect', audio: 'Thunder cracks.' };
  const calls = [];

  const translated = await buildSpeechSubtitleTextMap(
    [narrator, soundEffect, character],
    {
      speechLanguageCode: 'en',
      subtitleLanguage: 'th',
      subtitleLanguageString: 'Thai',
      subtitleLanguageExplicit: true,
      inferenceModel: 'gemini-3.1-pro',
      translateSpeech: async (text, targetLanguage, inferenceModel) => {
        calls.push({ text, targetLanguage, inferenceModel });
        return `translated:${text}`;
      },
    },
  );

  assert.deepEqual(translated.get(narrator), {
    subtitleText: 'translated:Welcome.',
    subtitleLanguage: 'th',
    speechLanguage: 'en',
    subtitleTranslationRequired: true,
  });
  assert.deepEqual(translated.get(character), {
    subtitleText: 'translated:Let us go.',
    subtitleLanguage: 'th',
    speechLanguage: 'en',
    subtitleTranslationRequired: true,
  });
  assert.equal(translated.has(soundEffect), false);
  assert.deepEqual(calls, [
    { text: 'Welcome.', targetLanguage: 'Thai', inferenceModel: 'gemini-3.1-pro' },
    { text: 'Let us go.', targetLanguage: 'Thai', inferenceModel: 'gemini-3.1-pro' },
  ]);
});

test('same explicit speech and subtitle language preserves alignment without inference', async () => {
  const speech = { type: 'speech', subType: 'character', audio: 'Original speech.' };
  const subtitles = await buildSpeechSubtitleTextMap([speech], {
    speechLanguageCode: 'en',
    subtitleLanguage: 'en',
    subtitleLanguageString: 'English',
    subtitleLanguageExplicit: false,
    translateSpeech: () => {
      throw new Error('should not be called');
    },
  });

  const fields = buildSpeechSubtitleLayerFields(subtitles.get(speech));
  assert.equal(fields.subtitleText, 'Original speech.');
  assert.equal(fields.speechLanguage, 'en');
  assert.equal(fields.subtitleTranslationRequired, false);
  assert.equal(fields.addTranscriptionsRequired, true);
  assert.equal(fields.subtitleWordAnimation, 'highlight');
});

test('auto Japanese speech with explicit English subtitles translates narrator and character into static subtitles', async () => {
  const narrator = { type: 'speech', subType: 'narration', audio: '夜が明ける。' };
  const character = { type: 'speech', subType: 'character', audio: '行きましょう。' };
  const translations = new Map([
    [narrator.audio, 'Dawn breaks.'],
    [character.audio, "Let's go."],
  ]);
  const calls = [];

  const subtitles = await buildSpeechSubtitleTextMap([narrator, character], {
    speechLanguageCode: 'auto',
    subtitleLanguage: 'en',
    subtitleLanguageString: 'English',
    subtitleLanguageExplicit: true,
    inferenceModel: 'QWEN3.7',
    translateSpeech: async (text, targetLanguage, inferenceModel, options) => {
      calls.push({ text, targetLanguage, inferenceModel, options });
      return {
        text: translations.get(text),
        sourceLanguage: 'ja',
        translationRequired: true,
      };
    },
  });

  for (const speech of [narrator, character]) {
    const fields = buildSpeechSubtitleLayerFields(subtitles.get(speech));
    assert.equal(fields.subtitleText, translations.get(speech.audio));
    assert.equal(fields.speechLanguage, 'ja');
    assert.equal(fields.subtitleLanguage, 'en');
    assert.equal(fields.subtitleTranslationRequired, true);
    assert.equal(fields.addTranscriptionsRequired, false);
    assert.equal(fields.subtitleWordAnimation, 'none');
  }
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.inferenceModel === 'QWEN3.7'));
  assert.ok(calls.every((call) => call.options.detectSourceLanguage === true));
  assert.ok(calls.every((call) => call.options.targetLanguageCode === 'en'));
});

test('auto Japanese speech with explicit Japanese subtitles keeps exact narrator and character text animated', async () => {
  const narrator = { type: 'speech', subType: 'narration', audio: '夜が明ける。' };
  const character = { type: 'speech', subType: 'character', audio: '行きましょう。' };

  const subtitles = await buildSpeechSubtitleTextMap([narrator, character], {
    speechLanguageCode: 'auto',
    subtitleLanguage: 'ja',
    subtitleLanguageString: 'Japanese',
    subtitleLanguageExplicit: true,
    inferenceModel: 'gemini-3.1-pro',
    translateSpeech: async () => ({
      text: 'LLM must not replace same-language text.',
      sourceLanguage: 'jpn',
      translationRequired: false,
    }),
  });

  for (const speech of [narrator, character]) {
    const fields = buildSpeechSubtitleLayerFields(subtitles.get(speech));
    assert.equal(fields.subtitleText, speech.audio);
    assert.equal(fields.speechLanguage, 'ja');
    assert.equal(fields.subtitleLanguage, 'ja');
    assert.equal(fields.subtitleTranslationRequired, false);
    assert.equal(fields.addTranscriptionsRequired, true);
    assert.equal(fields.subtitleWordAnimation, 'highlight');
  }
});

test('omitted subtitle language with auto audio detects and follows each speech language', async () => {
  const speech = { type: 'speech', subType: 'narration', audio: '夜が明ける。' };
  const subtitles = await buildSpeechSubtitleTextMap([speech], {
    speechLanguageCode: 'auto',
    subtitleLanguage: 'auto',
    subtitleLanguageString: null,
    subtitleLanguageExplicit: false,
    translateSpeech: async (_text, targetLanguage, _model, options) => {
      assert.equal(targetLanguage, null);
      assert.equal(options.targetLanguageCode, null);
      return {
        text: 'must be ignored',
        sourceLanguage: 'ja',
        translationRequired: false,
      };
    },
  });

  const fields = buildSpeechSubtitleLayerFields(subtitles.get(speech));
  assert.equal(fields.subtitleText, speech.audio);
  assert.equal(fields.speechLanguage, 'ja');
  assert.equal(fields.subtitleLanguage, 'ja');
  assert.equal(fields.subtitleTranslationRequired, false);
  assert.equal(fields.addTranscriptionsRequired, true);
});
