import assert from 'node:assert/strict';
import test from 'node:test';

process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

const { buildElevenLabsMusicInput } = await import('./ElevenLabsMusicPayload.js');

test('uses requested backing track duration for ElevenLabs music length', () => {
  const input = buildElevenLabsMusicInput({
    prompt: 'Cinematic background score',
    duration: 94.5,
    isBackingTrack: true,
    generationMeta: {
      musicLengthMs: 60000,
    },
  });

  assert.equal(input.music_length_ms, 94500);
  assert.equal(input.force_instrumental, true);
});

test('uses requested duration over explicit metadata for ElevenLabs music length', () => {
  const input = buildElevenLabsMusicInput({
    prompt: 'Cinematic background score',
    duration: 94.5,
    generationMeta: {
      musicLengthMs: 60000,
    },
  });

  assert.equal(input.music_length_ms, 94500);
});

test('does not clamp ElevenLabs backing tracks to sixty seconds', () => {
  const input = buildElevenLabsMusicInput({
    prompt: 'Long-form background score',
    isBackingTrack: true,
    generationMeta: {
      musicLengthMs: 180000,
    },
  });

  assert.equal(input.music_length_ms, 180000);
});

test('uses requested long duration without capping ElevenLabs provider request length', () => {
  const input = buildElevenLabsMusicInput({
    prompt: 'Long session backing score',
    duration: 240,
    isBackingTrack: true,
  });

  assert.equal(input.music_length_ms, 240000);
});
