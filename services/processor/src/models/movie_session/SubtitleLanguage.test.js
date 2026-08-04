import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applySubtitleLanguageSelectionForRerun,
  backfillTranslatedSubtitleMetadataForRerun,
  buildSpeechSubtitleLayerFields,
  buildSpeechSubtitleTextMap,
  normalizeDetectedSpeechLanguage,
  refreshSessionSubtitleTranslationRequired,
  resolveSpeechLanguageCode,
  resolveSubtitleEnablement,
  resolveSubtitleLanguageOption,
} from './SubtitleLanguage.js';

test('subtitle enablement preserves explicit choices and recognizes language intent', () => {
  assert.equal(resolveSubtitleEnablement({ enable_subtitles: true }), true);
  assert.equal(resolveSubtitleEnablement({ enableSubtitles: false }), false);
  assert.equal(resolveSubtitleEnablement({}), false);
  assert.equal(resolveSubtitleEnablement({}, { defaultEnabled: true }), true);
  assert.equal(resolveSubtitleEnablement({ subtitle_language: 'en' }), true);
  assert.equal(resolveSubtitleEnablement({ subtitleLanguage: 'TH' }), true);
});

test('subtitle enablement rejects contradictory disabled language requests', () => {
  assert.throws(
    () => resolveSubtitleEnablement({
      enable_subtitles: false,
      subtitle_language: 'en',
    }),
    /subtitle_language requires enable_subtitles to be true/,
  );
  assert.throws(
    () => resolveSubtitleEnablement({ enable_subtitles: 'true' }),
    /enable_subtitles\/add_subtitles must be a boolean/,
  );
});

test('subtitle rerun language selection invalidates stale translated metadata', () => {
  const musicLayer = {
    generationType: 'music',
    subtitleText: 'leave me alone',
  };
  const session = {
    sessionLanguage: 'zh',
    subtitleLanguage: 'fr',
    subtitleLanguageString: 'French',
    subtitleLanguageExplicit: true,
    subtitleTranslationRequired: true,
    audioLayers: [
      {
        generationType: 'speech',
        prompt: '今天我们出发。',
        speechLanguage: 'zh-CN',
        subtitleLanguage: 'fr',
        subtitleTranslationRequired: true,
        subtitleText: 'Nous partons aujourd\u2019hui.',
        subtitleAlignmentMap: [{ sourceText: '今天', translatedText: "aujourd'hui" }],
        speakerCharacterName: '导游',
        subtitleSpeakerCharacterName: 'Guide',
        addSubtitles: false,
        addTranscriptionsRequired: false,
        subtitleWordAnimation: 'none',
      },
      musicLayer,
    ],
  };

  const result = applySubtitleLanguageSelectionForRerun(session, {
    subtitle_language: 'EN-us',
  });

  assert.equal(result.selectionProvided, true);
  assert.equal(result.updatedAudioLayerCount, 1);
  assert.equal(result.subtitleLanguage, 'en');
  assert.equal(result.translationRequired, true);
  assert.equal(session.subtitleLanguage, 'en');
  assert.equal(session.subtitleLanguageString, 'English');
  assert.equal(session.subtitleLanguageExplicit, true);
  assert.equal(session.subtitleTranslationRequired, true);
  assert.deepEqual(session.audioLayers[0], {
    generationType: 'speech',
    prompt: '今天我们出发。',
    speechLanguage: 'zh',
    subtitleLanguage: 'en',
    subtitleTranslationRequired: true,
    subtitleText: null,
    subtitleAlignmentMap: [],
    speakerCharacterName: '导游',
    subtitleSpeakerCharacterName: null,
    addSubtitles: true,
    addTranscriptionsRequired: true,
    subtitleWordAnimation: 'highlight',
  });
  assert.deepEqual(musicLayer, {
    generationType: 'music',
    subtitleText: 'leave me alone',
  });
});

