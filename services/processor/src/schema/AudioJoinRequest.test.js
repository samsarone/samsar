import assert from 'node:assert/strict';
import test from 'node:test';

import AudioJoinRequest from './AudioJoinRequest.js';

test('persists asynchronous audio join state and fade preference', () => {
  const { paths } = AudioJoinRequest.schema;
  assert.deepEqual(paths.status.enumValues, [
    'PENDING',
    'PROCESSING',
    'COMPLETED',
    'FAILED',
  ]);
  assert.equal(paths.status.defaultValue, 'PENDING');
  assert.equal(paths.fadeAudioAtEnds.defaultValue, false);
  assert.equal(paths.expireAt.options.expires, 0);
  assert.ok(paths.generatedMusicId);
});
