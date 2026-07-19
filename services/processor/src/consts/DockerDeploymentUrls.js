export const DOCKER_LOCAL_PUBLIC_CLIENT_BASE_URL = 'http://localhost:3000';
export const DOCKER_LOCAL_PUBLIC_PROCESSOR_BASE_URL = 'http://localhost:3002';

function normalizeBaseUrl(value) {
  return typeof value === 'string' && value.trim()
    ? value.trim().replace(/\/+$/, '')
    : '';
}

export function resolveDockerLocalPublicClientBaseUrl(env = process.env) {
  return normalizeBaseUrl(env.SAMSAR_DOCKER_PUBLIC_CLIENT_BASE_URL) ||
    normalizeBaseUrl(env.CLIENT_APP) ||
    DOCKER_LOCAL_PUBLIC_CLIENT_BASE_URL;
}

export function resolveDockerLocalPublicProcessorBaseUrl(env = process.env) {
  return normalizeBaseUrl(env.SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL) ||
    normalizeBaseUrl(env.PROCESSOR_API) ||
    normalizeBaseUrl(env.PROCESSOR_URL) ||
    normalizeBaseUrl(env.PUBLIC_API_BASE_URL) ||
    normalizeBaseUrl(env.API_SERVER) ||
    DOCKER_LOCAL_PUBLIC_PROCESSOR_BASE_URL;
}

export function resolveDockerLocalPublicAssetBaseUrl(env = process.env) {
  return normalizeBaseUrl(env.SAMSAR_DOCKER_PUBLIC_ASSET_BASE_URL) ||
    normalizeBaseUrl(env.SAMSAR_DOCKER_LOCAL_MEDIA_BASE_URL) ||
    normalizeBaseUrl(env.SAMSAR_LOCAL_MEDIA_BASE_URL) ||
    resolveDockerLocalPublicProcessorBaseUrl(env);
}
