import AudioGeneration from '../schema/AudioGeneration.js';
import {
  hasSamsarCredential,
  isInitialDockerAudioRoutingRequest,
} from '../consts/DockerProviderPriority.js';
import { isStandaloneEdition } from '../util/environmentUtils.js';
import { recordProviderUsageLog } from './ProviderUsageAudit.js';
import { isFalAudioAuthenticationRejection } from './FalAudioSubmission.js';

export function canFallbackAfterAudioAuthenticationRejection(payload, error) {
  return isFalAudioAuthenticationRejection(error) &&
    isStandaloneEdition() && isInitialDockerAudioRoutingRequest(payload) &&
    !['0', 'false', 'no', 'off'].includes(String(process.env.SAMSAR_EXTERNAL_AUDIO_ENABLED || '').trim().toLowerCase()) &&
    hasSamsarCredential() && payload.submittedAdapter === 'fal' &&
    !payload.apiRequestId && !payload.generationId && !payload.genblazeRequestId &&
    !payload.submissionOutcomeUnknown && !payload.externalAudioRoute &&
    !payload.externalAudioApiRequest &&
    !payload.generationMeta?.externalAudioApiRequest &&
    !payload.generationMeta?.externalAudioRoute &&
    !payload.generationMeta?.audioAuthFallback;
}

export async function withAudioAuthenticationFallback(payload, submit, submitFallback, {
  audioGenerationModel = AudioGeneration,
  recordUsage = recordProviderUsageLog,
} = {}) {
  try {
    return await submit();
  } catch (error) {
    if (!canFallbackAfterAudioAuthenticationRejection(payload, error)) throw error;

    // Check persisted state as well: a stale INIT payload must not move a job
    // that another worker has already submitted to a different provider.
    const fallbackRecord = await audioGenerationModel.findOneAndUpdate({
      _id: payload._id,
      status: 'INIT',
      submittedAdapter: 'fal',
      submissionOutcomeUnknown: { $ne: true },
      apiRequestId: { $in: [null, ''] },
      generationId: { $in: [null, ''] },
      genblazeRequestId: { $in: [null, ''] },
      'generationMeta.audioAuthFallback': { $exists: false },
    }, {
      $set: {
        submittedAdapter: 'samsar',
        generationMeta: {
          ...payload.generationMeta,
          audioAuthFallback: { from: 'fal', to: 'samsar', status: 401 },
        },
      },
    }, { new: true });
    if (!fallbackRecord) throw error;

    const fallbackPayload = typeof fallbackRecord.toObject === 'function'
      ? fallbackRecord.toObject() : fallbackRecord;
    const requestType = payload.generationType === 'music' ? 'text_to_music' : 'text_to_speech';
    await recordUsage({
      payload, requestType, provider: 'fal',
      model: payload.model || payload.ttsProvider,
      status: 'failed', source: 'audio_authentication_fallback',
      metadata: { statusCode: 401, fallbackProvider: 'samsar' },
    });
    return await submitFallback(fallbackPayload);
  }
}
