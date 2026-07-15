import { normalizeInferenceModel } from '../../consts/InferenceModels.js';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function getStoredSessionInferenceModel(sessionData = {}) {
  const candidates = [
    sessionData?.expressGenerationInferenceModel,
    sessionData?.inferenceModel,
    sessionData?.inference_model,
    sessionData?.selectedInferenceModel,
    sessionData?.expressStepGeneration?.inferenceModel,
    sessionData?.expressStepGeneration?.inference_model,
    sessionData?.expressGenerationBuilder?.inferenceModel,
    sessionData?.expressGenerationBuilder?.inference_model,
    sessionData?.metadata?.inferenceModel,
    sessionData?.metadata?.inference_model,
  ];

  return candidates.map(normalizeString).find(Boolean) || '';
}

export function resolvePublicationMetadataInferenceModel(
  sessionData = {},
  fallbackInferenceModel = '',
) {
  return normalizeInferenceModel(
    getStoredSessionInferenceModel(sessionData) || fallbackInferenceModel,
  );
}
