import VideoSession from '../../schema/VideoSession.js';
import { upsertGlobalSessionMapping } from '../GlobalSession.js';

const DIAGNOSTIC_FIELDS = [
  'phase', 'event', 'requestKey', 'errorCode', 'speechIndex', 'layerIndex', 'speechCount',
  'attempt', 'maxAttempts', 'maxCharacters', 'originalCharacters',
  'translatedCharacters', 'returnedCharacters', 'finalCharacters', 'completedSpeechCount',
];

export function createTranslationProgressReporter({
  sessionId, originalSessionId, model,
  write = (filter, update) => VideoSession.updateOne(filter, update),
  now = Date.now, logger = console,
}) {
  const startedAt = now();
  const progress = {
    operation: 'translate_video', sessionId, originalSessionId, model,
    status: 'IN_PROGRESS', phase: 'loading_source',
    startedAt: new Date(startedAt).toISOString(),
  };
  const report = async (event = {}) => {
    const timestamp = now();
    if (event.speechIndex !== undefined && event.speechIndex !== progress.speechIndex) {
      for (const key of ['attempt', 'maxAttempts', 'maxCharacters', 'returnedCharacters', 'finalCharacters']) {
        delete progress[key];
      }
    }
    for (const field of DIAGNOSTIC_FIELDS) {
      const value = event[field];
      if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) {
        progress[field] = value;
      }
    }
    if (event.stage && !event.phase) progress.phase = event.stage;
    if (['IN_PROGRESS', 'COMPLETED', 'FAILED'].includes(event.status)) progress.status = event.status;
    progress.updatedAt = new Date(timestamp).toISOString();
    progress.elapsedMs = Math.max(0, timestamp - startedAt);
    logger.info('[api][video][retranslation] progress', { ...progress });
    const fields = { postProcessingProgress: { ...progress } };
    if (progress.status === 'IN_PROGRESS') fields['expressGenerationStatus.status'] = 'PROCESSING';
    try {
      await write({ _id: sessionId, expressGenerationCancelled: { $ne: true } }, { $set: fields });
    } catch (error) {
      // Observability failure must not retry a model request that already finished.
      logger.warn('[api][video][retranslation] progress_write_failed', {
        sessionId, phase: progress.phase, errorCode: error?.code || 'PROGRESS_WRITE_FAILED',
      });
    }
    return { ...progress };
  };
  report.snapshot = () => ({ ...progress });
  return report;
}

function isUncertainTimeout(error) {
  return error?.code === 'ETIMEDOUT' || error?.cause?.code === 'ETIMEDOUT';
}

export async function markTranslationPreparationFailed({ sessionId, error, progress = {} }, {
  write = (filter, update) => VideoSession.updateOne(filter, update),
  updateGlobalSession = upsertGlobalSessionMapping,
  now = Date.now,
} = {}) {
  const timeout = isUncertainTimeout(error);
  const uncertain = error?.providerOutcomeUncertain === true || error?.cause?.providerOutcomeUncertain === true;
  const errorCode = timeout ? 'TRANSLATION_PROVIDER_TIMEOUT' :
    uncertain ? 'TRANSLATION_PROVIDER_OUTCOME_UNCERTAIN' :
    error?.code === 'TRANSLATED_SPEECH_VALIDATION_FAILED'
      ? error.code : 'TRANSLATION_PREPARATION_FAILED';
  const message = timeout
    ? 'Translation preparation timed out waiting for the inference provider. No automatic retry was submitted.'
    : uncertain
      ? 'Translation preparation lost the inference provider response. No automatic retry was submitted because the provider outcome is uncertain.'
    : errorCode === 'TRANSLATED_SPEECH_VALIDATION_FAILED'
      ? error.message : 'Video translation preparation failed.';
  const result = await write(
    { _id: sessionId, expressGenerationCancelled: { $ne: true } },
    { $set: {
      expressGenerationFailed: true,
      expressGenerationPending: false,
      expressGenerationError: message,
      'expressGenerationStatus.status': 'FAILED',
      postProcessingProgress: {
        ...progress, operation: 'translate_video', sessionId,
        status: 'FAILED', errorCode, updatedAt: new Date(now()).toISOString(),
      },
    } },
  );
  if (result?.matchedCount === 0) return;
  await updateGlobalSession({ sessionId, sessionType: 'video', status: 'FAILED', errorMessage: message });
}
