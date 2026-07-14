import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getSubtitleTranslationContext,
  isMappedTranslatedSubtitleItem,
  mapSubtitleAlignmentToTimedWords,
  normalizeComparableSubtitleLanguage,
  prepareLayerSubtitlesForRendering,
  splitMappedSubtitlePhraseTimings,
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

test('malformed translated mapping falls back to the audio-layer target text', () => {
  const layer = {
    imageSession: {
      activeItemList: [
        {
          type: 'text',
          subType: 'subtitle',
          text: 'HELLO WORLD',
          audioLayerId: 'audio-1',
          speaker: 'Narrator',
          config: { fontFamily: 'Poppins', speakerFontFamily: 'Arial' },
          words: [
            { word: 'HELLO', frameOffset: 0, frameDuration: 8 },
            { word: 'WORLD', frameOffset: 8, frameDuration: 8 },
          ],
          wordAnimation: 'highlight',
        },
      ],
    },
  };
  const session = {
    enableSubtitles: true,
    audioLayers: [
      {
        _id: 'audio-1',
        speechLanguage: 'en',
        subtitleLanguage: 'th',
        subtitleTranslationRequired: true,
        subtitleText: 'สวัสดีชาวโลก',
        subtitleSpeakerCharacterName: 'ผู้บรรยาย',
        subtitleAlignmentMap: [
          { sourceText: 'Hello world' },
        ],
      },
    ],
  };

  const item = prepareLayerSubtitlesForRendering(layer, session)
    .imageSession.activeItemList[0];

  assert.equal(item.subtitleRenderMode, 'static');
  assert.equal(item.isStaticSubtitle, true);
  assert.equal(item.text, 'สวัสดีชาวโลก');
  assert.notEqual(item.text, 'HELLO WORLD');
  assert.equal(item.speaker, 'ผู้บรรยาย');
  assert.equal(item.config.fontFamily, 'Sarabun');
  assert.equal(item.config.speakerFontFamily, 'Sarabun');
  assert.deepEqual(item.words, []);
});

test('unresolved translated mapping falls back to normalized mapped text instead of source text', () => {
  const layer = {
    imageSession: {
      activeItemList: [
        {
          type: 'text',
          subType: 'subtitle',
          text: 'HELLO WORLD',
          audioLayerId: 'audio-1',
          config: { fontFamily: 'Poppins' },
          words: [
            { word: 'HELLO', frameOffset: 0, frameDuration: 8 },
            { word: 'WORLD', frameOffset: 8, frameDuration: 8 },
          ],
        },
      ],
    },
  };
  const session = {
    enableSubtitles: true,
    audioLayers: [
      {
        _id: 'audio-1',
        speechLanguage: 'en',
        subtitleLanguage: 'fr',
        subtitleTranslationRequired: true,
        subtitleAlignmentMap: [
          { sourceText: 'Different source', translatedText: 'Texte différent' },
        ],
      },
    ],
  };

  const item = prepareLayerSubtitlesForRendering(layer, session)
    .imageSession.activeItemList[0];

  assert.equal(item.subtitleRenderMode, 'static');
  assert.equal(item.text, 'Texte différent');
  assert.notEqual(item.text, 'HELLO WORLD');
  assert.deepEqual(item.words, []);
});

test('listener-provided static translated segments retain their segment text', () => {
  const layer = {
    imageSession: {
      activeItemList: [
        {
          type: 'text',
          subType: 'subtitle',
          text: 'Bonjour',
          audioLayerId: 'audio-1',
          subtitleRenderMode: 'static',
          isStaticSubtitle: true,
          subtitleLanguage: 'fr',
          audioLanguage: 'en',
          config: { fontFamily: 'Poppins', staticSubtitle: true },
          words: [],
        },
      ],
    },
  };
  const session = {
    enableSubtitles: true,
    audioLayers: [
      {
        _id: 'audio-1',
        speechLanguage: 'en',
        subtitleLanguage: 'fr',
        subtitleTranslationRequired: true,
        subtitleText: 'Bonjour le monde',
      },
    ],
  };

  const item = prepareLayerSubtitlesForRendering(layer, session)
    .imageSession.activeItemList[0];

  assert.equal(item.subtitleRenderMode, 'static');
  assert.equal(item.text, 'Bonjour');
  assert.notEqual(item.text, 'Bonjour le monde');
});

