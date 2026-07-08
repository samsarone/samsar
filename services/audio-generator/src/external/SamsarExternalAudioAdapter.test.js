import assert from 'node:assert/strict';
import test from 'node:test';

process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

const { buildMusicInputPayload } = await import('./SamsarExternalAudioPayloads.js');

test('forwards backing track duration and flags to Samsar external music requests', () => {
  const input = buildMusicInputPayload({
    model: 'ELEVENLABS_MUSIC',
    prompt: 'Cinematic session backing track',
    duration: 94.5,
    isBackingTrack: true,
    generationMeta: {
      musicLengthMs: 94500,
      targetDurationSeconds: 94.5,
    },
  });

  assert.equal(input.duration, 94.5);
  assert.equal(input.duration_seconds, 94.5);
  assert.equal(input.secondsTotal, 94.5);
  assert.equal(input.isBackingTrack, true);
  assert.equal(input.is_backing_track, true);
  assert.equal(input.generationMeta.isBackingTrack, true);
  assert.equal(input.generation_meta.musicLengthMs, 94500);
});
