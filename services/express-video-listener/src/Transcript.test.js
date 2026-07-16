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

test('explicit session subtitle language overrides stale per-layer subtitle metadata', () => {
  const context = __testOnly__.getTranslatedSubtitleContext(
    {
      enableSubtitles: true,
      sessionLanguage: 'zh',
      subtitleLanguage: 'en',
      subtitleLanguageExplicit: true,
      subtitleTranslationRequired: true,
    },
    {
      speechLanguage: 'zh',
      subtitleLanguage: 'th',
      subtitleTranslationRequired: true,
    },
  );

  assert.equal(context.audioLanguage, 'zh');
  assert.equal(context.subtitleLanguage, 'en');
  assert.equal(context.isTranslated, true);
});

test('non-explicit session language preserves matching per-layer translated metadata', () => {
  const context = __testOnly__.getTranslatedSubtitleContext(
    {
      enableSubtitles: true,
      sessionLanguage: 'zh',
      subtitleLanguage: 'en',
      subtitleLanguageExplicit: false,
    },
    {
      speechLanguage: 'zh',
      subtitleLanguage: 'th',
      subtitleTranslationRequired: true,
    },
  );

  assert.equal(context.subtitleLanguage, 'th');
  assert.equal(context.isTranslated, true);
});

test('persisted session translation requirement makes its target language authoritative', () => {
  const context = __testOnly__.getTranslatedSubtitleContext(
    {
      enableSubtitles: true,
      sessionLanguage: 'zh',
      subtitleLanguage: 'en',
      subtitleTranslationRequired: true,
    },
    {
      speechLanguage: 'zh',
      subtitleLanguage: 'th',
      subtitleTranslationRequired: true,
    },
  );

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

test('translated alignment map accepts the canonical contract and rollout aliases', () => {
  assert.deepEqual(
    __testOnly__.getSubtitleAlignmentMap({
      subtitleAlignmentMap: [
        { sourceText: 'Hello', translatedText: 'Hola' },
        { source_text: 'brave world', targetText: 'mundo valiente' },
        { sourceText: '', translatedText: 'ignored' },
      ],
    }),
    [
      { sourceText: 'Hello', translatedText: 'Hola' },
      { sourceText: 'brave world', translatedText: 'mundo valiente' },
    ],
  );

  assert.deepEqual(
    __testOnly__.getSubtitleAlignmentMap({
      subtitleWordMapping: [{ originalText: 'Legacy', target: 'Anterior' }],
    }),
    [{ sourceText: 'Legacy', translatedText: 'Anterior' }],
  );
});

test('translated subtitle payload is only consumed for its persisted language', () => {
  const audioLayer = {
    subtitleLanguage: 'th',
    subtitleText: 'ข้อความภาษาไทย',
    subtitleAlignmentMap: [
      { sourceText: 'Hello', translatedText: 'สวัสดี' },
    ],
  };

  assert.equal(__testOnly__.audioLayerSubtitlePayloadMatchesLanguage(audioLayer, 'th-TH'), true);
  assert.equal(
    __testOnly__.audioLayerSubtitlePayloadMatchesLanguage(
      { subtitleText: 'ข้อความที่ไม่มีภาษากำกับ' },
      'th',
    ),
    false,
  );
  assert.equal(__testOnly__.getTranslatedSubtitleText(audioLayer, 'en'), '');
  assert.deepEqual(__testOnly__.getSubtitleAlignmentMap(audioLayer, 'en'), []);
  assert.equal(
    __testOnly__.getTranslatedSubtitleText(audioLayer, 'th-TH'),
    'ข้อความภาษาไทย',
  );
});

test('regeneration plan uses translated text with source-language alignment', () => {
  const plan = __testOnly__.resolveSubtitleGenerationPlan(
    {
      enableSubtitles: true,
      sessionLanguage: 'zh',
      subtitleLanguage: 'en',
      subtitleLanguageExplicit: true,
      subtitleTranslationRequired: true,
    },
    {
      generationType: 'speech',
      speechLanguage: 'zh',
      subtitleLanguage: 'en',
      subtitleTranslationRequired: true,
      prompt: '你好世界',
      subtitleText: 'Hello world',
      subtitleAlignmentMap: [
        { sourceText: '你好', translatedText: 'Hello' },
        { sourceText: '世界', translatedText: 'world' },
      ],
    },
  );

  assert.equal(plan.usesMappedTranslatedSubtitles, true);
  assert.equal(plan.usesStaticTranslatedSubtitles, false);
  assert.equal(plan.transcriptText, 'Hello world');
  assert.equal(plan.alignmentTranscriptText, '你好世界');
  assert.deepEqual(plan.subtitleAlignmentMap, [
    { sourceText: '你好', translatedText: 'Hello' },
    { sourceText: '世界', translatedText: 'world' },
  ]);
});

test('same-language regeneration keeps the normal speech alignment path', () => {
  const plan = __testOnly__.resolveSubtitleGenerationPlan(
    {
      enableSubtitles: true,
      sessionLanguage: 'en-US',
      subtitleLanguage: 'eng',
      subtitleLanguageExplicit: true,
      subtitleTranslationRequired: false,
    },
    {
      generationType: 'speech',
      speechLanguage: 'en',
      subtitleLanguage: 'en',
      prompt: 'Original speech text',
      subtitleText: 'Stale translated text',
      subtitleAlignmentMap: [
        { sourceText: 'Original', translatedText: 'Stale' },
      ],
    },
  );

  assert.equal(plan.translatedSubtitleContext.isTranslated, false);
  assert.equal(plan.usesMappedTranslatedSubtitles, false);
  assert.equal(plan.usesStaticTranslatedSubtitles, false);
  assert.equal(plan.transcriptText, 'Original speech text');
  assert.equal(plan.alignmentTranscriptText, 'Original speech text');
});

test('stale translated metadata cannot route a new language request through the mapped path', () => {
  const plan = __testOnly__.resolveSubtitleGenerationPlan(
    {
      enableSubtitles: true,
      sessionLanguage: 'zh',
      subtitleLanguage: 'en',
      subtitleLanguageExplicit: true,
      subtitleTranslationRequired: true,
    },
    {
      generationType: 'speech',
      speechLanguage: 'zh',
      subtitleLanguage: 'th',
      subtitleTranslationRequired: true,
      prompt: '你好世界',
      subtitleText: 'สวัสดีชาวโลก',
      subtitleAlignmentMap: [
        { sourceText: '你好世界', translatedText: 'สวัสดีชาวโลก' },
      ],
    },
  );

  assert.equal(plan.translatedSubtitleContext.subtitleLanguage, 'en');
  assert.equal(plan.translatedSubtitleText, '');
  assert.deepEqual(plan.subtitleAlignmentMap, []);
  assert.equal(plan.usesMappedTranslatedSubtitles, false);
  assert.equal(plan.usesStaticTranslatedSubtitles, true);
  assert.equal(plan.transcriptText, '');
});

test('translated words inherit the corresponding original word and phrase timing', () => {
  const mapped = __testOnly__.buildMappedSubtitleAlignment(
    [
      { word: 'Hello,', start: 0, end: 0.35 },
      { word: 'brave', start: 0.35, end: 0.7 },
      { word: 'world.', start: 0.7, end: 1.2 },
    ],
    [
      { sourceText: 'Hello', translatedText: 'Hola' },
      { sourceText: 'brave world', translatedText: 'mundo valiente.' },
    ],
    'Hola mundo valiente.',
  );

  assert.ok(mapped);
  assert.equal(mapped.usedFallback, false);
  assert.equal(mapped.transcriptText, 'Hola mundo valiente.');
  assert.deepEqual(
    mapped.words.map((word) => ({
      word: word.word,
      start: word.start,
      end: word.end,
      sourceWordStartIndex: word.sourceWordStartIndex,
      sourceWordEndIndex: word.sourceWordEndIndex,
    })),
    [
      {
        word: 'Hola',
        start: 0,
        end: 0.35,
        sourceWordStartIndex: 0,
        sourceWordEndIndex: 0,
      },
      {
        word: 'mundo valiente.',
        start: 0.35,
        end: 1.2,
        sourceWordStartIndex: 1,
        sourceWordEndIndex: 2,
      },
    ],
  );
});

test('mapped subtitle metadata keeps translated subtitles on the animated render path', () => {
  const mapped = __testOnly__.buildMappedSubtitleAlignment(
    [{ word: 'Welcome', start: 0, end: 0.8 }],
    [{ sourceText: 'Welcome', translatedText: 'ยินดีต้อนรับ' }],
    'ยินดีต้อนรับ',
  );
  const metadata = __testOnly__.getMappedSubtitleItemMetadata(
    {
      subtitleLanguage: 'th',
      audioLanguage: 'en',
      sourceTranscriptText: 'Welcome',
    },
    mapped,
  );

  assert.equal(metadata.subtitleRenderMode, 'mapped');
  assert.equal(metadata.isStaticSubtitle, false);
  assert.equal(metadata.subtitleTranslationRequired, true);
  assert.equal(metadata.subtitleAlignmentMapped, true);
  assert.equal(metadata.subtitleLanguage, 'th');
  assert.equal(metadata.audioLanguage, 'en');
  assert.deepEqual(metadata.subtitleAlignmentMap, [
    { sourceText: 'Welcome', translatedText: 'ยินดีต้อนรับ' },
  ]);
});

test('translated subtitle speaker uses its localized display name', () => {
  assert.equal(
    __testOnly__.getTranslatedSubtitleSpeakerName({
      speakerCharacterName: 'Narrator',
      subtitleSpeakerCharacterName: 'ผู้บรรยาย',
    }),
    'ผู้บรรยาย',
  );
  assert.equal(
    __testOnly__.getTranslatedSubtitleSpeakerName({
      translated_speaker_character_name: 'Narrador',
    }),
    'Narrador',
  );
  assert.equal(
    __testOnly__.getTranslatedSubtitleSpeakerName({
      subtitleLanguage: 'th',
      subtitleSpeakerCharacterName: 'ผู้บรรยาย',
    }, 'en'),
    '',
  );
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

function createTranscriptionClient(handler) {
  return {
    audio: {
      transcriptions: {
        create: handler,
      },
    },
  };
}

function createStreamTracker() {
  const streams = [];
  return {
    streams,
    createReadStream() {
      const stream = {
        destroyed: false,
        destroy() {
          this.destroyed = true;
        },
      };
      streams.push(stream);
      return stream;
    },
  };
}

test('GPT-4o transcription skips unsupported verbose JSON and uses Whisper for word timing', async (t) => {
  t.mock.method(console, 'info', () => {});
  assert.deepEqual(
    __testOnly__.buildTranscriptionAttempts('gpt-4o-transcribe', 'whisper-1'),
    [
      {
        model: 'whisper-1',
        response_format: 'verbose_json',
        timestamp_granularities: ['word'],
        requiresExplicitWordTimings: true,
      },
      {
        model: 'gpt-4o-transcribe',
        response_format: 'json',
        requiresExplicitWordTimings: false,
      },
    ],
  );

  const requests = [];
  const streamTracker = createStreamTracker();
  const result = await __testOnly__.transcribeWithOpenAI(
    '/unused/audio.mp3',
    '你好世界',
    'cn',
    2,
    {},
    {
      transcriptionModel: 'gpt-4o-transcribe',
      wordTimestampModel: 'whisper-1',
      createReadStream: streamTracker.createReadStream,
      recordUsageLog: async () => {},
      openaiClient: createTranscriptionClient(async (payload) => {
        requests.push(payload);
        return {
          text: '你好世界',
          duration: 2,
          words: [
            { word: '你好', start: 0.08, end: 0.82 },
            { word: '世界', start: 0.94, end: 1.86 },
          ],
        };
      }),
    },
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, 'whisper-1');
  assert.equal(requests[0].language, 'zh');
  assert.equal(requests[0].response_format, 'verbose_json');
  assert.deepEqual(result.words.map(({ word, start, end }) => ({ word, start, end })), [
    { word: '你好', start: 0.08, end: 0.82 },
    { word: '世界', start: 0.94, end: 1.86 },
  ]);
  assert.ok(streamTracker.streams.every((stream) => stream.destroyed));
});

test('Chinese fallback creates multiple timed units after timestamp service failure', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const transcript = '这是一个测试。';
  const tokens = __testOnly__.tokenizeTranscriptForAlignment(transcript, 'cn');
  assert.ok(tokens.length > 1);
  assert.equal(tokens.join(''), '这是一个测试');

  const requests = [];
  const streamTracker = createStreamTracker();
  const result = await __testOnly__.transcribeWithOpenAI(
    '/unused/audio.mp3',
    transcript,
    'cn',
    4,
    {},
    {
      transcriptionModel: 'gpt-4o-transcribe',
      wordTimestampModel: 'whisper-1',
      createReadStream: streamTracker.createReadStream,
      recordUsageLog: async () => {},
      openaiClient: createTranscriptionClient(async (payload) => {
        requests.push(payload);
        if (payload.model === 'whisper-1') {
          throw new Error('timestamp service unavailable');
        }
        return { text: transcript, duration: 4 };
      }),
    },
  );

  assert.deepEqual(requests.map(({ model, response_format: responseFormat }) => [model, responseFormat]), [
    ['whisper-1', 'verbose_json'],
    ['gpt-4o-transcribe', 'json'],
  ]);
  assert.equal(result.words.length, tokens.length);
  assert.equal(result.words.map((word) => word.word).join(''), '这是一个测试');
  assert.ok(result.words.every((word) => word.case === 'fallback'));
  assert.equal(result.words[0].start, 0);
  assert.equal(result.words.at(-1).end, 4);
  assert.ok(streamTracker.streams.every((stream) => stream.destroyed));
  assert.equal(__testOnly__.buildTranscriptAlignmentCache({
    words: result.words,
    transcriptText: transcript,
    sourceText: transcript,
    languageCode: 'zh',
    durationSeconds: 4,
  }), null);
});

test('padded character speech resolves its original speech timing window', () => {
  assert.deepEqual(
    __testOnly__.resolvePaddedSpeechTimingWindow({
      startTime: 31.5,
      duration: 7.875,
      originalDuration: 4,
      previousAudioData: {
        startTime: 33.4375,
        duration: 4,
      },
    }),
    {
      startSeconds: 1.9375,
      durationSeconds: 4,
    },
  );

  assert.deepEqual(
    __testOnly__.resolvePaddedSpeechTimingWindow({
      startTime: 10,
      duration: 8,
      originalDuration: 4,
      previousAudioData: { duration: 4 },
    }),
    {
      startSeconds: 2,
      durationSeconds: 4,
    },
  );

  assert.equal(__testOnly__.resolvePaddedSpeechTimingWindow({
    startTime: 10,
    duration: 4,
    originalDuration: 4,
    previousAudioData: {
      startTime: 10,
      duration: 4,
    },
  }), null);
});

test('synthetic fallback stays inside the padded character speech window', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const transcript = 'Threshold matched. The lattice is forming well.';
  const audioLayer = {
    startTime: 31.5,
    duration: 7.875,
    originalDuration: 4,
    previousAudioData: {
      startTime: 33.4375,
      duration: 4,
    },
  };
  const requests = [];
  const streamTracker = createStreamTracker();
  const result = await __testOnly__.transcribeWithOpenAI(
    '/unused/speech_padded.wav',
    transcript,
    'en',
    audioLayer.duration,
    {},
    {
      transcriptionModel: 'gpt-4o-transcribe',
      wordTimestampModel: 'whisper-1',
      syntheticAlignmentWindow: __testOnly__.resolvePaddedSpeechTimingWindow(audioLayer),
      createReadStream: streamTracker.createReadStream,
      recordUsageLog: async () => {},
      openaiClient: createTranscriptionClient(async (payload) => {
        requests.push(payload);
        return { text: transcript, duration: audioLayer.duration };
      }),
    },
  );

  assert.deepEqual(requests.map(({ model, response_format: responseFormat }) => [model, responseFormat]), [
    ['whisper-1', 'verbose_json'],
    ['gpt-4o-transcribe', 'json'],
  ]);
  assert.ok(result.words.every((word) => word.case === 'fallback'));
  assert.equal(result.words[0].start, 1.938);
  assert.equal(result.words.at(-1).end, 5.938);
  assert.ok(streamTracker.streams.every((stream) => stream.destroyed));
});

test('authoritative padded-audio timestamps are not shifted a second time', async (t) => {
  t.mock.method(console, 'info', () => {});
  const streamTracker = createStreamTracker();
  const result = await __testOnly__.transcribeWithOpenAI(
    '/unused/speech_padded.wav',
    'Threshold matched.',
    'en',
    7.875,
    {},
    {
      transcriptionModel: 'gpt-4o-transcribe',
      wordTimestampModel: 'whisper-1',
      syntheticAlignmentWindow: {
        startSeconds: 1.9375,
        durationSeconds: 4,
      },
      createReadStream: streamTracker.createReadStream,
      recordUsageLog: async () => {},
      openaiClient: createTranscriptionClient(async () => ({
        text: 'Threshold matched.',
        duration: 7.875,
        words: [
          { word: 'Threshold', start: 2.365, end: 2.9 },
          { word: 'matched', start: 2.9, end: 3.45 },
        ],
      })),
    },
  );

  assert.deepEqual(result.words.map(({ word, start, end }) => ({ word, start, end })), [
    { word: 'Threshold', start: 2.365, end: 2.9 },
    { word: 'matched', start: 2.9, end: 3.45 },
  ]);
  assert.ok(streamTracker.streams.every((stream) => stream.destroyed));
});

test('mixed explicit and segment-only timings are not accepted or cached as authoritative', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const mixedResponse = {
    text: '第一句 第二句',
    duration: 2,
    segments: [
      {
        text: '第一句',
        start: 0,
        end: 0.9,
        words: [{ word: '第一句', start: 0.05, end: 0.82 }],
      },
      {
        text: '第二句',
        start: 1,
        end: 1.9,
      },
    ],
  };
  assert.equal(__testOnly__.hasExplicitWordTimings(mixedResponse), false);

  const requests = [];
  const streamTracker = createStreamTracker();
  const result = await __testOnly__.transcribeWithOpenAI(
    '/unused/audio.mp3',
    mixedResponse.text,
    'cn',
    2,
    {},
    {
      transcriptionModel: 'whisper-1',
      wordTimestampModel: 'whisper-1',
      createReadStream: streamTracker.createReadStream,
      recordUsageLog: async () => {},
      openaiClient: createTranscriptionClient(async (payload) => {
        requests.push(payload);
        return mixedResponse;
      }),
    },
  );

  assert.deepEqual(requests.map(({ response_format: responseFormat }) => responseFormat), [
    'verbose_json',
    'json',
  ]);
  assert.ok(result.words.some((word) => word.case === 'segment_fallback'));
  assert.equal(__testOnly__.hasAuthoritativeWordTimings(result.words), false);
  assert.equal(__testOnly__.buildTranscriptAlignmentCache({
    words: result.words,
    transcriptText: mixedResponse.text,
    sourceText: mixedResponse.text,
    languageCode: 'zh',
    durationSeconds: 2,
  }), null);
  assert.ok(streamTracker.streams.every((stream) => stream.destroyed));
});

test('cached synthetic fallback timings are ignored', () => {
  const cached = __testOnly__.getCachedTranscriptAlignment(
    {
      duration: 2,
      transcriptAlignment: {
        sourceText: '你好世界',
        transcriptText: '你好世界',
        languageCode: 'zh',
        audioSource: 'assets_v2/audio.mp3',
        durationSeconds: 2,
        words: [
          { word: '你好', start: 0, end: 1, case: 'fallback' },
          { word: '世界', start: 1, end: 2, case: 'fallback' },
        ],
      },
    },
    '你好世界',
    'zh',
    'assets_v2/audio.mp3',
  );

  assert.equal(cached, null);
});

test('invalid provider word timestamps cannot become a reusable synthetic cache', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const streamTracker = createStreamTracker();
  const result = await __testOnly__.transcribeWithOpenAI(
    '/unused/audio.mp3',
    '你好',
    'cn',
    1,
    {},
    {
      transcriptionModel: 'gpt-4o-transcribe',
      wordTimestampModel: 'whisper-1',
      createReadStream: streamTracker.createReadStream,
      recordUsageLog: async () => {},
      openaiClient: createTranscriptionClient(async (payload) => {
        if (payload.model === 'whisper-1') {
          throw new Error('timestamp service unavailable');
        }
        return {
          text: '你好',
          duration: 1,
          words: [{ word: '你好', start: null, end: null }],
        };
      }),
    },
  );

  assert.equal(result.words[0].case, 'invalid_timestamp_fallback');
  assert.equal(__testOnly__.hasAuthoritativeWordTimings(result.words), false);
  assert.equal(__testOnly__.buildTranscriptAlignmentCache({
    words: result.words,
    transcriptText: '你好',
    sourceText: '你好',
    languageCode: 'zh',
    durationSeconds: 1,
  }), null);
  assert.ok(streamTracker.streams.every((stream) => stream.destroyed));
});
