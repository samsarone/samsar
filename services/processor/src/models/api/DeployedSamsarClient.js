const DEFAULT_DEPLOYED_SAMSAR_BASE_URL = 'https://api.samsar.one/v1';

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function isDeployedAuthorizationMode(value) {
  return normalizeString(value).toLowerCase() === 'deployed';
}

export function getDeployedSamsarApiKey(overrides = {}) {
  return normalizeString(overrides.apiKey) ||
    normalizeString(overrides.samsarApiKey) ||
    normalizeString(process.env.SAMSAR_DEPLOYED_API_KEY) ||
    normalizeString(process.env.SAMSAR_EXTERNAL_API_KEY) ||
    normalizeString(process.env.SAMSAR_API_KEY);
}

export function getDeployedSamsarBaseUrl(overrides = {}) {
  return normalizeString(overrides.baseUrl) ||
    normalizeString(overrides.samsarBaseUrl) ||
    normalizeString(process.env.SAMSAR_DEPLOYED_API_BASE_URL) ||
    normalizeString(process.env.SAMSAR_EXTERNAL_API_BASE_URL) ||
    normalizeString(process.env.SAMSAR_API_BASE_URL) ||
    DEFAULT_DEPLOYED_SAMSAR_BASE_URL;
}

export async function createDeployedSamsarClient(options = {}) {
  const apiKey = getDeployedSamsarApiKey(options);
  if (!apiKey) {
    const error = new Error('SAMSAR_DEPLOYED_API_KEY or SAMSAR_EXTERNAL_API_KEY is required for deployed provider routing.');
    error.status = 500;
    throw error;
  }

  let SamsarClient;
  try {
    ({ SamsarClient } = await import('samsar-js'));
  } catch (importError) {
    const error = new Error('samsar-js must be installed before deployed provider routing can be used.');
    error.status = 500;
    error.cause = importError;
    throw error;
  }

  return new SamsarClient({
    apiKey,
    baseUrl: getDeployedSamsarBaseUrl(options),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.defaultHeaders ? { defaultHeaders: options.defaultHeaders } : {}),
  });
}
