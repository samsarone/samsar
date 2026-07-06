import assert from 'node:assert/strict';
import test from 'node:test';

process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

const { shouldLoopBackingTrackAudio } = await import('./audioUtils.js');

test('loops duration normalization for any backing track provider', () => {
  assert.equal(shouldLoopBackingTrackAudio({ model: 'LYRIA3', isBackingTrack: true }), true);
  assert.equal(shouldLoopBackingTrackAudio({ model: 'ELEVENLABS_MUSIC', isBackingTrack: true }), true);
});

test('does not loop non-backing music by provider alone', () => {
  assert.equal(shouldLoopBackingTrackAudio({ model: 'LYRIA3', isBackingTrack: false }), false);
  assert.equal(shouldLoopBackingTrackAudio({ model: 'ELEVENLABS_MUSIC' }), false);
});