test('canonical translation mappings inherit the source speech timing and use mapped rendering', () => {
  const layer = {
    imageSession: {
      activeItemList: [
        {
          type: 'text',
          subType: 'subtitle',
          text: 'Hello world',
          audioLayerId: 'audio-1',
          speaker: 'Narrator',
          showSpeaker: true,
          config: {
            fontFamily: 'Poppins',
            speakerFontFamily: 'Arial',
            autoWrap: false,
            breakTextWidth: 824,
          },
          words: [
            { word: 'Hello', frameOffset: 48, frameDuration: 12 },
            { word: 'world', frameOffset: 60, frameDuration: 15 },
          ],
          animations: [{ type: 'typewriter', startFrame: 0, endFrame: 24 }],
          wordAnimation: 'highlight',
        },
      ],
    },
  };
  const session = {
    enableSubtitles: true,
    framesPerSecond: 24,
    audioLayers: [
      {
        _id: 'audio-1',
        speechLanguage: 'en',
        subtitleLanguage: 'th',
        subtitleTranslationRequired: true,
        subtitleText: 'สวัสดีโลก',
        subtitleSpeakerCharacterName: 'ผู้บรรยาย',
        subtitleAlignmentMap: [
          { sourceText: 'Hello', translatedText: 'สวัสดี' },
          { sourceText: 'world', translatedText: 'โลก' },
        ],
      },
    ],
  };

  const item = prepareLayerSubtitlesForRendering(layer, session)
    .imageSession.activeItemList[0];

  assert.equal(isMappedTranslatedSubtitleItem(item), true);
  assert.equal(item.isStaticSubtitle, false);
  assert.equal(item.subtitleRenderMode, 'translated_cue');
  assert.equal(item.subtitleTimingMapped, true);
  assert.equal(item.subtitleAlignmentMapped, true);
  assert.equal(item.text, 'สวัสดีโลก');
  assert.deepEqual(
    item.words.map(({ word, frameOffset, frameDuration, joinerBefore }) => ({
      word,
      frameOffset,
      frameDuration,
      joinerBefore,
    })),
    [
      { word: 'สวัสดี', frameOffset: 48, frameDuration: 12, joinerBefore: '' },
      { word: 'โลก', frameOffset: 60, frameDuration: 15, joinerBefore: '' },
    ],
  );
  assert.equal(item.config.fontFamily, 'Sarabun');
  assert.equal(item.config.speakerFontFamily, 'Sarabun');
  assert.equal(item.config.autoWrap, true);
  assert.equal(item.config.breakLongWords, true);
  assert.equal(item.speaker, 'ผู้บรรยาย');
  assert.equal(item.wordAnimation, 'highlight');
  assert.deepEqual(item.animations, []);
});

test('a translated phrase inherits the full span of its mapped source words', () => {
  const mappedWords = mapSubtitleAlignmentToTimedWords(
    [
      { word: 'Good', frameOffset: 10, frameDuration: 6 },
      { word: 'morning', frameOffset: 16, frameDuration: 9 },
    ],
    [{ sourceText: 'Good morning', targetText: 'Bonjour' }],
    { subtitleLanguage: 'fr' },
  );

  assert.deepEqual(mappedWords, [
    {
      word: 'Bonjour',
      frameOffset: 10,
      frameDuration: 15,
      sourceText: 'Good morning',
      translatedText: 'Bonjour',
      sourceWordStartIndex: 0,
      sourceWordEndIndex: 1,
      mappingIndex: 0,
      joinerBefore: '',
    },
  ]);
});

