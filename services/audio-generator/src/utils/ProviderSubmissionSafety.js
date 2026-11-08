import { isNetworkOutageError } from './NetworkOutagePolicy.js';

export function getProviderStatus(error) {
  const visited = new Set();
  let current = error;
  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    const status = Number(current.status ?? current.statusCode ?? current.response?.status);
    if (Number.isInteger(status) && status > 0) return status;
    current = current.cause;
  }
  const messageStatus = Number(String(error?.message || '').match(/(?:^|\s)(\d{3})(?:\s|$)/)?.[1]);
  if (Number.isInteger(messageStatus) && messageStatus > 0) return messageStatus;
  return null;
}

export function isSubmissionOutcomeUnknown(error) {
  const status = getProviderStatus(error);
  if (status !== null) {
    return status === 408 || status === 409 || status >= 500;
  }
  return true;
}

export function createSubmissionOutcomeUnknownError(error, context = 'Provider submission') {
  if (!isSubmissionOutcomeUnknown(error)) {
    return error;
  }
  const message = error?.message || String(error || 'unknown provider error');
  const wrapped = new Error(`${context} outcome is unknown: ${message}`, { cause: error });
  wrapped.code = 'SAMSAR_SUBMISSION_OUTCOME_UNKNOWN';
  wrapped.submissionOutcomeUnknown = true;
  wrapped.retryable = false;
  return wrapped;
}

export function isSubmissionOutcomeUnknownError(error) {
  return error?.submissionOutcomeUnknown === true ||
    error?.code === 'SAMSAR_SUBMISSION_OUTCOME_UNKNOWN';
}


// Preserve typed infrastructure failures for the common worker boundary. A
// provider content rejection keeps its existing retry/fallback semantics.
export function rethrowAudioInfrastructureError(value) {
  const details = [value?.detail, value?.body?.detail, value?.data?.detail,
    value?.response?.data?.detail, value?.error?.detail].flat().filter(Boolean);
  if (details.some(item => /^(?:file_download_error|media_download_error|url_unreachable|download_error)$/i.test(String(item?.type || '')))) {
    const error = new Error('The audio provider could not download required media.', value instanceof Error ? { cause: value } : undefined);
    error.code = 'PROVIDER_MEDIA_DOWNLOAD_FAILED';
    error.providerMediaUnavailable = true;
    throw error;
  }
  if (value?.providerMediaUnavailable || value?.providerRequestUnpollable ||
      isSubmissionOutcomeUnknownError(value) || isNetworkOutageError(value)) throw value;
}


// Only use in the media-download phase, where these statuses mean that an
// accepted request's output cannot be retrieved by replaying generation.
export function rethrowAudioMediaDownloadError(error) {
  if ([400, 403, 404, 410].includes(getProviderStatus(error))) error.providerMediaUnavailable = true;
  throw error;
}