test('subtitle rerun language selection clears translation metadata when it matches speech', () => {
  const session = {
    sessionLanguage: 'ja',
    subtitleLanguage: 'en',
    subtitleTranslationRequired: true,
    audioLayers: [{
      generationType: 'speech',
      prompt: 'おはようございます。',
      speechLanguage: 'jpn',
      subtitleLanguage: 'en',
      subtitleTranslationRequired: true,
      subtitleText: 'Good morning.',
      subtitleAlignmentMap: [{ sourceText: 'おはよう', translatedText: 'Good morning' }],
      subtitleSpeakerCharacterName: 'Narrator',
    }],
  };

  const result = applySubtitleLanguageSelectionForRerun(session, {
    subtitleLanguage: 'JA',
  });

  assert.equal(result.translationRequired, false);
  assert.equal(session.subtitleLanguage, 'ja');
  assert.equal(session.subtitleLanguageString, 'Japanese');
  assert.equal(session.subtitleTranslationRequired, false);
  assert.equal(session.audioLayers[0].speechLanguage, 'ja');
  assert.equal(session.audioLayers[0].subtitleLanguage, 'ja');
  assert.equal(session.audioLayers[0].subtitleText, 'おはようございます。');
  assert.equal(session.audioLayers[0].subtitleTranslationRequired, false);
  assert.deepEqual(session.audioLayers[0].subtitleAlignmentMap, []);
  assert.equal(session.audioLayers[0].subtitleSpeakerCharacterName, null);
});

test('subtitle rerun language selection is backward compatible when omitted or blank', () => {
  const session = {
    sessionLanguage: 'en',
    subtitleLanguage: 'fr',
    subtitleTranslationRequired: true,
    audioLayers: [{
      generationType: 'speech',
      prompt: 'Hello.',
      subtitleLanguage: 'fr',
      subtitleText: 'Bonjour.',
      subtitleTranslationRequired: true,
    }],
  };
  const original = structuredClone(session);

  assert.equal(
    applySubtitleLanguageSelectionForRerun(session, {}).selectionProvided,
    false,
  );
  assert.equal(
    applySubtitleLanguageSelectionForRerun(session, { subtitle_language: '  ' })
      .selectionProvided,
    false,
  );
  assert.deepEqual(session, original);
});

test('subtitle rerun language validation is atomic', () => {
  const session = {
    sessionLanguage: 'en',
    subtitleLanguage: 'en',
    audioLayers: [{
      generationType: 'speech',
      prompt: 'Hello.',
      subtitleLanguage: 'en',
    }],
  };
  const original = structuredClone(session);

  assert.throws(
    () => applySubtitleLanguageSelectionForRerun(session, {
      subtitle_language: 'not-a-language',
    }),
    (error) => error.status === 400 && /subtitle_language must be one of/.test(error.message),
  );
  assert.throws(
    () => applySubtitleLanguageSelectionForRerun(session, { subtitleLanguage: 42 }),
    (error) => error.status === 400,
  );
  assert.deepEqual(session, original);
});

test('subtitle rerun language selection respects each speech layer language', () => {
  const session = {
    sessionLanguage: 'en',
    audioLayers: [
      { generationType: 'speech', prompt: 'Hello.', speechLanguage: 'en' },
      { generationType: 'speech', prompt: 'Bonjour.', speechLanguage: 'fr' },
      { generationType: 'speech', prompt: '言語不明。', speechLanguage: 'auto' },
    ],
  };

  applySubtitleLanguageSelectionForRerun(session, { subtitleLanguage: 'en' });

  assert.deepEqual(
    session.audioLayers.map((layer) => layer.subtitleTranslationRequired),
    [false, true, true],
  );
  assert.equal(refreshSessionSubtitleTranslationRequired(session), true);
  session.audioLayers[1].subtitleTranslationRequired = false;
  session.audioLayers[2].subtitleTranslationRequired = false;
  assert.equal(refreshSessionSubtitleTranslationRequired(session), false);
  assert.equal(session.subtitleTranslationRequired, false);
});

