import { createHash, randomUUID } from 'node:crypto';
import { resolveLayerSourceSceneReference } from '../video/SceneIdentity.js';

const text = value => typeof value === 'string' ? value.trim() : '';
const status = value => text(value).toUpperCase();

export function buildExpressImageRecovery(session, { recoveryId = randomUUID(), now = new Date() } = {}) {
  if (session.videoLink || session.remoteURL || session.expressGenerationCancelled) return null;
  const prior = session.expressImageRecovery;
  if (prior?.version === 1 && prior.status === 'PENDING' && prior.sessionId === String(session._id)) {
    return { recovery: { ...prior,
      ...(session.hostedAgentBilling?.state === 'FAILED' ? { failedBillingRevision: session.hostedAgentBilling.revision } : {}),
      controlRevision: Number(session.hostedAgentBilling?.controlRevision || 0) + 1 }, layerFields: {} };
  }
  if (status(session.expressGenerationStatus?.image_generation) !== 'FAILED' ||
      status(session.expressGenerationStatus?.prompt_generation) !== 'COMPLETED') return null;

  const jobs = [];
  const layerFields = {};
  for (const [index, layer] of (session.layers || []).entries()) {
    const image = layer?.imageSession;
    if (status(image?.generationStatus) === 'COMPLETED' || layer?.isGeneratedOutroLayer) continue;
    const hasCompletedVideo = status(layer?.aiVideoGenerationStatus) === 'COMPLETED' ||
      text(layer?.aiVideoLayer) || text(layer?.aiVideoRemoteLink);
    const hasSelectedBaseImage = Array.isArray(image?.activeItemList) && image.activeItemList.some(item =>
      text(item?.type).toLowerCase() === 'image' && item?.is_base_image === true && text(item?.src));
    if (text(image?.activeGeneratedImage) || text(image?.activeSelectedImage) || hasSelectedBaseImage || hasCompletedVideo) {
      layerFields[`layers.${index}.imageSession.generationStatus`] = 'COMPLETED';
      layerFields[`layers.${index}.imageSession.generationError`] = null;
      continue;
    }
    const source = resolveLayerSourceSceneReference(session, layer, index);
    const prompt = [layer?.originalImageGenerationPrompt, image?.originalImageGenerationPrompt,
      layer?.originalImagePrompt, image?.originalImagePrompt, layer?.sourcePrompt, image?.sourcePrompt,
      layer?.originalPrompt, image?.originalPrompt, source.sourceSceneRef?.scene?.visual,
      image?.originalRetryPrompt, image?.prompt, layer?.prompt].map(text).find(Boolean);
    if (!prompt) throw Object.assign(new Error(`Original image prompt is missing for scene ${index + 1}.`), { status: 409 });
    const inferenceModel = text(session.expressGenerationInferenceModel || session.inferenceModel);
    jobs.push({
      _id: createHash('sha256').update(`${session._id}:image-recovery:${recoveryId}:${layer._id}`).digest('hex').slice(0, 24),
      videoSessionId: String(session._id), layerId: String(layer._id), userId: String(session.userId),
      imageRecoveryId: recoveryId,
      prompt, originalRetryPrompt: prompt, originalImageGenerationPrompt: prompt,
      originalImageGenerationPromptSource: layer.originalImageGenerationPromptSource || image?.originalImageGenerationPromptSource || 'initial_generation',
      originalImagePrompt: prompt, sourcePrompt: prompt, originalPrompt: prompt,
      ...(source.sourceSceneRef ? { sourceSceneRef: source.sourceSceneRef } : {}),
      ...(source.sourceSceneIndex !== null && source.sourceSceneIndex !== undefined ? { sourceSceneIndex: source.sourceSceneIndex } : {}),
      ...(source.sourceSceneIndexSource ? { sourceSceneIndexSource: source.sourceSceneIndexSource } : {}),
      model: session.expressGenerationImageModel || session.imageGenerationModel || 'GPTIMAGE2.5',
      aspectRatio: session.aspectRatio || '16:9',
      ...(inferenceModel ? { inferenceModel, selectedInferenceModel: inferenceModel, userInferenceModel: inferenceModel, expressGenerationInferenceModel: inferenceModel } : {}),
      ...(session.expressGenerationImageStyle || session.imageStyle ? { imageStyle: session.expressGenerationImageStyle || session.imageStyle } : {}),
      ...(session.customAdapterFallbacks?.text_to_image ? { customFallbackModel: session.customAdapterFallbacks.text_to_image } : {}),
      imageBillingPolicy: 'pipeline', operationType: 'GENERATE', generationStatus: 'PENDING', apiGenerationStatus: 'INIT',
      rowLocked: false, isBaseGeneration: true, isBatchGeneration: true, retryOnFailure: true,
      contentFilterRating: 3, refilterImageGenerationsRequired: true, refilterImagePassNumber: 1, imageFilterScoreRequired: true,
      failureRetryCount: 0, filterRetryCount: 0, generationRetryCount: 0,
    });
    layerFields[`layers.${index}.imageSession.generationStatus`] = 'PENDING';
    layerFields[`layers.${index}.imageSession.generationError`] = null;
  }
  if (!jobs.length && !Object.keys(layerFields).length) return null;
  return { recovery: { version: 1, id: recoveryId, sessionId: String(session._id), stage: 'image_generation',
    status: 'PENDING', createdAt: now, failedBillingRevision: session.hostedAgentBilling?.revision,
    layerOrder: (session.layers || []).map(layer => String(layer?._id)),
    controlRevision: Number(session.hostedAgentBilling?.controlRevision || 0) + 1, jobs }, layerFields };
}
