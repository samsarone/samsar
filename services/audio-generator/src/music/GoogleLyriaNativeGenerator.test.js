import assert from 'node:assert/strict';
import test from 'node:test';

process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

const {
  buildLyriaGenerateContentBody,
  buildLyriaInteractionBody,
  extractAudioOutput,
} = await import('./GoogleLyriaNativeGenerator.js');

test('builds default Lyria native generateContent request without forcing audio MIME type', () => {
  const request = buildLyriaGenerateContentBody({
    prompt: 'Cinematic synth backing track',
    duration: 10,
    isBackingTrack: true,
  });

  assert.equal(request.responseFormat, 'mp3');
  assert.equal(request.model, 'lyria-3-pro-preview');
  assert.deepEqual(request.body.generationConfig.responseModalities, ['AUDIO', 'TEXT']);
  assert.equal(request.body.generationConfig.responseFormat, undefined);
  assert.match(request.body.contents[0].parts[0].text, /Instrumental backing track only/);
});

test('uses full backing track duration when provider music length metadata is capped', () => {
  const request = buildLyriaGenerateContentBody({
    prompt: 'Cinematic synth backing track',
    duration: 75,
    isBackingTrack: true,
    generationMeta: {
      musicLengthMs: 30000,
      targetDurationSeconds: 75,
    },
  });

  assert.equal(request.durationSeconds, 75);
  assert.match(request.body.contents[0].parts[0].text, /Target duration: 75 seconds\./);
});

test('builds Lyria native WAV generateContent request with documented response format', () => {
  const request = buildLyriaGenerateContentBody({
    prompt: 'Cinematic synth backing track',
    duration: 10,
    responseFormat: 'wav',
  });

  assert.equal(request.responseFormat, 'wav');
  assert.equal(request.body.generationConfig.responseFormat.audio.mimeType, 'audio/wav');
});

test('builds Interactions request without unsupported audio mime_type', () => {
  const request = buildLyriaInteractionBody({
    prompt: 'Cinematic synth backing track',
    duration: 10,
    responseFormat: 'wav',
  });

  assert.equal(request.responseFormat, 'wav');
  assert.deepEqual(request.body.response_format, { type: 'audio' });
});

test('extracts audio from generateContent inlineData response', () => {
  const audioOutput = extractAudioOutput({
    candidates: [
      {
        content: {
          parts: [
            { text: 'Generated lyrics' },
            { inlineData: { mimeType: 'audio/mpeg', data: 'bXAz' } },
          ],
        },
      },
    ],
  });

  assert.deepEqual(audioOutput, {
    data: 'bXAz',
    uri: '',
    mimeType: 'audio/mpeg',
  });
});

test('extracts audio from Interactions steps response', () => {
  const audioOutput = extractAudioOutput({
    steps: [
      {
        type: 'model_output',
        content: [
          { type: 'text', text: 'Generated lyrics' },
          { type: 'audio', mime_type: 'audio/mpeg', data: 'bXAz' },
        ],
      },
    ],
  });

  assert.deepEqual(audioOutput, {
    data: 'bXAz',
    uri: '',
    mimeType: 'audio/mpeg',
  });
});

test('extracts audio from Vertex Lyria predictions response', () => {
  const audioOutput = extractAudioOutput({
    predictions: [
      {
        audioContent: 'd2F2',
        mimeType: 'audio/wav',
      },
    ],
  });

  assert.deepEqual(audioOutput, {
    data: 'd2F2',
    uri: '',
    mimeType: 'audio/wav',
  });
});