test('subtitle rerun backfills known-language translation metadata and preserves speaker identity', async () => {
  const speechLayer = {
    generationType: 'speech',
    prompt: 'Welcome home.',
    speechLanguage: 'en',
    subtitleLanguage: 'th',
    subtitleTranslationRequired: true,
    subtitleText: 'คำแปลเก่า',
    subtitleAlignmentMap: [],
    speakerCharacterName: 'Guide',
    subtitleSpeakerCharacterName: null,
    addTranscriptionsRequired: false,
    subtitleWordAnimation: 'none',
  };
  const calls = [];

  const result = await backfillTranslatedSubtitleMetadataForRerun([speechLayer], {
    sessionSpeechLanguage: 'en',
    sessionSubtitleLanguage: 'th',
    sessionSubtitleLanguageString: 'Thai',
    sessionTranslationRequired: true,
    inferenceModel: 'QWEN3.8',
    translateSpeech: async (text, targetLanguage, inferenceModel, options) => {
      calls.push({ text, targetLanguage, inferenceModel, options });
      return {
        text: 'ยินดีต้อนรับกลับบ้าน',
        subtitleAlignmentMap: [
          { sourceText: 'Welcome', translatedText: 'ยินดีต้อนรับ' },
          { sourceText: 'home.', translatedText: 'กลับบ้าน' },
        ],
        subtitleSpeakerCharacterName: 'ผู้นำทาง',
      };
    },
  });

  assert.equal(result.updatedCount, 1);
  assert.equal(speechLayer.subtitleText, 'ยินดีต้อนรับกลับบ้าน');
  assert.deepEqual(speechLayer.subtitleAlignmentMap, [
    { sourceText: 'Welcome', translatedText: 'ยินดีต้อนรับ' },
    { sourceText: 'home.', translatedText: 'กลับบ้าน' },
  ]);
  assert.equal(speechLayer.speakerCharacterName, 'Guide');
  assert.equal(speechLayer.subtitleSpeakerCharacterName, 'ผู้นำทาง');
  assert.equal(speechLayer.addTranscriptionsRequired, true);
  assert.equal(speechLayer.subtitleWordAnimation, 'highlight');
  assert.deepEqual(calls, [{
    text: 'Welcome home.',
    targetLanguage: 'Thai',
    inferenceModel: 'QWEN3.8',
    options: {
      targetLanguageCode: 'th',
      includeSubtitleAlignment: true,
      speakerCharacterName: 'Guide',
    },
  }]);
});

test('subtitle rerun skips complete translated metadata', async () => {
  const speechLayer = {
    generationType: 'speech',
    prompt: 'Hello.',
    speechLanguage: 'en',
    subtitleLanguage: 'fr',
    subtitleTranslationRequired: true,
    subtitleText: 'Bonjour.',
    subtitleAlignmentMap: [{ sourceText: 'Hello.', translatedText: 'Bonjour.' }],
    speakerCharacterName: 'Host',
    subtitleSpeakerCharacterName: 'Hôte',
    addTranscriptionsRequired: true,
    subtitleWordAnimation: 'highlight',
  };

  const result = await backfillTranslatedSubtitleMetadataForRerun([speechLayer], {
    sessionSubtitleLanguage: 'fr',
    sessionTranslationRequired: true,
    translateSpeech: () => {
      throw new Error('should not be called');
    },
  });

  assert.equal(result.updatedCount, 0);
  assert.equal(speechLayer.subtitleText, 'Bonjour.');
});

