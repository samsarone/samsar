export const AUDIO_FFMPEG_DECODER_THREAD_OPTIONS = Object.freeze([
  '-threads',
  '1',
]);

export const AUDIO_FFMPEG_OUTPUT_THREAD_OPTIONS = Object.freeze([
  '-threads',
  '1',
  '-filter_threads',
  '1',
  '-filter_complex_threads',
  '1',
]);

export const AUDIO_FFPROBE_THREAD_OPTIONS = Object.freeze([
  '-threads',
  '1',
]);

/**
 * Applies single-thread limits to one fluent-ffmpeg command.
 *
 * These are command-local options. They do not create a worker pool or reserve
 * CPU while no FFmpeg command is running.
 */
export function applySingleThreadAudioFfmpeg(command) {
  if (
    !command
    || typeof command.inputOptions !== 'function'
    || typeof command.outputOptions !== 'function'
  ) {
    throw new TypeError('A fluent-ffmpeg command is required.');
  }

  command.inputOptions(AUDIO_FFMPEG_DECODER_THREAD_OPTIONS);
  command.outputOptions(AUDIO_FFMPEG_OUTPUT_THREAD_OPTIONS);
  return command;
}
