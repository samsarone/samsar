export const QWEN_IMAGE_3_PRO_MODEL_KEY = 'QWENIMAGE3PRO';

// Saved sessions may retain the previous application key.
export function normalizeStoredGPTImageModelKey(value) {
  const key = typeof value === 'string' ? value.trim().toUpperCase() : value;
  if (['GPTIMAGE2', 'GPTIMAGE2.5', 'GPTIMAGE2.6'].includes(key)) return 'GPTIMAGE2.5';
  if (['GPTIMAGE2EDIT', 'GPTIMAGE2.5EDIT', 'GPTIMAGE2.6EDIT'].includes(key)) return 'GPTIMAGE2.5EDIT';
  return value;
}

export function isImageModelAllowedForDeploymentScope(
  model,
  isStandaloneDeployment = false,
) {
  return model?.standaloneOnly !== true || isStandaloneDeployment === true;
}

export function filterImageModelsForDeploymentScope(
  models = [],
  isStandaloneDeployment = false,
) {
  return models.filter((model) =>
    isImageModelAllowedForDeploymentScope(model, isStandaloneDeployment)
  );
}

export function isProviderBilledImagePricing(pricingEntry) {
  return pricingEntry?.providerBilled === true;
}
