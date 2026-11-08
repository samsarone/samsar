import { isNetworkOutageError } from '../utils/NetworkOutagePolicy.js';

export const isRetryableMediaPreparationError = isNetworkOutageError;

async function publicationAttempt(upload, filePath, objectName, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('Lip sync media publication timed out.');
      error.code = 'ETIMEDOUT';
      reject(error);
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => upload(filePath, objectName, { signal: controller.signal })),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Only idempotent media publication is retried, always to the same object key.
 * Queue persistence/provider submission must stay outside this retry boundary. */
export async function publishLipSyncAudioWithRecovery(upload, filePath, objectName, {
  wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  timeoutMs = 60_000,
} = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await publicationAttempt(upload, filePath, objectName, timeoutMs);
    } catch (error) {
      if (!isRetryableMediaPreparationError(error)) throw error;
      if (attempt === 3) {
        const failure = new Error('Lip sync media publication failed after bounded network recovery.', { cause: error });
        failure.code = 'PROVIDER_MEDIA_PREPARATION_FAILED';
        failure.lipSyncInfrastructureFailure = true;
        throw failure;
      }
      await wait(1000 * attempt);
    }
  }
}
