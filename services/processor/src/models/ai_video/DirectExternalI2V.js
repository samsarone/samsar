import AIVideoLayerGeneration from '../../schema/AIVideoLayerGeneration.js';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function buildDirectExternalI2VGenerationDocument(payload = {}) {
  const generationRequestId = normalizeString(payload.generationRequestId);
  const videoSessionId = normalizeString(payload.videoSessionId || payload.sessionId);
  const currentLayerId = normalizeString(payload.currentLayerId || payload.layerId);
  const startImage = normalizeString(payload.startImage);
  const model = normalizeString(payload.model);

  if (!generationRequestId || !videoSessionId || !currentLayerId) {
    throw new Error('Direct external image-to-video generation identity is required.');
  }
  if (!startImage || !/^https?:\/\//i.test(startImage)) {
    throw new Error('Direct external image-to-video requires one public start image URL.');
  }
  if (!model) {
    throw new Error('Direct external image-to-video requires a video model.');
  }

  return {
    _id: generationRequestId,
    sessionId: videoSessionId,
    layerId: currentLayerId,
    prompt: normalizeString(payload.prompt),
    model,
    status: 'INIT',
    startImage,
    useStartFrame: true,
    useEndFrame: false,
    combineLayers: false,
    aspectRatio: normalizeString(payload.aspectRatio) || '16:9',
    clipLayerToAiVideo: false,
    usePromptOptimizer: false,
    generateAudio: false,
    duration: Number(payload.duration) || 5,
    framesPerSecond: Number(payload.framesPerSecond) || 24,
    userId: payload.userId?.toString?.() || payload.userId,
    retryOnFail: false,
    rowLocked: false,
    isExternalDirectImageToVideo: true,
    externalRequestIdempotencyKey: normalizeString(payload.externalRequestIdempotencyKey),
    expireAt: new Date(),
  };
}

/**
 * Queue exactly one provider-facing generation document for a direct external
 * image-to-video attempt. The deterministic _id makes concurrent or repeated
 * HTTP submissions with the same idempotency key converge on the same job.
 */
export async function requestRenderDirectExternalI2VVideo(
  payload,
  { generationModel = AIVideoLayerGeneration } = {},
) {
  const generationDocument = buildDirectExternalI2VGenerationDocument(payload);
  try {
    return await generationModel.findOneAndUpdate(
      { _id: generationDocument._id },
      { $setOnInsert: generationDocument },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    );
  } catch (error) {
    if (error?.code !== 11000) {
      throw error;
    }
    return generationModel.findById(generationDocument._id);
  }
}
