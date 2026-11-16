import { buildAiVideoRetryQueueFields } from './AIVideoPromptContext.js';
import { isStandaloneEdition } from '../../utils/EnvironmentUtils.js';
import { getSourceSceneMetadata } from './SourceSceneMetadata.js';

export function getInitialVideoAdapter(model, env = process.env) {
  // Flash has its own fal contract. Never send it through the older Seedance
  // GMICloud mappings used by historical 2.0 and 2.5 requests.
  if (model === 'SEEDANCE2.5FLASHI2V' && !isStandaloneEdition(env)) return 'fal';
  if (
    (model === 'SEEDANCE2.0I2V' || model === 'SEEDANCE2.5I2V') &&
    !isStandaloneEdition(env)
  ) {
    return 'gmicloud';
  }
  return '';
}

export function buildRetryableImageToVideoQueuePayload(
  payload = {},
  overrides = {},
  env = process.env,
) {
  const initialVideoAdapter = getInitialVideoAdapter(payload.model, env);
  return {
    videoBillingPolicy: payload.videoBillingPolicy || 'pipeline',
    videoBillingAPIKeyUsage: payload.videoBillingAPIKeyUsage || null,
    expireAt: null,
    prompt: payload.prompt,
    model: payload.model,
    originalVideoModel: payload.originalVideoModel,
    sessionId: payload.videoSessionId || payload.sessionId,
    layerId: payload.layerId,
    ...getSourceSceneMetadata(payload),
    useEndFrame: payload.useEndFrame,
    useStartFrame: payload.useStartFrame,
    combineLayers: payload.combineLayers,
    aspectRatio: payload.aspectRatio,
    clipLayerToAiVideo: payload.clipLayerToAiVideo,
    userId: payload.userId,
    retryOnFail: true,
    duration: payload.duration,
    ...(initialVideoAdapter ? { dockerVideoProvider: initialVideoAdapter } : {}),
    ...overrides,
    ...buildAiVideoRetryQueueFields(payload),
  };
}
