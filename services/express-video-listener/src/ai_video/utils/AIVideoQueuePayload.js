import { buildAiVideoRetryQueueFields } from './AIVideoPromptContext.js';

export function buildRetryableImageToVideoQueuePayload(payload = {}, overrides = {}) {
  return {
    prompt: payload.prompt,
    model: payload.model,
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
    ...overrides,
    ...buildAiVideoRetryQueueFields(payload),
  };
}