test('partial source words select a later ordered slice from a full alignment map', () => {
  const mappedWords = mapSubtitleAlignmentToTimedWords(
    [
      { word: 'Goodbye', frameOffset: 30, frameDuration: 8 },
      { word: 'now', frameOffset: 38, frameDuration: 6 },
    ],
    [
      { sourceText: 'Hello', translatedText: 'Bonjour' },
      { sourceText: 'there', translatedText: 'là' },
      { sourceText: 'Goodbye', translatedText: 'Au revoir' },
      { sourceText: 'now', translatedText: 'maintenant' },
    ],
    { subtitleLanguage: 'fr' },
  );

  assert.deepEqual(
    mappedWords.map(({ word, frameOffset, frameDuration, mappingIndex }) => ({
      word,
      frameOffset,
      frameDuration,
      mappingIndex,
    })),
    [
      { word: 'Au revoir', frameOffset: 30, frameDuration: 8, mappingIndex: 2 },
      { word: 'maintenant', frameOffset: 38, frameDuration: 6, mappingIndex: 3 },
    ],
  );
});

test('two manual source segments select translated text from one full cached alignment map', () => {
  const session = {
    enableSubtitles: true,
    framesPerSecond: 20,
    audioLayers: [
      {
        _id: 'audio-1',
        speechLanguage: 'en',
        subtitleLanguage: 'fr',
        subtitleTranslationRequired: true,
        subtitleText: 'Bonjour là. Salut encore.',
        startTime: 0,
        transcriptAlignment: {
          words: [
            { word: 'Hello', start: 0, end: 0.25 },
            { word: 'there', start: 0.25, end: 0.5 },
            { word: 'Hello', start: 0.5, end: 0.75 },
            { word: 'again', start: 0.75, end: 1 },
          ],
        },
        subtitleAlignmentMap: [
          { sourceText: 'Hello', translatedText: 'Bonjour' },
          { sourceText: 'there', translatedText: 'là' },
          { sourceText: 'Hello', translatedText: 'Salut' },
          { sourceText: 'again', translatedText: 'encore' },
        ],
      },
    ],
  };
  const createManualLayer = (text, words) => ({
    imageSession: {
      activeItemList: [
        {
          type: 'text',
          subType: 'subtitle',
          text,
          audioLayerId: 'audio-1',
          config: {
            fontFamily: 'Poppins',
            autoWrap: true,
            frameOffset: words[0].frameOffset,
            frameDuration:
              words.at(-1).frameOffset + words.at(-1).frameDuration - words[0].frameOffset,
          },
          words,
          wordAnimation: 'highlight',
          breakTextWidth: 800,
        },
      ],
    },
  });

  const firstLayer = createManualLayer('HELLO THERE', [
    { word: 'HELLO', frameOffset: 0, frameDuration: 5 },
    { word: 'THERE', frameOffset: 5, frameDuration: 5 },
  ]);
  const secondLayer = createManualLayer('HELLO AGAIN', [
    { word: 'HELLO', frameOffset: 10, frameDuration: 5 },
    { word: 'AGAIN', frameOffset: 15, frameDuration: 5 },
  ]);

  const firstItem = prepareLayerSubtitlesForRendering(firstLayer, session)
    .imageSession.activeItemList[0];
  const secondItem = prepareLayerSubtitlesForRendering(secondLayer, session)
    .imageSession.activeItemList[0];

  assert.equal(firstItem.subtitleRenderMode, 'translated_cue');
  assert.equal(firstItem.text, 'Bonjour là');
  assert.deepEqual(
    firstItem.words.map(({ word, frameOffset, mappingIndex }) => ({
      word,
      frameOffset,
      mappingIndex,
    })),
    [
      { word: 'Bonjour', frameOffset: 0, mappingIndex: 0 },
      { word: 'là', frameOffset: 5, mappingIndex: 1 },
    ],
  );

  assert.equal(secondItem.subtitleRenderMode, 'translated_cue');
  assert.equal(secondItem.text, 'Salut encore');
  assert.deepEqual(
    secondItem.words.map(({ word, frameOffset, mappingIndex }) => ({
      word,
      frameOffset,
      mappingIndex,
    })),
    [
      { word: 'Salut', frameOffset: 10, mappingIndex: 2 },
      { word: 'encore', frameOffset: 15, mappingIndex: 3 },
    ],
  );
  assert.equal(secondItem.config.fontFamily, 'Poppins');
  assert.equal(secondItem.config.breakTextWidth, 800);
  assert.equal(secondItem.isStaticSubtitle, false);
});

