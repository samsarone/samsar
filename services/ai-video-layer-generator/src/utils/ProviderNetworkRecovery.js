const NETWORK_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 530]);
const NETWORK_CODES = new Set(['ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND',
  'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET', 'SAMSAR_MEDIA_TUNNEL_UNREACHABLE']);
const FAILURE_CODES = new Set(['PROVIDER_NETWORK_RETRY_EXHAUSTED', 'PROVIDER_SUBMISSION_OUTCOME_UNKNOWN',
  'PROVIDER_MEDIA_DOWNLOAD_FAILED', 'PROVIDER_NETWORK_WAIT_EXPIRED', 'PROVIDER_MEDIA_PREPARATION_FAILED',
  'PROVIDER_POLL_REJECTED']);
const EXECUTION_ERROR_STATUSES = new Set([500, 502, 503, 504]);
const EXECUTION_ERROR_TYPES = new Set([
  'downstream_service_unavailable', 'downstream_service_error', 'generation_timeout',
]);

function isTerminalProviderExecutionError(providerStatus = {}) {
  const details = providerStatus.detail;
  return EXECUTION_ERROR_STATUSES.has(Number(providerStatus.status)) &&
    Array.isArray(details) && details.length > 0 && details.every(item =>
      EXECUTION_ERROR_TYPES.has(item?.type) && typeof item?.msg === 'string' && item.msg.trim());
}

export { providerRequestFetch } from './ProviderNetworkTransport.js';

export function isProviderNetworkError(error) {
  return isNetworkOutageError(error);
}

export function getInfrastructureFailureCode(request = {}) {
  if (FAILURE_CODES.has(request.infrastructureFailureCode)) return request.infrastructureFailureCode;
  if (request.submissionOutcomeUnknown) return 'PROVIDER_SUBMISSION_OUTCOME_UNKNOWN';
  if (request.infrastructureFailure || request.transientProviderErrorExhausted) return 'PROVIDER_NETWORK_RETRY_EXHAUSTED';
  return null;
}

export function getProviderResultInfrastructureCode(response = {}) {
  if (FAILURE_CODES.has(response.providerFailureCode)) return response.providerFailureCode;
  const detail = response.providerStatus?.detail;
  const types = Array.isArray(detail) ? detail.map(item => item?.type || '') : [];
  if (types.some(type => /file_download|media_download|url_unreachable|download_error/i.test(type))) {
    return 'PROVIDER_MEDIA_DOWNLOAD_FAILED';
  }
  // These typed failures belong to an execution whose status was COMPLETED,
  // even when its result uses HTTP 5xx. An ordinary status/gateway 5xx still
  // leaves the accepted execution's outcome unknown.
  if (response.providerExecutionFailed === true && isTerminalProviderExecutionError(response.providerStatus)) {
    return null;
  }
  if (types.some(type => /gateway|unavailable|network|connection|timeout/i.test(type)) ||
      NETWORK_STATUSES.has(Number(response.providerStatus?.status))) return 'PROVIDER_NETWORK_RETRY_EXHAUSTED';
  return null;
}

export function completedProviderResultFailure(error) {
  const body = error?.body || error?.response?.data || error?.data;
  const details = Array.isArray(body?.detail) ? body.detail.filter(item =>
    typeof item?.type === 'string' && typeof item?.msg === 'string') : [];
  if (!details.length) return null;
  const providerStatus = { ...body, status: error?.response?.status ?? error?.statusCode ?? error?.status };
  const providerExecutionFailed = isTerminalProviderExecutionError(providerStatus);
  return { responseStatus: 'FAILED', providerStatus,
    providerFailureMessage: details.map(item => item.msg).join('; '),
    providerFailureCode: getProviderResultInfrastructureCode({ providerStatus, providerExecutionFailed }),
    ...(providerExecutionFailed ? { providerExecutionFailed: true } : {}),
  };
}

// A rejected result belongs to a completed execution. A rejection from the
// status endpoint does not establish whether the accepted job has failed.
export async function readProviderVideoResult(readResult) {
  try {
    return await readResult();
  } catch (error) {
    if (error && typeof error === 'object') error.providerOperation = 'result';
    throw error;
  }
}

