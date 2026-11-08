import AudioGeneration from '../schema/AudioGeneration.js';
import VideoSession from '../schema/VideoSession.js';
import { isNetworkOutageError, decideNetworkOutageAction } from './NetworkOutagePolicy.js';

const plain = value => typeof value?.toObject === 'function' ? value.toObject() : value;
const id = value => value?.toString?.() || '';
const limit = (value, fallback, max) => Number.isFinite(Number(value)) && Number(value) > 0
  ? Math.min(max, Math.max(1, Math.floor(Number(value)))) : fallback;

export function isAudioNetworkError(error) {
  if (isNetworkOutageError(error)) return true;
  const visited = new Set();
  for (let current = error; current && !visited.has(current); current = current.cause) {
    visited.add(current);
    if (/network|timed?\s*out|socket hang up|fetch failed|tunnel.*(?:unreachable|unavailable)/i.test(String(current.message || ''))) return true;
  }
  return false;
}

export function buildAudioNetworkRecovery(request, error, { env = process.env, now = Date.now(), definitive = false } = {}) {
  const errors = Math.max(0, Number(request.providerNetworkErrorCount) || 0) + 1;
  const storedFirst = request.providerNetworkFirstErrorAt ? new Date(request.providerNetworkFirstErrorAt).getTime() : now;
  const first = Number.isFinite(storedFirst) ? storedFirst : now;
  const maxErrors = limit(env.SAMSAR_AUDIO_NETWORK_MAX_ERRORS, 5, 100);
  const maxElapsed = limit(env.SAMSAR_AUDIO_NETWORK_MAX_ELAPSED_MS, 300000, 3600000);
  const decision = decideNetworkOutageAction({ phase: 'poll', error, providerRequestId: request.apiRequestId || request.generationId,
    attempt: errors, maxAttempts: maxErrors });
  const exhausted = definitive || !isAudioNetworkError(error) || decision.action === 'fail' || errors >= maxErrors || now - first >= maxElapsed;
  const code = definitive ? 'AUDIO_PROVIDER_MEDIA_UNAVAILABLE' : 'AUDIO_PROVIDER_NETWORK_EXHAUSTED';
  const message = definitive
    ? 'The audio provider could not download required media. The completed request cannot be resumed.'
    : 'Audio generation stopped after repeated network failures.';
  return { exhausted, code, message, set: {
    rowLocked: false,
    providerNetworkErrorCount: errors,
    providerNetworkFirstErrorAt: new Date(first),
    providerNetworkLastErrorAt: new Date(now),
    providerNetworkRecoveryExhausted: exhausted,
    nextAttemptAfter: exhausted ? null : new Date(now + Math.min(30000, 2000 * 2 ** Math.min(errors - 1, 4))),
    ...(exhausted ? { status: 'FAILED', retryOnFail: false, error: message } : {}),
  } };
}

// Always reload the receipt: submission may have succeeded before a later
// usage-log/download write threw. Never let a stale INIT payload erase that ID.
export async function recoverAudioProviderNetworkError(payload, error, {
  AudioModel = AudioGeneration, SessionModel = VideoSession, markFailed,
  env = process.env, now = Date.now(), definitive = false, ambiguous = false,
} = {}) {
  const document = await AudioModel.findById(payload._id);
  if (!document) return true;
  const request = plain(document);
  if (request.providerNetworkRecoveryExhausted || ['COMPLETED', 'CANCELLED'].includes(request.status)) return true;
  const providerId = request.apiRequestId || request.generationId;
  const unknownSubmission = ambiguous && (request.status === 'INIT' && !providerId || error?.providerRequestUnpollable === true);
  if (!unknownSubmission && (request.status !== 'PENDING' || !providerId)) return false;
  if (!unknownSubmission && !definitive && !isAudioNetworkError(error)) return false;
  const session = request.sessionId ? plain(await SessionModel.findOne({ _id: request.sessionId }, {
    isExpressGeneration: 1, expressGenerationPending: 1, expressGenerationPaused: 1,
    expressGenerationCancelled: 1, expressGenerationFailed: 1, audioLayers: 1,
  })) : null;
  const audio = session?.audioLayers?.find(row => id(row._id) === id(request.audioLayerId));
  const completed = audio?.generationStatus === 'COMPLETED' && Boolean(audio.selectedLocalAudioLink || audio.selectedRemoteAudioLink || audio.audioLink);
  const controls = session?.expressGenerationPaused || session?.expressGenerationCancelled || session?.expressGenerationFailed || completed;
  const filter = { _id: request._id, status: request.status,
    ...(unknownSubmission ? { providerSubmissionStartedAt: request.providerSubmissionStartedAt,
      ...(providerId ? { [request.apiRequestId ? 'apiRequestId' : 'generationId']: providerId }
        : { apiRequestId: { $in: [null, ''] }, generationId: { $in: [null, ''] } }) }
      : { [request.apiRequestId ? 'apiRequestId' : 'generationId']: providerId }) };
  if (controls) {
    await AudioModel.updateOne(filter, { $set: { rowLocked: false,
      ...(unknownSubmission ? { status: 'FAILED', retryOnFail: false, submissionOutcomeUnknown: true,
        providerNetworkRecoveryExhausted: true, error: 'Audio provider acceptance could not be confirmed. The request will not be resubmitted.' } : {}),
    } });
    return true;
  }
  const plan = unknownSubmission ? {
    exhausted: true, code: 'PROVIDER_SUBMISSION_OUTCOME_UNKNOWN',
    message: 'Audio provider acceptance could not be confirmed. The request will not be resubmitted.',
    set: { status: 'FAILED', rowLocked: false, retryOnFail: false, submissionOutcomeUnknown: true,
      providerNetworkRecoveryExhausted: true, nextAttemptAfter: null },
  } : buildAudioNetworkRecovery(request, error, { env, now, definitive });
  if (unknownSubmission) plan.set.error = plan.message;
  if (Number(request.providerNetworkErrorCount) > 0) filter.providerNetworkErrorCount = request.providerNetworkErrorCount;
  else filter.$or = [{ providerNetworkErrorCount: 0 }, { providerNetworkErrorCount: { $exists: false } }];
  if (plan.exhausted) Object.assign(plan.set, { providerNetworkFailureCode: plan.code,
    providerNetworkFailureMessage: plan.message, providerNetworkFailureFinalized: false });
  const result = await AudioModel.updateOne(filter, { $set: plan.set });
  if (result?.matchedCount === 0 || !plan.exhausted) return true;
  await finalizeAudioInfrastructureFailure({ ...request, ...plan.set }, { AudioModel, SessionModel, markFailed, now });
  return true;
}