test('one translated mapping spanning two source items becomes one cue with one combined range', () => {
  const session = {
    enableSubtitles: true,
    framesPerSecond: 24,
    audioLayers: [
      {
        _id: 'audio-1',
        speechLanguage: 'en',
        subtitleLanguage: 'fr',
        startTime: 0,
        transcriptAlignment: {
          words: [
            { word: 'Good', start: 0, end: 0.5 },
            { word: 'morning', start: 0.5, end: 1 },
          ],
        },
        subtitleAlignmentMap: [
          { sourceText: 'Good morning', translatedText: 'Bonjour' },
        ],
      },
    ],
  };
  const sourceItem = (text, frameOffset) => ({
    type: 'text',
    subType: 'subtitle',
    text,
    audioLayerId: 'audio-1',
    config: {
      fontFamily: 'Poppins',
      frameOffset,
      frameDuration: 12,
    },
    words: [{ word: text, frameOffset, frameDuration: 12 }],
    wordAnimation: 'highlight',
  });
  const layer = {
    imageSession: {
      activeItemList: [
        sourceItem('Good', 0),
        sourceItem('morning', 12),
      ],
    },
  };

  const preparedItems = prepareLayerSubtitlesForRendering(layer, session)
    .imageSession.activeItemList;

  assert.equal(preparedItems.length, 1);
  const [item] = preparedItems;
  assert.equal(item.subtitleRenderMode, 'translated_cue');
  assert.equal(isMappedTranslatedSubtitleItem(item), true);
  assert.equal(item.text, 'Bonjour');
  assert.equal(item.config.frameOffset, 0);
  assert.equal(item.config.frameDuration, 24);
  assert.deepEqual(
    item.words.map(({ word, frameOffset, frameDuration, mappingIndex }) => ({
      word,
      frameOffset,
      frameDuration,
      mappingIndex,
    })),
    [
      { word: 'Bonjour', frameOffset: 0, frameDuration: 24, mappingIndex: 0 },
    ],
  );
});

test('failed translated mapping across source items emits one full-text static fallback', () => {
  const session = {
    enableSubtitles: true,
    audioLayers: [
      {
        _id: 'audio-1',
        speechLanguage: 'en',
        subtitleLanguage: 'fr',
        subtitleText: 'Bonjour tout le monde',
        subtitleAlignmentMap: [
          { sourceText: 'Unrelated source', translatedText: 'Bonjour tout le monde' },
        ],
      },
    ],
  };
  const sourceItem = (text, frameOffset) => ({
    type: 'text',
    subType: 'subtitle',
    text,
    audioLayerId: 'audio-1',
    config: { frameOffset, frameDuration: 12 },
    words: [{ word: text, frameOffset, frameDuration: 12 }],
  });
  const layer = {
    imageSession: {
      activeItemList: [
        sourceItem('Hello', 0),
        sourceItem('world', 12),
      ],
    },
  };

  const preparedItems = prepareLayerSubtitlesForRendering(layer, session)
    .imageSession.activeItemList;

  assert.equal(preparedItems.length, 1);
  assert.equal(preparedItems[0].subtitleRenderMode, 'static');
  assert.equal(preparedItems[0].text, 'Bonjour tout le monde');
  assert.deepEqual(preparedItems[0].words, []);
  assert.equal(preparedItems[0].config.frameOffset, 0);
  assert.equal(preparedItems[0].config.frameDuration, 24);
});

