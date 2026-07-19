export const DOCKER_LOCAL_PUBLIC_CLIENT_BASE_URL = 'http://localhost:3000';
export const DOCKER_LOCAL_PUBLIC_PROCESSOR_BASE_URL = 'http://localhost:3002';

function normalizeBaseUrl(value) {
  return typeof value === 'string' && value.trim()
    ? value.trim().replace(/\/+$/, '')
    : '';
}

function normalizeStableBaseUrl(value) {
  const normalized = normalizeBaseUrl(value);
  if (!normalized) return '';
  try {
    const url = new URL(normalized);
    const hostname = url.hostname.toLowerCase();
    if (
      hostname.endsWith('.trycloudflare.com') ||
      hostname.endsWith('.loca.lt') ||
      hostname.endsWith('.share.zrok.io') ||
      ['media-gateway', 'processor', 'samsar-processor', 'samsar_processor'].includes(hostname)
    ) {
      return '';
    }
    return normalized;
  } catch {
    return '';
  }
}

export function resolveDockerLocalPublicClientBaseUrl(env = process.env) {
  return normalizeBaseUrl(env.SAMSAR_DOCKER_PUBLIC_CLIENT_BASE_URL) ||
    normalizeBaseUrl(env.CLIENT_APP) ||
    DOCKER_LOCAL_PUBLIC_CLIENT_BASE_URL;
}

export function resolveDockerLocalPublicProcessorBaseUrl(env = process.env) {
  return normalizeStableBaseUrl(env.SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL) ||
    normalizeStableBaseUrl(env.PROCESSOR_API) ||
    normalizeStableBaseUrl(env.PROCESSOR_URL) ||
    normalizeStableBaseUrl(env.PUBLIC_API_BASE_URL) ||
    normalizeStableBaseUrl(env.API_SERVER) ||
    DOCKER_LOCAL_PUBLIC_PROCESSOR_BASE_URL;
}

export function resolveDockerLocalPublicAssetBaseUrl(env = process.env) {
  return normalizeStableBaseUrl(env.SAMSAR_DOCKER_PUBLIC_ASSET_BASE_URL) ||
    normalizeStableBaseUrl(env.SAMSAR_DOCKER_LOCAL_MEDIA_BASE_URL) ||
    normalizeStableBaseUrl(env.SAMSAR_LOCAL_MEDIA_BASE_URL) ||
    resolveDockerLocalPublicProcessorBaseUrl(env);
}