test('subtitle rerun regenerates a nonempty legacy map that does not cover its text', async () => {
  const speechLayer = {
    generationType: 'speech',
    prompt: 'Hello world.',
    speechLanguage: 'en',
    subtitleLanguage: 'fr',
    subtitleTranslationRequired: true,
    subtitleText: 'Bonjour le monde.',
    subtitleAlignmentMap: [{ sourceText: 'Hello', translatedText: 'Bonjour' }],
    addTranscriptionsRequired: true,
    subtitleWordAnimation: 'highlight',
  };
  let inferenceCalled = false;

  const result = await backfillTranslatedSubtitleMetadataForRerun([speechLayer], {
    sessionSubtitleLanguage: 'fr',
    translateSpeech: async () => {
      inferenceCalled = true;
      return {
        text: 'Salut tout le monde.',
        subtitleAlignmentMap: [
          { sourceText: 'Hello', translatedText: 'Salut' },
          { sourceText: 'world.', translatedText: 'tout le monde.' },
        ],
        subtitleSpeakerCharacterName: null,
      };
    },
  });

  assert.equal(inferenceCalled, true);
  assert.equal(result.updatedCount, 1);
  assert.equal(speechLayer.subtitleText, 'Salut tout le monde.');
  assert.deepEqual(speechLayer.subtitleAlignmentMap, [
    { sourceText: 'Hello', translatedText: 'Salut' },
    { sourceText: 'world.', translatedText: 'tout le monde.' },
  ]);
});

test('subtitle rerun backfills translated speech without a speaker label', async () => {
  const speechLayer = {
    generationType: 'speech',
    prompt: 'We begin.',
    speechLanguage: 'en',
    subtitleLanguage: 'fr',
    subtitleTranslationRequired: true,
    subtitleText: 'Nous commençons.',
    subtitleAlignmentMap: [],
  };

  const result = await backfillTranslatedSubtitleMetadataForRerun([speechLayer], {
    sessionSubtitleLanguage: 'fr',
    inferenceModel: 'gemini-3.1-pro',
    translateSpeech: async (_text, _targetLanguage, _inferenceModel, options) => {
      assert.equal(options.speakerCharacterName, '');
      return {
        text: 'Nous commençons.',
        subtitleAlignmentMap: [{
          sourceText: 'We begin.',
          translatedText: 'Nous commençons.',
        }],
        subtitleSpeakerCharacterName: null,
      };
    },
  });

  assert.equal(result.updatedCount, 1);
  assert.equal(speechLayer.subtitleSpeakerCharacterName, null);
  assert.equal(speechLayer.speakerCharacterName, undefined);
  assert.equal(speechLayer.subtitleWordAnimation, 'highlight');
});

test('subtitle rerun detects an unknown source language while backfilling metadata', async () => {
  const speechLayer = {
    generationType: 'speech',
    prompt: '夜が明ける。',
    speechLanguage: null,
    languageCode: 'auto',
    subtitleLanguage: 'en',
    subtitleTranslationRequired: true,
    subtitleText: 'Dawn breaks.',
    subtitleAlignmentMap: [],
  };

  await backfillTranslatedSubtitleMetadataForRerun([speechLayer], {
    sessionSpeechLanguage: 'auto',
    sessionSubtitleLanguage: 'en',
    sessionTranslationRequired: true,
    inferenceModel: 'gemini-3.1-pro',
    translateSpeech: async (_text, targetLanguage, _inferenceModel, options) => {
      assert.equal(targetLanguage, 'English');
      assert.equal(options.detectSourceLanguage, true);
      assert.equal(options.returnMetadata, true);
      return {
        text: 'Dawn breaks.',
        sourceLanguage: 'jpn',
        translationRequired: true,
        subtitleAlignmentMap: [{ sourceText: '夜が明ける。', translatedText: 'Dawn breaks.' }],
        subtitleSpeakerCharacterName: null,
      };
    },
  });

  assert.equal(speechLayer.speechLanguage, 'ja');
  assert.equal(speechLayer.subtitleLanguage, 'en');
  assert.equal(speechLayer.subtitleTranslationRequired, true);
  assert.deepEqual(speechLayer.subtitleAlignmentMap, [
    { sourceText: '夜が明ける。', translatedText: 'Dawn breaks.' },
  ]);
});