test('partially mapped translated source items use one complete static fallback', () => {
  const layer = {
    imageSession: {
      activeItemList: [
        {
          type: 'text',
          subType: 'subtitle',
          text: 'Hello',
          audioLayerId: 'audio-1',
          config: { frameOffset: 0, frameDuration: 10 },
          words: [{ word: 'Hello', frameOffset: 0, frameDuration: 10 }],
        },
        {
          type: 'text',
          subType: 'subtitle',
          text: 'unmapped',
          audioLayerId: 'audio-1',
          config: { frameOffset: 10, frameDuration: 10 },
          words: [{ word: 'unmapped', frameOffset: 10, frameDuration: 10 }],
        },
      ],
    },
  };
  const session = {
    enableSubtitles: true,
    audioLayers: [{
      _id: 'audio-1',
      speechLanguage: 'en',
      subtitleLanguage: 'fr',
      subtitleText: 'Bonjour texte complet',
      subtitleAlignmentMap: [{ sourceText: 'Hello', translatedText: 'Bonjour' }],
    }],
  };

  const items = prepareLayerSubtitlesForRendering(layer, session)
    .imageSession.activeItemList;

  assert.equal(items.length, 1);
  assert.equal(items[0].subtitleRenderMode, 'static');
  assert.equal(items[0].text, 'Bonjour texte complet');
  assert.equal(items[0].config.frameOffset, 0);
  assert.equal(items[0].config.frameDuration, 20);
});

test('explicit translated static segments remain independently scoped', () => {
  const createStaticItem = (text, frameOffset) => ({
    type: 'text',
    subType: 'subtitle',
    text,
    audioLayerId: 'audio-1',
    subtitleRenderMode: 'static',
    isStaticSubtitle: true,
    subtitleLanguage: 'fr',
    audioLanguage: 'en',
    config: { frameOffset, frameDuration: 10, staticSubtitle: true },
    words: [],
  });
  const layer = {
    imageSession: {
      activeItemList: [
        createStaticItem('PREMIER', 0),
        createStaticItem('DEUXIÈME', 10),
      ],
    },
  };
  const session = {
    enableSubtitles: true,
    audioLayers: [{
      _id: 'audio-1',
      speechLanguage: 'en',
      subtitleLanguage: 'fr',
      subtitleText: 'Premier. Deuxième.',
    }],
  };

  const items = prepareLayerSubtitlesForRendering(layer, session)
    .imageSession.activeItemList;

  assert.deepEqual(items.map((item) => item.text), ['PREMIER', 'DEUXIÈME']);
  assert.deepEqual(items.map((item) => item.config.frameOffset), [0, 10]);
  assert.deepEqual(items.map((item) => item.config.frameDuration), [10, 10]);
});

test('segment-local mapping indexes do not collapse unrelated translated phrases', () => {
  const createMappedItem = ({ text, sourceText, frameOffset }) => ({
    type: 'text',
    subType: 'subtitle',
    text,
    audioLayerId: 'audio-1',
    subtitleRenderMode: 'mapped',
    subtitleAlignmentMapped: true,
    subtitleLanguage: 'fr',
    audioLanguage: 'en',
    config: { frameOffset, frameDuration: 10 },
    words: [{
      word: text,
      translatedText: text,
      sourceText,
      mappingIndex: 0,
      frameOffset,
      frameDuration: 10,
    }],
  });
  const layer = {
    imageSession: {
      activeItemList: [
        createMappedItem({ text: 'BONJOUR', sourceText: 'Hello', frameOffset: 0 }),
        createMappedItem({ text: 'AU REVOIR', sourceText: 'Goodbye', frameOffset: 10 }),
      ],
    },
  };
  const session = {
    enableSubtitles: true,
    audioLayers: [{
      _id: 'audio-1',
      speechLanguage: 'en',
      subtitleLanguage: 'fr',
    }],
  };

  const [item] = prepareLayerSubtitlesForRendering(layer, session)
    .imageSession.activeItemList;

  assert.deepEqual(item.words.map((wordInfo) => wordInfo.word), ['BONJOUR', 'AU REVOIR']);
  assert.equal(item.subtitleTimingBase, 'session');
});

