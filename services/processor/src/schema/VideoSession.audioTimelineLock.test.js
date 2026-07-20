import assert from 'node:assert/strict';
import test from 'node:test';

import VideoSession from './VideoSession.js';

test('audio timeline locks default to unlocked and preserve explicit locks', () => {
  const session = new VideoSession({
    userId: '507f191e810c19729de860ea',
    audioLayers: [{}],
    global_audio_layers: [{ isTimelineLocked: true }],
  }).toObject();

  assert.equal(session.audioLayers[0].isTimelineLocked, false);
  assert.equal(session.global_audio_layers[0].isTimelineLocked, true);
});
