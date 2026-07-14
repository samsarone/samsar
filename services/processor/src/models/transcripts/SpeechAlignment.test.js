import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTranscriptionAttempts,
  hasAuthoritativeWordTimings,
  tokenizeTranscriptForAlignment,
  transcribeWithOpenAI,
} from './SpeechAlignment.js';

function createTranscriptionClient(handler) {
  return {
    audio: {
      transcriptions: {
        create: handler,
      },
    },
  };
}

function createDisposableStream() {
  return { destroy() {} };
}

function createStreamTracker() {
  const streams = [];
  return {
    streams,
    createReadStream() {
      const stream = {
        destroyCount: 0,
        destroy() {
          this.destroyCount += 1;
        },
      };
      streams.push(stream);
      return stream;
    },
  };
}

test('gpt-4o transcription configuration routes word alignment to whisper without a rejected verbose request', async () => {
  assert.deepEqual(
    buildTranscriptionAttempts('gpt-4o-transcribe', 'whisper-1'),
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
  const result = await transcribeWithOpenAI(
    '/unused/audio.mp3',
    '你好世界',
    'cn',
    2,
    {
      transcriptionModel: 'gpt-4o-transcribe',
      wordTimestampModel: 'whisper-1',
      createReadStream: createDisposableStream,
      openaiClient: createTranscriptionClient(async (payload) => {
        requests.push(payload);
        assert.equal(payload.model, 'whisper-1');
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
  assert.equal(requests[0].response_format, 'verbose_json');
  assert.equal(requests[0].language, 'zh');
  assert.deepEqual(requests[0].timestamp_granularities, ['word']);
  assert.deepEqual(result.words, [
    { alignedWord: '你好', word: '你好', start: 0.08, end: 0.82, case: 'success' },
    { alignedWord: '世界', word: '世界', start: 0.94, end: 1.86, case: 'success' },
  ]);
});

test('an unexpected verbose rejection falls through once to the timestamp-capable model', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const requests = [];
  const streamTracker = createStreamTracker();

  const result = await transcribeWithOpenAI(
    '/unused/audio.mp3',
    'Original speech',
    'en',
    2,
    {
      transcriptionModel: 'custom-transcription-model',
      wordTimestampModel: 'whisper-1',
      createReadStream: streamTracker.createReadStream,
      openaiClient: createTranscriptionClient(async (payload) => {
        requests.push(payload);
        if (payload.model === 'custom-transcription-model') {
          const error = new Error('response_format verbose_json is not supported');
          error.status = 400;
          throw error;
        }
        return {
          text: 'Original speech',
          duration: 2,
          words: [
            { word: 'Original', start: 0.05, end: 0.75 },
            { word: 'speech', start: 0.91, end: 1.72 },
          ],
        };
      }),
    },
  );

  assert.deepEqual(requests.map((request) => [request.model, request.response_format]), [
    ['custom-transcription-model', 'verbose_json'],
    ['whisper-1', 'verbose_json'],
  ]);
  assert.equal(streamTracker.streams.length, 2);
  assert.ok(streamTracker.streams.every((stream) => stream.destroyCount === 1));
  assert.deepEqual(result.words.map(({ word, start, end, case: resultCase }) => ({
    word,
    start,
    end,
    case: resultCase,
  })), [
    { word: 'Original', start: 0.05, end: 0.75, case: 'success' },
    { word: 'speech', start: 0.91, end: 1.72, case: 'success' },
  ]);
});

test('malformed timestamp words are rejected before falling through to whisper', async () => {
  const requests = [];
  const streamTracker = createStreamTracker();

  const result = await transcribeWithOpenAI(
    '/unused/audio.mp3',
    'Needs valid timing',
    'en',
    2,
    {
      transcriptionModel: 'custom-transcription-model',
      wordTimestampModel: 'whisper-1',
      createReadStream: streamTracker.createReadStream,
      openaiClient: createTranscriptionClient(async (payload) => {
        requests.push(payload);
        if (payload.model === 'custom-transcription-model') {
          return {
            text: 'Needs valid timing',
            words: [{ word: 'Needs' }, { word: 'valid', start: 0.4, end: null }],
          };
        }
        return {
          text: 'Needs valid timing',
          duration: 2,
          words: [
            { word: 'Needs', start: 0.04, end: 0.46 },
            { word: 'valid', start: 0.58, end: 1.03 },
            { word: 'timing', start: 1.18, end: 1.81 },
          ],
        };
      }),
    },
  );

  assert.deepEqual(requests.map((request) => request.model), [
    'custom-transcription-model',
    'whisper-1',
  ]);
  assert.equal(streamTracker.streams.length, 2);
  assert.ok(streamTracker.streams.every((stream) => stream.destroyCount === 1));
  assert.deepEqual(result.words.map(({ word, start, end }) => ({ word, start, end })), [
    { word: 'Needs', start: 0.04, end: 0.46 },
    { word: 'valid', start: 0.58, end: 1.03 },
    { word: 'timing', start: 1.18, end: 1.81 },
  ]);
});

test('mixed explicit and segment-only timing is not promoted to authoritative alignment', async () => {
  const requests = [];

  const result = await transcribeWithOpenAI(
    '/unused/audio.mp3',
    'Every segment needs word timing',
    'en',
    2,
    {
      transcriptionModel: 'custom-transcription-model',
      wordTimestampModel: 'whisper-1',
      createReadStream: createDisposableStream,
      openaiClient: createTranscriptionClient(async (payload) => {
        requests.push(payload);
        if (payload.model === 'custom-transcription-model') {
          return {
            text: 'Every segment needs word timing',
            segments: [
              {
                text: 'Every segment',
                start: 0,
                end: 0.9,
                words: [
                  { word: 'Every', start: 0.02, end: 0.35 },
                  { word: 'segment', start: 0.42, end: 0.82 },
                ],
              },
              { text: 'needs word timing', start: 0.9, end: 2 },
            ],
          };
        }
        return {
          text: 'Every segment needs word timing',
          duration: 2,
          words: [
            { word: 'Every', start: 0.02, end: 0.31 },
            { word: 'segment', start: 0.37, end: 0.72 },
            { word: 'needs', start: 0.79, end: 1.05 },
            { word: 'word', start: 1.12, end: 1.41 },
            { word: 'timing', start: 1.49, end: 1.91 },
          ],
        };
      }),
    },
  );

  assert.deepEqual(requests.map((request) => request.model), [
    'custom-transcription-model',
    'whisper-1',
  ]);
  assert.equal(hasAuthoritativeWordTimings(result.words), true);
  assert.deepEqual(result.words.map((word) => word.word), [
    'Every',
    'segment',
    'needs',
    'word',
    'timing',
  ]);
});

test('Chinese fallback tokenization creates multiple timed units when explicit timestamps are unavailable', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const transcript = '这是一个测试。';
  const tokens = tokenizeTranscriptForAlignment(transcript, 'cn');
  assert.ok(tokens.length > 1);
  assert.equal(tokens.join(''), '这是一个测试');

  const requests = [];
  const result = await transcribeWithOpenAI(
    '/unused/audio.mp3',
    transcript,
    'cn',
    4,
    {
      transcriptionModel: 'gpt-4o-transcribe',
      wordTimestampModel: 'whisper-1',
      createReadStream: createDisposableStream,
      openaiClient: createTranscriptionClient(async (payload) => {
        requests.push(payload);
        if (payload.model === 'whisper-1') {
          throw new Error('temporary timestamp service failure');
        }
        return { text: transcript, duration: 4 };
      }),
    },
  );

  assert.deepEqual(requests.map((request) => [request.model, request.response_format]), [
    ['whisper-1', 'verbose_json'],
    ['gpt-4o-transcribe', 'json'],
  ]);
  assert.equal(result.words.length, tokens.length);
  assert.equal(result.words.map((word) => word.word).join(''), '这是一个测试');
  assert.ok(result.words.every((word) => word.case === 'fallback'));
  assert.equal(result.words[0].start, 0);
  assert.equal(result.words.at(-1).end, 4);
  assert.ok(result.words.every((word, index) =>
    index === 0 || word.start >= result.words[index - 1].end));
});

test('complete transcription failure still returns safe multi-unit Chinese timing', async (t) => {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  const transcript = '无法获得时间戳';
  const requests = [];

  const result = await transcribeWithOpenAI(
    '/unused/audio.mp3',
    transcript,
    'cn',
    3,
    {
      transcriptionModel: 'gpt-4o-transcribe',
      wordTimestampModel: 'whisper-1',
      createReadStream: createDisposableStream,
      openaiClient: createTranscriptionClient(async (payload) => {
        requests.push(payload);
        throw new Error('transcription unavailable');
      }),
    },
  );

  assert.deepEqual(requests.map((request) => [request.model, request.response_format]), [
    ['whisper-1', 'verbose_json'],
    ['gpt-4o-transcribe', 'json'],
  ]);
  assert.ok(result.words.length > 1);
  assert.equal(result.words.map((word) => word.word).join(''), transcript);
  assert.ok(result.words.every((word) => word.case === 'fallback_error'));
  assert.equal(result.words.at(-1).end, 3);
});

test('synthetic timing remains renderable but is not authoritative for alignment caching', () => {
  assert.equal(hasAuthoritativeWordTimings([
    { word: 'real', start: 0.1, end: 0.6, case: 'success' },
    { word: 'timing', start: 0.7, end: 1.2, case: 'success' },
  ]), true);
  assert.equal(hasAuthoritativeWordTimings([
    { word: 'synthetic', start: 0, end: 0.5, case: 'fallback' },
  ]), false);
  assert.equal(hasAuthoritativeWordTimings([
    { word: 'missing-time' },
  ]), false);
});

test('whisper explicit word timestamps remain unchanged for the existing happy path', async () => {
  const requests = [];
  const result = await transcribeWithOpenAI(
    '/unused/audio.mp3',
    'Keep original timing',
    'en',
    3,
    {
      transcriptionModel: 'whisper-1',
      wordTimestampModel: 'whisper-1',
      createReadStream: createDisposableStream,
      openaiClient: createTranscriptionClient(async (payload) => {
        requests.push(payload);
        return {
          text: 'Keep original timing',
          duration: 3,
          words: [
            { word: 'Keep', start: 0.11, end: 0.52 },
            { word: 'original', start: 0.64, end: 1.47 },
            { word: 'timing', start: 1.83, end: 2.76 },
          ],
        };
      }),
    },
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, 'whisper-1');
  assert.deepEqual(result.words.map(({ word, start, end }) => ({ word, start, end })), [
    { word: 'Keep', start: 0.11, end: 0.52 },
    { word: 'original', start: 0.64, end: 1.47 },
    { word: 'timing', start: 1.83, end: 2.76 },
  ]);
});
