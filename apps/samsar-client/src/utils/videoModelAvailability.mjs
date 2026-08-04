export const TEMPORARILY_DISABLED_VIDEO_MODEL_KEYS = Object.freeze([
  'SEEDANCE2.0I2V',
]);

const TEMPORARILY_DISABLED_VIDEO_MODELS = new Set(
  TEMPORARILY_DISABLED_VIDEO_MODEL_KEYS,
);

export function isVideoModelTemporarilyDisabled(modelKey) {
  const normalizedModelKey = typeof modelKey === 'string'
    ? modelKey.trim().toUpperCase()
    : '';
  return TEMPORARILY_DISABLED_VIDEO_MODELS.has(normalizedModelKey);
}

export function isVideoModelAllowedForDeploymentScope(
  model,
  isStandaloneDeployment = false,
) {
  if (isVideoModelTemporarilyDisabled(model?.key)) {
    return false;
  }
  return model?.standaloneOnly !== true || isStandaloneDeployment === true;
}

export function isProviderBilledVideoPricing(pricingEntry) {
  return pricingEntry?.providerBilled === true;
}

export function canListVideoModel({
  model,
  pricingEntry,
  isStandaloneDeployment = false,
} = {}) {
  if (!isVideoModelAllowedForDeploymentScope(model, isStandaloneDeployment)) {
    return false;
  }

  return (
    isProviderBilledVideoPricing(pricingEntry) ||
    (Array.isArray(pricingEntry?.prices) && pricingEntry.prices.length > 0)
  );
}
