import { randomUUID } from 'node:crypto';
import ImageGeneration from '../schema/ImageGeneration.js';
import { isSubmissionOutcomeUnknown } from './ProviderSubmissionSafety.js';

const unresolvedStates = ['SUBMITTING', 'UNKNOWN'];
const liveStates = [...unresolvedStates, 'ACCEPTED'];

function unknownSubmissionError() {
  return Object.assign(new Error('Image submission acceptance is unknown; refusing to submit it again.'), {
    code: 'IMAGE_SUBMISSION_OUTCOME_UNKNOWN', submissionOutcomeUnknown: true,
    nonPromptProviderFailure: true,
  });
}

function providerStatus(payload) {
  return String(payload.operationType === 'GENERATE'
    ? payload.apiGenerationStatus || 'INIT' : payload.apiEditStatus || 'INIT').toUpperCase();
}

function imageAttempt(payload) {
  return [payload.failureRetryCount || 0, payload.filterRetryCount || 0,
    payload.refilterImagePassNumber || 0, payload.retryCount || 0].join(':');
}

function imageFilterAttempt(payload) {
  return [payload.filterRetryCount || 0, payload.refilterImagePassNumber || 0,
    payload.retryCount || 0].join(':');
}

// Persist ownership before entering any INIT adapter. A crash or database outage
// cannot turn an unrecorded upstream acceptance into another paid submission.
export async function beginImageSubmissionAttempt(payload, {
  Model = ImageGeneration, token = randomUUID(), now = new Date(),
} = {}) {
  if (providerStatus(payload) !== 'INIT') return null;
  if (payload.submissionOutcomeUnknown || liveStates.includes(payload.imageSubmissionAttempt?.state)) {
    throw unknownSubmissionError();
  }
  if (payload.imageSubmissionAttempt?.state === 'COMPLETED' &&
      payload.imageSubmissionAttempt.filterAttempt === imageFilterAttempt(payload)) {
    throw Object.assign(unknownSubmissionError(), {
      message: 'Image provider already returned a result; refusing to regenerate it.',
      code: 'IMAGE_SUBMISSION_ALREADY_COMPLETED',
    });
  }
  const marker = { version: 1, state: 'SUBMITTING', token, startedAt: now,
    operation: payload.operationType,
    attempt: imageAttempt(payload), filterAttempt: imageFilterAttempt(payload) };
  const result = await Model.updateOne({ _id: payload._id, $or: [
    { imageSubmissionAttempt: { $exists: false } },
    { 'imageSubmissionAttempt.state': { $in: ['ACCEPTED', 'COMPLETED', 'REJECTED'] } },
  ] }, { $set: { imageSubmissionAttempt: marker } });
  if (result?.matchedCount !== 1) throw unknownSubmissionError();
  payload.imageSubmissionAttempt = marker;
  return marker;
}

export async function resolveImageSubmissionAttempt(payload, state, { Model = ImageGeneration } = {}) {
  const marker = payload.imageSubmissionAttempt;
  if (!marker || !liveStates.includes(marker.state)) return;
  await Model.updateOne({ _id: payload._id, 'imageSubmissionAttempt.token': marker.token,
    'imageSubmissionAttempt.state': { $in: liveStates } },
  { $set: { 'imageSubmissionAttempt.state': state } });
  marker.state = state;
}

// Only definitive rejection or a returned image allows an intentional retry.
// A transport error, missing receipt, or swallowed submit error is ambiguous.
export async function observeImageSubmissionFailure(payload, error, {
  Model = ImageGeneration, definitive = false,
} = {}) {
  if (payload.imageSubmissionAttempt?.state === 'ACCEPTED') {
    if ((definitive || error?.definitiveAdapterFailure) && !error?.submissionOutcomeUnknown) {
      await resolveImageSubmissionAttempt(payload, 'REJECTED', { Model });
    }
    return;
  }
  if (!unresolvedStates.includes(payload.imageSubmissionAttempt?.state)) return;
  const knownRejection = payload.imageSubmissionAttempt.state === 'SUBMITTING' &&
    !payload.submissionOutcomeUnknown && !error?.submissionOutcomeUnknown &&
    (definitive || error?.definitiveAdapterFailure || !isSubmissionOutcomeUnknown({
      status: error?.status, statusCode: error?.statusCode, response: error?.response,
      cause: error?.cause, message: error?.message || error?.error,
    }));
  if (knownRejection) {
    await resolveImageSubmissionAttempt(payload, 'REJECTED', { Model });
    return;
  }
  payload.submissionOutcomeUnknown = true;
  if (error && typeof error === 'object') error.submissionOutcomeUnknown = true;
  await resolveImageSubmissionAttempt(payload, 'UNKNOWN', { Model });
}

// Retry read-only polling against its accepted request. Never let a generic
// generation retry reset this receipt to INIT or select another adapter.
export async function deferAcceptedImagePoll(payload, {
  Model = ImageGeneration, now = Date.now(), maxFailures = 3,
} = {}) {
  const marker = payload.imageSubmissionAttempt;
  if (marker?.state !== 'ACCEPTED' || providerStatus(payload) !== 'PENDING' || !payload.apiRequestId) return false;
  const failures = (Number(marker.pollFailures) || 0) + 1;
  if (failures >= maxFailures) {
    throw Object.assign(unknownSubmissionError(), {
      message: 'Image provider polling failed repeatedly; refusing to resubmit the accepted request.',
      code: 'IMAGE_PROVIDER_POLL_RETRIES_EXHAUSTED',
    });
  }
  const field = payload.operationType === 'GENERATE' ? 'apiGenerationStatus' : 'apiEditStatus';
  const result = await Model.updateOne({ _id: payload._id, apiRequestId: payload.apiRequestId,
    [field]: 'PENDING', 'imageSubmissionAttempt.token': marker.token,
  }, { $set: { rowLocked: false, nextAttemptAfter: new Date(now + 15000),
    'imageSubmissionAttempt.pollFailures': failures } });
  if (result?.matchedCount !== 1) throw unknownSubmissionError();
  marker.pollFailures = failures;
  return true;
}

export async function finishImageSubmissionAttempt(payload, { Model = ImageGeneration } = {}) {
  if (!payload.imageSubmissionAttempt) return;
  const current = await Model.findById(payload._id).lean();
  if (!current || current.imageSubmissionAttempt?.token !== payload.imageSubmissionAttempt.token ||
      !unresolvedStates.includes(current.imageSubmissionAttempt?.state)) return;
  const status = providerStatus(current);
  if ((['PENDING', 'COMPLETED'].includes(status) && current.apiRequestId) ||
      current.imageDeliveryPending && current.imageBillingSavedResult) {
    await resolveImageSubmissionAttempt(payload, 'ACCEPTED', { Model });
    return;
  }
  // A terminal row is never picked up again. Preserve its unresolved receipt
  // rather than converting it back to INIT or rotating to another adapter.
  if (status === 'FAILED') return;
  throw unknownSubmissionError();
}

export async function runImageSubmissionAttempt(payload, operation, dependencies = {}) {
  const marker = await beginImageSubmissionAttempt(payload, dependencies);
  try {
    const result = await operation();
    if (marker) await finishImageSubmissionAttempt(payload, dependencies);
    return result;
  } catch (error) {
    if (marker && !error.imageBillingPending) {
      await observeImageSubmissionFailure(payload, error, dependencies);
    }
    throw error;
  }
}
