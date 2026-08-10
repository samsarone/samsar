import assert from 'node:assert/strict';
import test from 'node:test';

import { getCpuResourceBudget } from './CpuResources.js';
import {
  buildFrameWorkerRanges,
  getFrameProcessingLimits,
  getFrameWorkerCount,
  getDeploymentEdition,
  isDockerRuntime,
  usesLocalAssetStorage,
} from './DeploymentEnvironment.js';

test('normalizes legacy Docker and community editions to standalone', () => {
  assert.equal(getDeploymentEdition({ CURRENT_ENV: 'docker' }), 'standalone');
  assert.equal(getDeploymentEdition({ CURRENT_ENV: 'community' }), 'standalone');
  assert.equal(getDeploymentEdition({ SAMSAR_DEPLOYMENT_EDITION: 'standalone' }), 'standalone');
});

test('keeps production edition separate from Docker runtime', () => {
  const env = {
    CURRENT_ENV: 'production',
    SAMSAR_DEPLOYMENT_EDITION: 'production',
    SAMSAR_RUNTIME: 'docker',
  };
  assert.equal(getDeploymentEdition(env), 'production');
  assert.equal(isDockerRuntime(env), true);
  assert.equal(usesLocalAssetStorage(env), true);
});

test('explicit runtime overrides the legacy CURRENT_ENV fallback', () => {
  assert.equal(isDockerRuntime({ CURRENT_ENV: 'docker', SAMSAR_RUNTIME: 'host' }), false);
  assert.equal(isDockerRuntime({ SAMSAR_RUNTIME: ' Kubernetes ' }), true);
  assert.equal(isDockerRuntime({ SAMSAR_DEPLOYMENT_RUNTIME: 'compose' }), true);
});

test('production Docker retains production frame-processing capacity defaults', () => {
  assert.deepEqual(getFrameProcessingLimits({
    CURRENT_ENV: 'production',
    SAMSAR_DEPLOYMENT_EDITION: 'production',
    SAMSAR_RUNTIME: 'docker',
  }, 64), {
    maxConcurrentTasks: 6,
    numChunks: 8,
    ffmpegThreads: 2,
  });
});

test('standalone has reduced defaults and supports explicit bounded overrides', () => {
  assert.deepEqual(getFrameProcessingLimits({
    SAMSAR_DEPLOYMENT_EDITION: 'standalone',
    SAMSAR_RUNTIME: 'docker',
  }, 64), {
    maxConcurrentTasks: 2,
    numChunks: 4,
    ffmpegThreads: 2,
  });
  assert.deepEqual(getFrameProcessingLimits({
    SAMSAR_DEPLOYMENT_EDITION: 'standalone',
    SAMSAR_FRAMES_MAX_CONCURRENT_TASKS: '10',
    SAMSAR_FRAMES_NUM_CHUNKS: '12',
    SAMSAR_FRAMES_MAX_FFMPEG_THREADS: '6',
  }, 64), {
    maxConcurrentTasks: 10,
    numChunks: 12,
    ffmpegThreads: 6,
  });
});

test('frame-processing upper bounds scale below, at, and above available CPUs', () => {
  const env = {
    CURRENT_ENV: 'production',
    SAMSAR_FRAMES_MAX_CONCURRENT_TASKS: '4',
    SAMSAR_FRAMES_NUM_CHUNKS: '4',
    SAMSAR_FRAMES_FFMPEG_THREADS: '4',
  };

  assert.deepEqual(getFrameProcessingLimits(env, 2), {
    maxConcurrentTasks: 2,
    numChunks: 2,
    ffmpegThreads: 2,
  });
  assert.deepEqual(getFrameProcessingLimits(env, 4), {
    maxConcurrentTasks: 4,
    numChunks: 4,
    ffmpegThreads: 4,
  });
  assert.deepEqual(getFrameProcessingLimits(env, 8), {
    maxConcurrentTasks: 4,
    numChunks: 4,
    ffmpegThreads: 4,
  });
});

test('reserved heavy-work CPU budget caps every frame-processing dimension', () => {
  const { heavyWorkCpuBudget } = getCpuResourceBudget({
    env: { SAMSAR_CPU_RESERVE: '2' },
    availableParallelism: () => 8,
    readFile: () => {
      throw new Error('No cgroup fixture');
    },
  });

  assert.equal(heavyWorkCpuBudget, 6);
  assert.deepEqual(getFrameProcessingLimits({
    CURRENT_ENV: 'production',
    SAMSAR_FRAMES_MAX_CONCURRENT_TASKS: '8',
    SAMSAR_FRAMES_NUM_CHUNKS: '8',
    SAMSAR_FRAMES_MAX_FFMPEG_THREADS: '8',
  }, heavyWorkCpuBudget), {
    maxConcurrentTasks: 6,
    numChunks: 6,
    ffmpegThreads: 6,
  });
});

test('frame FFmpeg cap uses service, global, legacy, then default precedence', () => {
  assert.equal(getFrameProcessingLimits({
    SAMSAR_FRAMES_MAX_FFMPEG_THREADS: '6',
    SAMSAR_MAX_FFMPEG_THREADS: '5',
    SAMSAR_FRAMES_FFMPEG_THREADS: '4',
  }, 8).ffmpegThreads, 6);
  assert.equal(getFrameProcessingLimits({
    SAMSAR_FRAMES_MAX_FFMPEG_THREADS: 'invalid',
    SAMSAR_MAX_FFMPEG_THREADS: '5',
    SAMSAR_FRAMES_FFMPEG_THREADS: '4',
  }, 8).ffmpegThreads, 5);
  assert.equal(getFrameProcessingLimits({
    SAMSAR_MAX_FFMPEG_THREADS: 'invalid',
    SAMSAR_FRAMES_FFMPEG_THREADS: '4',
  }, 8).ffmpegThreads, 4);
});

test('invalid processing limits fall back to positive CPU-aware defaults', () => {
  assert.deepEqual(getFrameProcessingLimits({
    CURRENT_ENV: 'production',
    SAMSAR_FRAMES_MAX_CONCURRENT_TASKS: '0',
    SAMSAR_FRAMES_NUM_CHUNKS: '-2',
    SAMSAR_FRAMES_FFMPEG_THREADS: 'not-a-number',
  }, 1), {
    maxConcurrentTasks: 1,
    numChunks: 1,
    ffmpegThreads: 1,
  });
});

test('frame worker count never exceeds available work or creates empty workers', () => {
  assert.equal(getFrameWorkerCount(0, 8), 0);
  assert.equal(getFrameWorkerCount(1, 8), 1);
  assert.equal(getFrameWorkerCount(3, 8), 3);
  assert.equal(getFrameWorkerCount(12, 8), 8);

  const ranges = buildFrameWorkerRanges(10, 6);
  assert.equal(ranges.length, 6);
  assert.deepEqual(ranges[0], { startFrame: 0, endFrame: 1 });
  assert.deepEqual(ranges.at(-1), { startFrame: 8, endFrame: 10 });
  assert.equal(ranges.every(({ startFrame, endFrame }) => endFrame > startFrame), true);
  assert.equal(
    ranges.every((range, index) => index === 0 || ranges[index - 1].endFrame === range.startFrame),
    true,
  );
});
