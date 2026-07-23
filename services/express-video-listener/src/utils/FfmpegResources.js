import { resolveCpuCeiling } from './CpuResources.js';

export function resolveExpressVideoFfmpegThreads({
  env = process.env,
  ...cpuOptions
} = {}) {
  return resolveCpuCeiling({
    defaultCeiling: 2,
    envNames: [
      'SAMSAR_EXPRESS_VIDEO_MAX_FFMPEG_THREADS',
      'SAMSAR_MAX_FFMPEG_THREADS',
    ],
    env,
    ...cpuOptions,
  });
}

export function buildFfmpegThreadOptions({
  threads = resolveExpressVideoFfmpegThreads(),
  inputThreads = 1,
  complexFilter = false,
} = {}) {
  const resolvedThreads = String(Math.max(1, Math.floor(Number(threads) || 1)));
  const resolvedInputThreads = String(
    Math.max(1, Math.floor(Number(inputThreads) || 1)),
  );

  return {
    inputOptions: ['-threads', resolvedInputThreads],
    filterOptions: [
      complexFilter ? '-filter_complex_threads' : '-filter_threads',
      resolvedThreads,
    ],
    outputOptions: ['-threads', resolvedThreads],
  };
}
