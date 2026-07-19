import assert from 'node:assert/strict';
import test from 'node:test';

import {
  requestSamsarTranscriptAlignment,
  shouldUseSamsarTranscriptAlignment,
} from './SamsarTranscriptAlignment.js';

test('Samsar transcript alignment is selected only for Docker with Samsar and no OpenAI key', () => {
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
    CURRENT_ENV: 'production',
    SAMSAR_API_KEY: 'samsar-key',
  }), false);
  assert.equal(shouldUseSamsarTranscriptAlignment({ CURRENT_ENV: 'docker' }), false);
});
test('Samsar transcript alignment serializes the OpenAI word timestamp payload', async () => {
  let capturedPath = null;
  let capturedPayload = null;
  const response = await requestSamsarTranscriptAlignment(
    '/audio/speech.wav',
    {
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['word'],
      language: 'en',
      prompt: 'Hello there',
    },
    12.5,
    {
      readFile: async () => Buffer.from('audio bytes'),
      samsarClient: {
        requestV2ExternalAudioRoute: async (routePath, payload) => {
          capturedPath = routePath;
          capturedPayload = payload;
          return { data: { text: 'Hello there', words: [] } };
        },
      },
    },
  );

  assert.equal(capturedPath, 'transcript_align');
  assert.equal(capturedPayload.input.model, 'whisper-1');
  assert.equal(capturedPayload.input.response_format, 'verbose_json');
  assert.deepEqual(capturedPayload.input.timestamp_granularities, ['word']);
  assert.equal(capturedPayload.input.language, 'en');
  assert.equal(capturedPayload.input.prompt, 'Hello there');
  assert.equal(capturedPayload.input.audio_duration_seconds, 12.5);
  assert.equal(capturedPayload.input.file.filename, 'speech.wav');
  assert.equal(capturedPayload.input.file.content_type, 'audio/wav');
  assert.equal(capturedPayload.input.file.data, Buffer.from('audio bytes').toString('base64'));
  assert.equal(response.text, 'Hello there');
});
