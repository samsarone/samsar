import assert from 'node:assert/strict';
import test from 'node:test';

import {
  requestSamsarTranscriptAlignment,
  shouldUseSamsarTranscriptAlignment,
} from './SamsarTranscriptAlignment.js';

test('delegated transcript alignment requires Docker, Samsar credentials, and no OpenAI key', () => {
  assert.equal(shouldUseSamsarTranscriptAlignment({
    CURRENT_ENV: 'docker',
    SAMSAR_API_KEY: 'samsar-key',
  }), true);
  assert.equal(shouldUseSamsarTranscriptAlignment({
    CURRENT_ENV: 'docker',
    OPENAI_API_KEY: 'openai-key',
    SAMSAR_API_KEY: 'samsar-key',
  }), false);
  assert.equal(shouldUseSamsarTranscriptAlignment({
    CURRENT_ENV: 'hosted',
    SAMSAR_API_KEY: 'samsar-key',
  }), false);
});
test('listener serializes its Whisper word timestamp request for the metered endpoint', async () => {
  let capturedPath = null;
  let capturedPayload = null;
  await requestSamsarTranscriptAlignment(
    '/audio/speech.webm',
    {
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['word'],
      language: 'th',
    },
    9,
    {
      readFile: async () => Buffer.from('audio bytes'),
      samsarClient: {
        requestV2ExternalAudioRoute: async (routePath, payload) => {
          capturedPath = routePath;
          capturedPayload = payload;
          return { data: { text: 'สวัสดี', words: [] } };
        },
      },
    },
  );

  assert.equal(capturedPath, 'transcript_align');
  assert.equal(capturedPayload.input.model, 'whisper-1');
  assert.deepEqual(capturedPayload.input.timestamp_granularities, ['word']);
  assert.equal(capturedPayload.input.audio_duration_seconds, 9);
  assert.equal(capturedPayload.input.file.filename, 'speech.webm');
  assert.equal(capturedPayload.input.file.content_type, 'audio/webm');
});
