import { fal } from '@fal-ai/client';
import {
  createSubmissionOutcomeUnknownError,
  getProviderStatus,
} from './ProviderSubmissionSafety.js';

export function isFalAudioAuthenticationRejection(error) {
  return error?.code === 'SAMSAR_FAL_AUDIO_AUTH_REJECTED';
}

// Only errors from queue.submit can authorize a fallback. A 401 while polling
// an accepted job must never be treated as permission to submit it again.
export async function submitFalAudioRequest(endpoint, options) {
  let response;
  try {
    response = await fal.queue.submit(endpoint, options);
  } catch (error) {
    if (getProviderStatus(error) === 401) {
      const rejected = new Error(
        'Fal rejected the audio API key (HTTP 401). Update the Fal credential in deployment settings or use a configured audio adapter.',
        { cause: error },
      );
      rejected.code = 'SAMSAR_FAL_AUDIO_AUTH_REJECTED';
      rejected.status = 401;
      rejected.retryable = false;
      throw rejected;
    }
    throw createSubmissionOutcomeUnknownError(error, 'Fal audio submission');
  }
  if (!response?.request_id) {
    throw createSubmissionOutcomeUnknownError(
      new Error('Fal accepted the audio submission without returning a request ID.'),
      'Fal audio submission',
    );
  }
  return response;
}
