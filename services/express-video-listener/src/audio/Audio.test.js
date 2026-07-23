import assert from 'node:assert/strict';
import test from 'node:test';

import { getAudioPaddingFfmpegThreadOptions } from './Audio.js';

test('audio padding keeps its decoder single-threaded and caps filter and encoder work', () => {
  assert.deepEqual(getAudioPaddingFfmpegThreadOptions(3), {
    inputOptions: ['-threads', '1'],
    filterOptions: ['-filter_threads', '3'],
    outputOptions: ['-threads', '3'],
  });
});
