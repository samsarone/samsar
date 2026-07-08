import assert from 'node:assert/strict';
import test from 'node:test';

const { normalizeElevenLabsMusicPayload } = await import('./ElevenLabsMusicPayload.js');

test('normalizes ElevenLabs backing track music length from requested duration', () => {
  const payload = normalizeElevenLabsMusicPayload({
    generationType: 'music',
    model: 'ELEVENLABS_MUSIC',
    duration: 94.5,
    isBackingTrack: true,
    generationMeta: {
      musicLengthMs: 60000,
    },
  });

  assert.equal(payload.duration, 94.5);
  assert.equal(payload.generationMeta.musicLengthMs, 94500);
  assert.equal(payload.generationMeta.targetDurationSeconds, 94.5);
});

test('uses requested duration over explicit metadata for non-backing ElevenLabs music', () => {
  const payload = normalizeElevenLabsMusicPayload({
    generationType: 'music',
    model: 'ELEVENLABS_MUSIC',
    duration: 94.5,
    generationMeta: {
      musicLengthMs: 60000,
    },
  });

  assert.equal(payload.duration, 94.5);
  assert.equal(payload.generationMeta.musicLengthMs, 94500);
});

test('keeps long backing track duration without capping ElevenLabs provider request length', () => {
  const payload = normalizeElevenLabsMusicPayload({
    generationType: 'music',
    model: 'ELEVENLABS_MUSIC',
    duration: 240,
    isBackingTrack: true,
  });

  assert.equal(payload.duration, 240);
  assert.equal(payload.generationMeta.targetDurationSeconds, 240);
  assert.equal(payload.generationMeta.musicLengthMs, 240000);
});
