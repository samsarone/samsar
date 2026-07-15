export const DEFAULT_OPENROUTER_GEMINI_31_PRO_MODEL = 'google/gemini-3.1-pro-preview';

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
      gemini31ProModel: '',
    };
  }

  return {
    enabled: true,
    apiKey: configuredApiKey,
    gemini31ProModel:
      normalizeString(providerConfig.gemini31ProModel) || DEFAULT_OPENROUTER_GEMINI_31_PRO_MODEL,
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