test('temporally disjoint repeated phrases remain separate translated cues', () => {
  const createMappedItem = (frameOffset) => ({
    type: 'text',
    subType: 'subtitle',
    text: 'HELLO',
    audioLayerId: 'audio-1',
    subtitleRenderMode: 'mapped',
    subtitleAlignmentMapped: true,
    subtitleLanguage: 'en',
    audioLanguage: 'zh',
    config: { frameOffset, frameDuration: 4 },
    words: [{
      word: 'HELLO',
      translatedText: 'HELLO',
      sourceText: '你好',
      mappingIndex: 0,
      frameOffset,
      frameDuration: 4,
    }],
  });
  const layer = {
    imageSession: {
      activeItemList: [createMappedItem(0), createMappedItem(20)],
    },
  };
  const session = {
    enableSubtitles: true,
    audioLayers: [{
      _id: 'audio-1',
      speechLanguage: 'zh',
      subtitleLanguage: 'en',
    }],
  };

  const [item] = prepareLayerSubtitlesForRendering(layer, session)
    .imageSession.activeItemList;

  assert.deepEqual(
    item.words.map(({ word, frameOffset, frameDuration }) => ({
      word,
      frameOffset,
      frameDuration,
    })),
    [
      { word: 'HELLO', frameOffset: 0, frameDuration: 4 },
      { word: 'HELLO', frameOffset: 20, frameDuration: 4 },
    ],
  );
  assert.notEqual(
    item.words[0].translatedCueIdentity,
    item.words[1].translatedCueIdentity,
  );
});

test('listener-provided mapped segment text and timings remain segment-scoped', () => {
  const layer = {
    imageSession: {
      activeItemList: [
        {
          type: 'text',
          subType: 'subtitle',
          text: 'BONJOUR',
          audioLayerId: 'audio-1',
          subtitleRenderMode: 'mapped',
          subtitleAlignmentMapped: true,
          subtitleLanguage: 'fr',
          audioLanguage: 'en',
          subtitleText: 'BONJOUR LE MONDE',
          config: { fontFamily: 'Poppins', autoWrap: true },
          words: [{ word: 'BONJOUR', frameOffset: 24, frameDuration: 12 }],
          wordAnimation: 'highlight',
        },
      ],
    },
  };
  const session = {
    enableSubtitles: true,
    audioLayers: [
      {
        _id: 'audio-1',
        speechLanguage: 'en',
        subtitleLanguage: 'fr',
        subtitleText: 'BONJOUR LE MONDE',
        subtitleAlignmentMap: [
          { sourceText: 'Hello', translatedText: 'Bonjour' },
          { sourceText: 'world', translatedText: 'le monde' },
        ],
      },
    ],
  };

  const item = prepareLayerSubtitlesForRendering(layer, session)
    .imageSession.activeItemList[0];

  assert.equal(item.text, 'BONJOUR');
  assert.deepEqual(item.words.map((wordInfo) => wordInfo.word), ['BONJOUR']);
  assert.equal(item.words[0].frameOffset, 24);
  assert.equal(item.subtitleRenderMode, 'translated_cue');
});