test('subtitle rerun applies no partial metadata when a later backfill fails', async () => {
  const audioLayers = [
    {
      generationType: 'speech',
      prompt: 'First.',
      speechLanguage: 'en',
      subtitleLanguage: 'fr',
      subtitleTranslationRequired: true,
      subtitleText: 'Old first.',
      subtitleAlignmentMap: [],
    },
    {
      generationType: 'speech',
      prompt: 'Second.',
      speechLanguage: 'en',
      subtitleLanguage: 'fr',
      subtitleTranslationRequired: true,
      subtitleText: 'Old second.',
      subtitleAlignmentMap: [],
    },
  ];
  const before = structuredClone(audioLayers);
  let callCount = 0;

  await assert.rejects(
    backfillTranslatedSubtitleMetadataForRerun(audioLayers, {
      sessionSubtitleLanguage: 'fr',
      translateSpeech: async (text) => {
        callCount += 1;
        if (callCount === 2) {
          throw new Error('inference failed');
        }
        return {
          text: 'Premier.',
          subtitleAlignmentMap: [{ sourceText: text, translatedText: 'Premier.' }],
          subtitleSpeakerCharacterName: null,
        };
      },
    }),
    /inference failed/,
  );

  assert.deepEqual(audioLayers, before);
});

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
  const narrator = {
    type: 'speech',
    subType: 'narration',
    audio: 'Welcome.',
    speakerCharacterName: 'Narrator',
  };
  const character = {
    type: 'speech',
    subType: 'character',
    audio: 'Let us go.',
    speakerCharacterName: 'Guide',
  };
  const soundEffect = { type: 'sound_effect', audio: 'Thunder cracks.' };
  const calls = [];
  const resultByText = new Map([
    [narrator.audio, {
      text: 'ยินดีต้อนรับ',
      subtitleAlignmentMap: [{ sourceText: 'Welcome.', translatedText: 'ยินดีต้อนรับ' }],
      subtitleSpeakerCharacterName: 'ผู้บรรยาย',
    }],
    [character.audio, {
      text: 'ไปกันเถอะ',
      subtitleAlignmentMap: [
        { sourceText: 'Let us', translatedText: 'ไปกัน' },
        { sourceText: 'go.', translatedText: 'เถอะ' },
      ],
      subtitleSpeakerCharacterName: 'ผู้นำทาง',
    }],
  ]);

  const translated = await buildSpeechSubtitleTextMap(
    [narrator, soundEffect, character],
    {
      speechLanguageCode: 'en',
      subtitleLanguage: 'th',
      subtitleLanguageString: 'Thai',
      subtitleLanguageExplicit: true,
      inferenceModel: 'gemini-3.1-pro',
      translateSpeech: async (text, targetLanguage, inferenceModel, options) => {
        calls.push({ text, targetLanguage, inferenceModel, options });
        return resultByText.get(text);
      },
    },
  );

  assert.deepEqual(translated.get(narrator), {
    subtitleText: 'ยินดีต้อนรับ',
    subtitleLanguage: 'th',
    speechLanguage: 'en',
    subtitleTranslationRequired: true,
    subtitleAlignmentMap: [{ sourceText: 'Welcome.', translatedText: 'ยินดีต้อนรับ' }],
    subtitleSpeakerCharacterName: 'ผู้บรรยาย',
  });
  assert.deepEqual(translated.get(character), {
    subtitleText: 'ไปกันเถอะ',
    subtitleLanguage: 'th',
    speechLanguage: 'en',
    subtitleTranslationRequired: true,
    subtitleAlignmentMap: [
      { sourceText: 'Let us', translatedText: 'ไปกัน' },
      { sourceText: 'go.', translatedText: 'เถอะ' },
    ],
    subtitleSpeakerCharacterName: 'ผู้นำทาง',
  });
  assert.equal(translated.has(soundEffect), false);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(({ text, targetLanguage, inferenceModel }) => ({
    text,
    targetLanguage,
    inferenceModel,
  })), [
    { text: 'Welcome.', targetLanguage: 'Thai', inferenceModel: 'gemini-3.1-pro' },
    { text: 'Let us go.', targetLanguage: 'Thai', inferenceModel: 'gemini-3.1-pro' },
  ]);
  assert.ok(calls.every((call) => call.options.includeSubtitleAlignment === true));
  assert.deepEqual(
    calls.map((call) => call.options.speakerCharacterName),
    ['Narrator', 'Guide'],
  );
  const characterFields = buildSpeechSubtitleLayerFields(translated.get(character));
  assert.deepEqual(characterFields.subtitleAlignmentMap, [
    { sourceText: 'Let us', translatedText: 'ไปกัน' },
    { sourceText: 'go.', translatedText: 'เถอะ' },
  ]);
  assert.equal(characterFields.subtitleSpeakerCharacterName, 'ผู้นำทาง');
  assert.equal(characterFields.addTranscriptionsRequired, true);
  assert.equal(characterFields.subtitleWordAnimation, 'highlight');
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
  assert.deepEqual(fields.subtitleAlignmentMap, []);
  assert.equal(fields.subtitleSpeakerCharacterName, null);
  assert.equal(fields.addTranscriptionsRequired, true);
  assert.equal(fields.subtitleWordAnimation, 'highlight');
});

