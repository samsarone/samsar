import {
  normalizePositiveCpuCount,
  resolveProcessorFfmpegThreadLimit,
} from './CpuBudget.js';

export function buildProcessorFfmpegThreadOptions(
  threadCount,
  {
    decoderThreads = threadCount,
  } = {},
) {
  const normalizedThreadCount = normalizePositiveCpuCount(threadCount) || 1;
  const normalizedDecoderThreadCount = Math.min(
    normalizePositiveCpuCount(decoderThreads) || 1,
    normalizedThreadCount,
  );
  const threadValue = String(normalizedThreadCount);

  return {
    threadCount: normalizedThreadCount,
    decoderThreadCount: normalizedDecoderThreadCount,
    inputOptions: ['-threads', String(normalizedDecoderThreadCount)],
    simpleFilterOptions: ['-filter_threads', threadValue],
    complexFilterOptions: ['-filter_complex_threads', threadValue],
    encoderOptions: ['-threads', threadValue],
    outputOptions: [
      '-filter_threads', threadValue,
      '-filter_complex_threads', threadValue,
      '-threads', threadValue,
    ],
  };
}

export function createOnDemandWeightedCpuPool({ getCapacity }) {
  if (typeof getCapacity !== 'function') {
    throw new TypeError('createOnDemandWeightedCpuPool requires getCapacity');
  }

  let activeWeight = 0;
  const pending = [];

  const resolveCapacity = () => {
    try {
      return normalizePositiveCpuCount(getCapacity()) || 1;
    } catch {
      return 1;
    }
  };

  const drain = () => {
    while (pending.length > 0) {
      const capacity = resolveCapacity();
      const next = pending[0];
      const grantedWeight = Math.min(next.requestedWeight, capacity);
      if (activeWeight + grantedWeight > capacity) {
        return;
      }

      pending.shift();
      activeWeight += grantedWeight;
      let released = false;
      next.resolve({
        weight: grantedWeight,
        release() {
          if (released) {
            return;
          }
          released = true;
          activeWeight = Math.max(0, activeWeight - grantedWeight);
          drain();
        },
      });
    }
  };

  return {
    acquire(weight = 1) {
      const requestedWeight = normalizePositiveCpuCount(weight) || 1;
      return new Promise((resolve) => {
        pending.push({ requestedWeight, resolve });
        drain();
      });
    },
    getSnapshot() {
      return {
        activeWeight,
        pendingCount: pending.length,
      };
    },
  };
}

let processorFfmpegCpuPool = null;

function getProcessorFfmpegCpuPool() {
  if (!processorFfmpegCpuPool) {
    // This is a counter-only admission gate. It creates no worker threads and
    // consumes no CPU while there is no active FFmpeg command.
    processorFfmpegCpuPool = createOnDemandWeightedCpuPool({
      getCapacity: () => resolveProcessorFfmpegThreadLimit(),
    });
  }
  return processorFfmpegCpuPool;
}

export async function withProcessorFfmpegResources(
  operation,
  {
    decoderThreads,
    requestedThreads,
  } = {},
) {
  if (typeof operation !== 'function') {
    throw new TypeError('withProcessorFfmpegResources requires an operation');
  }

  const resolvedThreadCount = normalizePositiveCpuCount(requestedThreads)
    || resolveProcessorFfmpegThreadLimit();
  const allocation = await getProcessorFfmpegCpuPool().acquire(resolvedThreadCount);
  const threadOptions = buildProcessorFfmpegThreadOptions(
    allocation.weight,
    { decoderThreads },
  );

  try {
    return await operation(threadOptions);
  } finally {
    allocation.release();
  }
}