export function getProviderExecutionRejection(error) {
  const status = Number(error?.response?.status ?? error?.statusCode ?? error?.status);
  if (error?.providerOperation !== 'result') return null;
  const body = error?.body || error?.response?.data || error?.data;
  const providerStatus = { ...(body && typeof body === 'object' ? body : { detail: body }), status };
  const providerExecutionFailed = isTerminalProviderExecutionError(providerStatus);
  if (status !== 422 && !providerExecutionFailed) return null;
  if (getProviderResultInfrastructureCode({ providerStatus, providerExecutionFailed })) return null;
  const failure = completedProviderResultFailure(error);
  const providerFailureMessage = failure?.providerFailureMessage || [
    body?.detail, body?.error?.message, body?.error, body?.message, error?.message,
  ].find(value => typeof value === 'string' && value.trim()) || 'Provider rejected video generation.';
  return { responseStatus: 'FAILED', providerStatus, providerFailureMessage, providerFailureCode: null };
}

export function isProviderHttpFailure(error) {
  return Number(error?.status || error?.statusCode || error?.response?.status) >= 400;
}

export function buildProviderInfrastructureFailure(request = {}, code, message, now = new Date()) {
  const type = request.generationType || '';
  const stage = type === 'lip_sync' || /LIPSYNC|LATENTSYNC/.test(request.model || '') ? 'lip_sync_generation'
    : type === 'sound_effect' ? 'sound_effect_generation' : 'ai_video_generation';
  return { code, message, stage, layerId: String(request.layerId || ''),
    requestId: String(request._id || ''), providerRequestId: request.generationId || null,
    phase: request.transientProviderErrorPhase || (request.generationId ? 'poll' : 'submit'), failedAt: now };
}

export function isUsableCompletedRequestLayer(request = {}, layer = {}) {
  const type = request.generationType || '';
  if (type === 'lip_sync' || /LIPSYNC|LATENTSYNC/.test(request.model || '')) {
    return layer.lipSyncVideoGenerationStatus === 'COMPLETED' &&
      Boolean(layer.lipSyncVideoLayer || layer.lipSyncRemoteLink) && !layer.lipSyncGenerationPending;
  }
  if (type === 'sound_effect') return layer.soundEffectVideoGenerationStatus === 'COMPLETED' &&
    Boolean(layer.soundEffectVideoLayer || layer.soundEffectRemoteLink) && !layer.soundEffectGenerationPending;
  return layer.aiVideoGenerationStatus === 'COMPLETED' && Boolean(layer.aiVideoLayer || layer.aiVideoRemoteLink) &&
    !layer.aiVideoGenerationPending;
}

// Recover only leases created by this protocol. Legacy rows are deliberately
// outside this bounded network-recovery path; it is not a session restart sweep.
export function buildExpiredProviderLeaseRecovery(request = {}, now = new Date()) {
  if (!request.requestOwner || !request.requestLeaseExpiresAt ||
      new Date(request.requestLeaseExpiresAt).getTime() > now.getTime()) return null;
  const accepted = Boolean(request.generationId || request.videoBillingSavedResult);
  const ambiguous = !accepted && Boolean(request.providerSubmissionStartedAt);
  return {
    $set: { rowLocked: false, requestOwner: null, requestLeaseExpiresAt: null,
      ...(accepted ? { status: 'PENDING' } : ambiguous ? {
        status: 'FAILED', retryOnFail: false, dockerAdapterFailoverDisabled: true,
        submissionOutcomeUnknown: true, infrastructureFailure: true,
        infrastructureFailureCode: 'PROVIDER_SUBMISSION_OUTCOME_UNKNOWN',
        lastProviderFailureMessage: 'Worker ownership expired after submission began; provider acceptance is unknown. The request will not be resubmitted.',
      } : { status: 'INIT' }), expireAt: null },
  };
}
import { isNetworkOutageError } from './NetworkOutagePolicy.js';
