import { getHeavyWorkCpuBudget, parsePositiveInteger } from './CpuResources.js';

function normalize(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function getDeploymentEdition(env = process.env) {
  const edition = normalize(
    env.SAMSAR_DEPLOYMENT_EDITION || env.SAMSAR_EDITION || env.CURRENT_ENV,
  );
  if (edition === 'docker' || edition === 'community' || edition === 'standalone') {
    return 'standalone';
  }
  return edition || 'development';
}

export function isStandaloneEdition(env = process.env) {
  return getDeploymentEdition(env) === 'standalone';
}

export function isDockerRuntime(env = process.env) {
  const runtime = normalize(env.SAMSAR_RUNTIME || env.SAMSAR_DEPLOYMENT_RUNTIME);
  if (runtime) {
    return ['docker', 'container', 'compose', 'kubernetes', 'k8s'].includes(runtime);
  }
  return ['docker', 'container', 'compose', 'kubernetes', 'k8s', 'standalone', 'staging']
    .includes(normalize(env.CURRENT_ENV));
}

export function usesLocalAssetStorage(env = process.env) {
  return Boolean(env.SAMSAR_ASSETS_ROOT || env.SAMSAR_ASSETS_V2_ROOT) || isDockerRuntime(env);
}

function boundedPositiveInteger(value, fallback, maximum = 64) {
  const parsed = parsePositiveInteger(value);
  return parsed !== null && parsed <= maximum ? parsed : fallback;
}

function firstBoundedPositiveInteger(values, fallback, maximum = 64) {
  for (const value of values) {
    const parsed = parsePositiveInteger(value);
    if (parsed !== null && parsed <= maximum) {
      return parsed;
    }
  }
  return fallback;
}

export function getFrameProcessingLimits(
  env = process.env,
  heavyWorkCpuBudget = getHeavyWorkCpuBudget({ env }),
) {
  const cpuCeiling = parsePositiveInteger(heavyWorkCpuBudget) || 1;
  const useReducedDefaults = normalize(env.CURRENT_ENV) === 'development' || isStandaloneEdition(env);
  const defaultMaxConcurrentTasks = useReducedDefaults ? 2 : 6;
  const defaultNumChunks = useReducedDefaults ? 4 : 8;
  const maxConcurrentTasksCap = boundedPositiveInteger(
    env.SAMSAR_FRAMES_MAX_CONCURRENT_TASKS,
    defaultMaxConcurrentTasks,
  );
  const numChunksCap = boundedPositiveInteger(
    env.SAMSAR_FRAMES_NUM_CHUNKS,
    defaultNumChunks,
    256,
  );
  const ffmpegThreadsCap = firstBoundedPositiveInteger(
    [
      env.SAMSAR_FRAMES_MAX_FFMPEG_THREADS,
      env.SAMSAR_MAX_FFMPEG_THREADS,
      // Backward-compatible alias from the first configurable implementation.
      env.SAMSAR_FRAMES_FFMPEG_THREADS,
    ],
    2,
  );

  return {
    maxConcurrentTasks: Math.min(maxConcurrentTasksCap, cpuCeiling),
    numChunks: Math.min(numChunksCap, cpuCeiling),
    ffmpegThreads: Math.min(ffmpegThreadsCap, cpuCeiling),
  };
}

export function getFrameWorkerCount(frameCount, maxWorkers) {
  const normalizedFrameCount = Math.floor(Number(frameCount));
  const normalizedMaxWorkers = parsePositiveInteger(maxWorkers);
  if (
    !Number.isFinite(normalizedFrameCount) ||
    normalizedFrameCount <= 0 ||
    normalizedMaxWorkers === null
  ) {
    return 0;
  }

  return Math.min(normalizedFrameCount, normalizedMaxWorkers);
}

export function buildFrameWorkerRanges(frameCount, maxWorkers) {
  const normalizedFrameCount = Math.floor(Number(frameCount));
  const workerCount = getFrameWorkerCount(normalizedFrameCount, maxWorkers);
  if (workerCount === 0) {
    return [];
  }

  return Array.from({ length: workerCount }, (_, workerIndex) => ({
    startFrame: Math.floor((workerIndex * normalizedFrameCount) / workerCount),
    endFrame: Math.floor(((workerIndex + 1) * normalizedFrameCount) / workerCount),
  }));
}
