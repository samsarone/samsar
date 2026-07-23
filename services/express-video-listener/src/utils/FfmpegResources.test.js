import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildFfmpegThreadOptions,
  resolveExpressVideoFfmpegThreads,
} from './FfmpegResources.js';

const cpuOptions = {
  platform: 'darwin',
  availableParallelism: () => 8,
};

test('express FFmpeg ceiling uses service, global, and default upper bounds in order', () => {
  assert.equal(resolveExpressVideoFfmpegThreads({
    ...cpuOptions,
    env: {
      SAMSAR_EXPRESS_VIDEO_MAX_FFMPEG_THREADS: '6',
      SAMSAR_MAX_FFMPEG_THREADS: '4',
      SAMSAR_CPU_RESERVE: '1',
    },
  }), 6);

  assert.equal(resolveExpressVideoFfmpegThreads({
    ...cpuOptions,
    env: {
      SAMSAR_MAX_FFMPEG_THREADS: '4',
      SAMSAR_CPU_RESERVE: '1',
    },
  }), 4);

  assert.equal(resolveExpressVideoFfmpegThreads({
    ...cpuOptions,
    env: {
      SAMSAR_CPU_RESERVE: '1',
    },
  }), 2);
});

test('express FFmpeg ceiling keeps the Docker reserve available to sibling services', () => {
  assert.equal(resolveExpressVideoFfmpegThreads({
    platform: 'darwin',
    availableParallelism: () => 4,
    env: {
      SAMSAR_EXPRESS_VIDEO_MAX_FFMPEG_THREADS: '8',
      SAMSAR_CPU_RESERVE: '1',
    },
  }), 3);
});

test('FFmpeg thread options keep each input decoder at one thread', () => {
  assert.deepEqual(buildFfmpegThreadOptions({
    threads: 4,
    complexFilter: true,
  }), {
    inputOptions: ['-threads', '1'],
    filterOptions: ['-filter_complex_threads', '4'],
    outputOptions: ['-threads', '4'],
  });
});
