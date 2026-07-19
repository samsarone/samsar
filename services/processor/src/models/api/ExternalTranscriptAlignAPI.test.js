import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateTranscriptAlignmentCharge,
  createExternalTranscriptAlignment,
} from './ExternalTranscriptAlignAPI.js';

test('transcript alignment charges 1.5x the underlying Whisper request cost', () => {
  const charge = calculateTranscriptAlignmentCharge({ durationSeconds: 60 });
  assert.equal(charge.durationSeconds, 60);
  assert.equal(charge.underlyingCostUsd, 0.006);
  assert.equal(charge.pricingMultiplier, 1.5);
  assert.ok(Math.abs(charge.costUsd - 0.009) < Number.EPSILON);
  assert.ok(Math.abs(charge.credits - 0.9) < Number.EPSILON);
  assert.equal(charge.usdPerMinute, 0.006);
});

test('transcript alignment proxies OpenAI word timestamp payloads and meters duration', async () => {
  let capturedRequest = null;
  let capturedCharge = null;
  const result = await createExternalTranscriptAlignment({
    userId: 'user-1',
    payload: {
      input: {
        file: {
          data: Buffer.from('fake audio').toString('base64'),
          filename: 'speech.mp3',
          content_type: 'audio/mpeg',
        },
        model: 'whisper-1',
        response_format: 'verbose_json',
        timestamp_granularities: ['word'],
        language: 'en',
        prompt: 'Hello world',
        audio_duration_seconds: 30,
      },
    },
    openaiClient: {
      audio: {
        transcriptions: {
          create: async (request) => {
            capturedRequest = request;
            return {
              text: 'Hello world',
              duration: 30,
              words: [{ word: 'Hello', start: 0, end: 0.5 }],
            };
          },
        },
      },
    },
    deductCredits: async (userId, credits, context) => {
      capturedCharge = { userId, credits, context };
      return { remainingCredits: 99.55 };
    },
  });

  assert.equal(capturedRequest.model, 'whisper-1');
  assert.equal(capturedRequest.response_format, 'verbose_json');
  assert.deepEqual(capturedRequest.timestamp_granularities, ['word']);
  assert.equal(capturedRequest.language, 'en');
  assert.equal(capturedRequest.prompt, 'Hello world');
  assert.equal(capturedRequest.file.name, 'speech.mp3');
  assert.equal(capturedCharge.userId, 'user-1');
  assert.ok(Math.abs(capturedCharge.credits - 0.45) < Number.EPSILON);
  assert.equal(capturedCharge.context.metadata.pricingMultiplier, 1.5);
  assert.equal(result.response.words[0].word, 'Hello');
  assert.equal(result.remainingCredits, 99.55);
});

test('transcript alignment rejects non-Whisper models for word alignment', async () => {
  await assert.rejects(
    createExternalTranscriptAlignment({
      userId: 'user-1',
      payload: {
        file: Buffer.from('fake audio').toString('base64'),
        model: 'gpt-4o-transcribe',
      },
      openaiClient: {},
      deductCredits: async () => ({}),
    }),
    (error) => error.code === 'TRANSCRIPT_ALIGN_MODEL_NOT_SUPPORTED' && error.status === 400,
  );
});

test('transcript alignment requires the OpenAI word timestamp response shape', async () => {
  await assert.rejects(
    createExternalTranscriptAlignment({
      userId: 'user-1',
      payload: {
        file: Buffer.from('fake audio').toString('base64'),
        model: 'whisper-1',
        response_format: 'json',
      },
      openaiClient: {},
      deductCredits: async () => ({}),
    }),
    (error) => error.code === 'TRANSCRIPT_ALIGN_WORD_TIMESTAMPS_REQUIRED' && error.status === 400,
  );
});

test('transcript alignment returns a clean configuration error without hosted OpenAI credentials', async () => {
  const originalOpenAIKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await assert.rejects(
      createExternalTranscriptAlignment({
        userId: 'user-1',
        payload: {
          file: Buffer.from('fake audio').toString('base64'),
          model: 'whisper-1',
        },
      }),
      (error) => error.code === 'OPENAI_TRANSCRIPTION_NOT_CONFIGURED' && error.status === 503,
    );
  } finally {
    if (originalOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAIKey;
  }
});
