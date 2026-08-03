export function isVideoModelAllowedForDeploymentScope(
  model,
  isStandaloneDeployment = false,
) {
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