test('auto Japanese speech with explicit English subtitles keeps mapped word animation enabled', async () => {
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
    inferenceModel: 'QWEN3.8',
    translateSpeech: async (text, targetLanguage, inferenceModel, options) => {
      calls.push({ text, targetLanguage, inferenceModel, options });
      return {
        text: translations.get(text),
        sourceLanguage: 'ja',
        translationRequired: true,
        subtitleAlignmentMap: [{ sourceText: text, translatedText: translations.get(text) }],
        subtitleSpeakerCharacterName: null,
      };
    },
  });

  for (const speech of [narrator, character]) {
    const fields = buildSpeechSubtitleLayerFields(subtitles.get(speech));
    assert.equal(fields.subtitleText, translations.get(speech.audio));
    assert.equal(fields.speechLanguage, 'ja');
    assert.equal(fields.subtitleLanguage, 'en');
    assert.equal(fields.subtitleTranslationRequired, true);
    assert.deepEqual(fields.subtitleAlignmentMap, [{
      sourceText: speech.audio,
      translatedText: translations.get(speech.audio),
    }]);
    assert.equal(fields.addTranscriptionsRequired, true);
    assert.equal(fields.subtitleWordAnimation, 'highlight');
  }
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.inferenceModel === 'QWEN3.8'));
  assert.ok(calls.every((call) => call.options.detectSourceLanguage === true));
  assert.ok(calls.every((call) => call.options.targetLanguageCode === 'en'));
  assert.ok(calls.every((call) => call.options.includeSubtitleAlignment === true));
});

test('translated subtitles reject missing mappings and missing localized speaker names', async () => {
  const speech = {
    type: 'speech',
    subType: 'character',
    audio: 'We begin.',
    speakerCharacterName: 'Host',
  };
  const baseOptions = {
    speechLanguageCode: 'en',
    subtitleLanguage: 'fr',
    subtitleLanguageString: 'French',
    subtitleLanguageExplicit: true,
  };

  await assert.rejects(
    buildSpeechSubtitleTextMap([speech], {
      ...baseOptions,
      translateSpeech: async () => ({ text: 'Nous commençons.' }),
    }),
    /empty alignment map/,
  );

  await assert.rejects(
    buildSpeechSubtitleTextMap([speech], {
      ...baseOptions,
      translateSpeech: async () => ({
        text: 'Nous commençons.',
        subtitleAlignmentMap: [{
          sourceText: 'We begin.',
          translatedText: 'Nous commençons.',
        }],
      }),
    }),
    /empty localized speaker name/,
  );
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
