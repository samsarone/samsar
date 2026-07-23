import { resolveCpuCeiling } from './CpuResources.js';

export function resolveExpressVideoSharpThreads({
  env = process.env,
  ...cpuOptions
} = {}) {
  return resolveCpuCeiling({
    defaultCeiling: 4,
    envNames: [
      'SAMSAR_EXPRESS_VIDEO_MAX_SHARP_THREADS',
      'SAMSAR_MAX_SHARP_THREADS',
    ],
    env,
    ...cpuOptions,
  });
}

export function configureExpressVideoSharpConcurrency(
  sharpImplementation,
  options = {},
) {
  if (typeof sharpImplementation?.concurrency !== 'function') {
    throw new TypeError('A Sharp implementation with concurrency() is required');
  }
  const threads = resolveExpressVideoSharpThreads(options);
  sharpImplementation.concurrency(threads);
  return threads;
}
