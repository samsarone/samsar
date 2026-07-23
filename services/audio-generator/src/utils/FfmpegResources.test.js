import assert from 'node:assert/strict';
import test from 'node:test';

import ffmpeg from 'fluent-ffmpeg';

import {
  AUDIO_FFMPEG_DECODER_THREAD_OPTIONS,
  AUDIO_FFMPEG_OUTPUT_THREAD_OPTIONS,
  AUDIO_FFPROBE_THREAD_OPTIONS,
  applySingleThreadAudioFfmpeg,
} from './FfmpegResources.js';

test('defines one-thread decoder, filter, encoder, and probe options', () => {
  assert.deepEqual(AUDIO_FFMPEG_DECODER_THREAD_OPTIONS, ['-threads', '1']);
  assert.deepEqual(AUDIO_FFMPEG_OUTPUT_THREAD_OPTIONS, [
    '-threads',
    '1',
    '-filter_threads',
    '1',
    '-filter_complex_threads',
    '1',
  ]);
  assert.deepEqual(AUDIO_FFPROBE_THREAD_OPTIONS, ['-threads', '1']);
});

test('applies thread limits to a single fluent-ffmpeg command only', () => {
  const command = applySingleThreadAudioFfmpeg(
    ffmpeg()
      .input('input.mp3')
      .audioCodec('libmp3lame')
      .output('output.mp3'),
  );
  const args = command._getArguments();
  const inputIndex = args.indexOf('-i');
  const outputIndex = args.indexOf('output.mp3');

  assert.deepEqual(args.slice(inputIndex - 2, inputIndex), ['-threads', '1']);
  assert.ok(args.indexOf('-threads', inputIndex) < outputIndex);
  assert.ok(args.indexOf('-filter_threads', inputIndex) < outputIndex);
  assert.ok(args.indexOf('-filter_complex_threads', inputIndex) < outputIndex);

  const untouchedArgs = ffmpeg()
    .input('other.mp3')
    .output('other-output.mp3')
    ._getArguments();
  assert.equal(untouchedArgs.includes('-threads'), false);
  assert.equal(untouchedArgs.includes('-filter_threads'), false);
});

test('rejects values that are not fluent-ffmpeg commands', () => {
  assert.throws(
    () => applySingleThreadAudioFfmpeg({}),
    /fluent-ffmpeg command/,
  );
});
