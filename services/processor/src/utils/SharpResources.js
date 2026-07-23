import sharp from 'sharp';

import { resolveProcessorSharpThreadLimit } from './CpuBudget.js';

export function configureProcessorSharpConcurrency(options = {}) {
  const sharpModule = options.sharpModule || sharp;
  if (typeof sharpModule?.concurrency !== 'function') {
    throw new TypeError('Sharp concurrency API is unavailable');
  }

  const threadLimit = resolveProcessorSharpThreadLimit(options);
  sharpModule.concurrency(threadLimit);
  return threadLimit;
}
