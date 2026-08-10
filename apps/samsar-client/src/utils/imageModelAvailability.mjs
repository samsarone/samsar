export const QWEN_IMAGE_3_PRO_MODEL_KEY = 'QWENIMAGE3PRO';

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