async function finalizeAudioInfrastructureFailure(request, { AudioModel, SessionModel, markFailed, now }) {
  const readSession = () => request.sessionId ? SessionModel.findOne({ _id: request.sessionId }, {
    isExpressGeneration: 1, expressGenerationPending: 1, expressGenerationPaused: 1,
    expressGenerationCancelled: 1, expressGenerationFailed: 1, audioLayers: 1,
  }) : null;
  const canMarkSessionFailure = session => session?.isExpressGeneration && session.expressGenerationPending === true &&
    !session.expressGenerationPaused && !session.expressGenerationCancelled && !session.expressGenerationFailed &&
    (session.audioLayers || []).some(audio => id(audio._id) === id(request.audioLayerId) && audio.generationStatus !== 'COMPLETED');
  const session = plain(await readSession());
  if (session?.expressGenerationPaused) return;
  if (canMarkSessionFailure(session)) {
    const providerId = request.apiRequestId || request.generationId;
    const result = await SessionModel.updateOne({
      _id: request.sessionId, expressGenerationPending: true,
      expressGenerationPaused: { $ne: true }, expressGenerationCancelled: { $ne: true }, expressGenerationFailed: { $ne: true },
      audioLayers: { $elemMatch: { _id: request.audioLayerId, generationStatus: { $ne: 'COMPLETED' } } },
    }, { $set: {
      providerNetworkFailure: { code: request.providerNetworkFailureCode, message: request.providerNetworkFailureMessage, stage: 'audio_generation',
        audioLayerId: id(request.audioLayerId), requestId: id(request._id), providerRequestId: providerId ? String(providerId) : null,
        phase: request.submissionOutcomeUnknown ? 'submit' : 'poll_or_download', failedAt: new Date(now) },
      'audioLayers.$[audio].generationStatus': 'FAILED',
      'audioLayers.$[audio].generationError': request.providerNetworkFailureMessage,
    } }, { arrayFilters: [{ 'audio._id': request.audioLayerId, 'audio.generationStatus': { $ne: 'COMPLETED' } }] });
    if (result?.matchedCount === 0 || result?.n === 0) {
      const latest = plain(await readSession());
      // A racing pause must retain this failure receipt for settlement after
      // resume. Completed/cancelled/inactive/deleted targets need no failure.
      if (latest?.expressGenerationPaused || canMarkSessionFailure(latest)) return;
    }
  } else if (!session?.isExpressGeneration && markFailed) {
    await markFailed(request._id, request.providerNetworkFailureMessage);
  }
  await AudioModel.updateOne({ _id: request._id, status: 'FAILED', providerNetworkRecoveryExhausted: true },
    { $set: { providerNetworkFailureFinalized: true } });
}

// Controls are re-read immediately before dispatch. Express owns consumption
// of network markers, including stale source targets and late completed output.
export async function canDispatchAudioRequest(request, { SessionModel = VideoSession } = {}) {
  if (!request.sessionId) return true;
  const session = plain(await SessionModel.findOne({ _id: request.sessionId }, {
    expressGenerationPaused: 1, expressGenerationCancelled: 1,
    expressGenerationFailed: 1,
  }));
  return !session || !(session.expressGenerationPaused || session.expressGenerationCancelled ||
    session.expressGenerationFailed);
}

// Only new-protocol INIT submissions have this lease. Do not unlock and resend
// an expired POST whose response/acceptance write was lost during a DB outage.
export async function recoverExpiredAudioSubmissions({
  AudioModel = AudioGeneration, now = Date.now(), ...dependencies
} = {}) {
  const requests = await AudioModel.find({ rowLocked: true, status: 'INIT',
    providerSubmissionStartedAt: { $ne: null }, providerSubmissionLeaseExpiresAt: { $lte: new Date(now) } });
  for (const request of requests) {
    await recoverAudioProviderNetworkError(request, new Error('Audio submission ownership expired.'), {
      ...dependencies, AudioModel, now, ambiguous: true,
    });
  }
  // A failed session-marker write must not make the queue receipt disappear.
  // This only finalizes failures created by this protocol, never old jobs.
  const failed = await AudioModel.find({ status: 'FAILED', providerNetworkRecoveryExhausted: true,
    providerNetworkFailureCode: { $type: 'string' }, providerNetworkFailureFinalized: { $ne: true } });
  for (const document of failed) {
    await finalizeAudioInfrastructureFailure(plain(document), {
      ...dependencies, AudioModel, SessionModel: dependencies.SessionModel || VideoSession, now,
    });
  }
}