test('cached source transcript timings can drive mapped subtitle phrases', () => {
  const layer = {
    imageSession: {
      activeItemList: [
        {
          type: 'text',
          subType: 'subtitle',
          text: 'Hello',
          audioLayerId: 'audio-1',
          config: { fontFamily: 'Poppins' },
          words: [],
        },
      ],
    },
  };
  const session = {
    enableSubtitles: true,
    framesPerSecond: 30,
    audioLayers: [
      {
        _id: 'audio-1',
        speechLanguage: 'en',
        subtitleLanguage: 'es',
        subtitleTranslationRequired: true,
        startTime: 2,
        transcriptAlignment: {
          words: [{ word: 'Hello', start: 0.5, end: 1 }],
        },
        subtitleAlignmentMap: [
          { sourceText: 'Hello', translatedText: 'Hola' },
        ],
      },
    ],
  };

  const item = prepareLayerSubtitlesForRendering(layer, session)
    .imageSession.activeItemList[0];

  assert.equal(item.subtitleRenderMode, 'translated_cue');
  assert.equal(item.text, 'Hola');
  assert.deepEqual(
    item.words.map(({ word, frameOffset, frameDuration }) => ({
      word,
      frameOffset,
      frameDuration,
    })),
    [{ word: 'Hola', frameOffset: 75, frameDuration: 15 }],
  );
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

test('multi-word translated phrases receive proportional non-overlapping timings', () => {
  const words = splitMappedSubtitlePhraseTimings([
    {
      word: 'I LOVE THE WORLD',
      frameOffset: 10,
      frameDuration: 16,
      joinerBefore: '',
      sourceText: '我爱这个世界',
      translatedText: 'I LOVE THE WORLD',
    },
  ], { subtitleLanguage: 'en' });

  assert.deepEqual(words.map((wordInfo) => wordInfo.word), [
    'I',
    'LOVE',
    'THE',
    'WORLD',
  ]);
  assert.equal(words[0].frameOffset, 10);
  assert.equal(words.at(-1).frameOffset + words.at(-1).frameDuration, 26);
  words.slice(1).forEach((wordInfo, index) => {
    const previous = words[index];
    assert.equal(
      wordInfo.frameOffset,
      previous.frameOffset + previous.frameDuration,
    );
  });
  assert.ok(words.every((wordInfo) => wordInfo.frameDuration >= 1));
});

test('no-space subtitle punctuation stays attached to a highlighted word', () => {
  const translatedText = '你好，世界！';
  const words = splitMappedSubtitlePhraseTimings([
    {
      word: translatedText,
      frameOffset: 10,
      frameDuration: 12,
      joinerBefore: '',
    },
  ], { subtitleLanguage: 'zh' });

  assert.equal(words.map((wordInfo) => wordInfo.word).join(''), translatedText);
  assert.ok(words.every((wordInfo) => /[\p{L}\p{N}]/u.test(wordInfo.word)));
  assert.ok(words.every((wordInfo) => wordInfo.frameDuration >= 1));
});

test('standalone punctuation does not receive its own Latin highlight timing', () => {
  const words = splitMappedSubtitlePhraseTimings([
    {
      word: 'Hello , world !',
      frameOffset: 10,
      frameDuration: 12,
      joinerBefore: '',
    },
  ], { subtitleLanguage: 'en' });

  assert.deepEqual(words.map((wordInfo) => wordInfo.word), ['Hello ,', 'world !']);
  assert.ok(words.every((wordInfo) => /[\p{L}\p{N}]/u.test(wordInfo.word)));
});

test('prepared translated cues retain one phrase timing while speaker family follows body font', () => {
  const layer = {
    imageSession: {
      activeItemList: [
        {
          type: 'text',
          subType: 'subtitle',
          text: 'AU REVOIR',
          audioLayerId: 'audio-1',
          subtitleRenderMode: 'mapped',
          subtitleAlignmentMapped: true,
          subtitleLanguage: 'fr',
          audioLanguage: 'zh',
          config: {
            fontFamily: 'Poppins',
            speakerFontFamily: 'Arial',
          },
          words: [{ word: 'AU REVOIR', frameOffset: 30, frameDuration: 8 }],
          wordAnimation: 'highlight',
        },
      ],
    },
  };
  const session = {
    enableSubtitles: true,
    audioLayers: [
      {
        _id: 'audio-1',
        speechLanguage: 'zh',
        subtitleLanguage: 'fr',
      },
    ],
  };

  const item = prepareLayerSubtitlesForRendering(layer, session)
    .imageSession.activeItemList[0];

  assert.deepEqual(
    item.words.map(({ word, frameOffset, frameDuration }) => ({
      word,
      frameOffset,
      frameDuration,
    })),
    [
      { word: 'AU REVOIR', frameOffset: 30, frameDuration: 8 },
    ],
  );
  assert.equal(item.subtitleRenderMode, 'translated_cue');
  assert.equal(isMappedTranslatedSubtitleItem(item), true);
  assert.equal(item.config.fontFamily, 'Poppins');
  assert.equal(item.config.speakerFontFamily, 'Poppins');
  assert.equal(item.speakerFontFamily, 'Poppins');
});
