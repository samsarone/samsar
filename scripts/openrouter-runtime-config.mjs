export const DEFAULT_OPENROUTER_GEMINI_4_CARBON_MODEL = 'google/gemini-4-carbon';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function resolveOpenRouterRuntimeConfig({ providerConfig = {}, providerSecrets = {} } = {}) {
  const configuredApiKey = normalizeString(providerSecrets.apiKey) || normalizeString(providerConfig.apiKey);
  const enabled = providerConfig.enabled === true && Boolean(configuredApiKey);

  if (!enabled) {
    return {
      enabled: false,
      apiKey: '',
      gemini4CarbonModel: '',
    };
  }

  const configuredModel = normalizeString(providerConfig.gemini4CarbonModel) ||
    normalizeString(providerConfig.gemini4ArgonModel);
  const gemini4CarbonModel = /^(?:google\/)?gemini-4-argon(?:-[0-9]{8})?$/i.test(configuredModel)
    ? DEFAULT_OPENROUTER_GEMINI_4_CARBON_MODEL
    : configuredModel || DEFAULT_OPENROUTER_GEMINI_4_CARBON_MODEL;

  return {
    enabled: true,
    apiKey: configuredApiKey,
    gemini4CarbonModel,
  };
}

export function applyEffectiveOpenRouterProviderConfig(providers = {}, providerSecrets = {}) {
  const openrouter = resolveOpenRouterRuntimeConfig({
    providerConfig: providers.openrouter,
    providerSecrets,
  });

  return {
    providers: {
      ...providers,
      openrouter: {
        ...(providers.openrouter || {}),
        enabled: openrouter.enabled,
      },
    },
    openrouter,
  };
}
