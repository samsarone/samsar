import { buildAiVideoRetryQueueFields } from './AIVideoPromptContext.js';
import { isStandaloneEdition } from '../../utils/EnvironmentUtils.js';

export function getInitialVideoAdapter(model, env = process.env) {
  if (model === 'SEEDANCE2.0I2V' && !isStandaloneEdition(env)) {
    return 'gmicloud';
  }
  return '';
}

export function buildRetryableImageToVideoQueuePayload(payload = {}, overrides = {}) {
  const initialVideoAdapter = getInitialVideoAdapter(payload.model);
  return {
    prompt: payload.prompt,
    model: payload.model,
    originalVideoModel: payload.originalVideoModel,
    sessionId: payload.videoSessionId || payload.sessionId,
    layerId: payload.layerId,
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
