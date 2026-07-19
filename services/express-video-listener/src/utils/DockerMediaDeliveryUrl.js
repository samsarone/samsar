import fs from 'node:fs';

const DEFAULT_RUNTIME_CONFIG_PATH = '/persistent/config/samsar.config.json';
const DEFAULT_DOCKER_PROCESSOR_BASE_URL = 'http://localhost:3002';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isTemporaryTunnelHostname(hostname = '') {
  const normalized = normalizeString(hostname).toLowerCase();
  return normalized.endsWith('.trycloudflare.com') ||
    normalized.endsWith('.loca.lt') ||
    normalized.endsWith('.share.zrok.io');
}

function isContainerInternalHostname(hostname = '') {
  const normalized = normalizeString(hostname).toLowerCase();
  return [
    'media-gateway',
    'processor',
    'samsar-processor',
    'samsar_processor',
  ].includes(normalized);
}

function normalizeStableProcessorBaseUrl(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return '';
  }
  try {
    const url = new URL(normalized);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      isTemporaryTunnelHostname(url.hostname) ||
      isContainerInternalHostname(url.hostname)
    ) {
      return '';
    }
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function readConfiguredProcessorUrls(env) {
  const configPaths = [
    env.SAMSAR_RUNTIME_CONFIG_FILE,
    env.SAMSAR_CONFIG_FILE,
    DEFAULT_RUNTIME_CONFIG_PATH,
  ].map(normalizeString).filter(Boolean);
  const urls = [];

  for (const configPath of configPaths) {
    try {
      if (!fs.existsSync(configPath)) {
        continue;
      }
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      urls.push(
        config?.publicUrls?.processorApi,
        config?.reverseProxy?.publicUrls?.processorApi,
      );
    } catch {
      // Runtime config is optional here. Upload persistence must still return a
      // deterministic local URL even while setup is atomically replacing it.
    }
  }

  return urls;
}

export function getStableDockerMediaBaseUrl(env = process.env) {
  const configuredCandidates = [
    env.SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL,
    env.SAMSAR_DOCKER_PUBLIC_ASSET_BASE_URL,
    env.SAMSAR_PROCESSOR_PUBLIC_URL,
    env.PROCESSOR_PUBLIC_URL,
    ...readConfiguredProcessorUrls(env),
    env.SAMSAR_PUBLIC_MEDIA_BASE_URL,
    env.MEDIA_PUBLIC_URL,
    env.PUBLIC_API_BASE_URL,
    env.PROCESSOR_URL,
    env.PROCESSOR_API,
  ];

  return configuredCandidates
    .map(normalizeStableProcessorBaseUrl)
    .find(Boolean) || DEFAULT_DOCKER_PROCESSOR_BASE_URL;
}

export function buildStableDockerMediaUrl(key, env = process.env) {
  const encodedKey = String(key || '')
    .replace(/^\/+/, '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${getStableDockerMediaBaseUrl(env)}/${encodedKey}`;
}

export function assertExplicitDockerExternalMediaConfiguration(env = process.env) {
  if (normalizeString(env.CURRENT_ENV).toLowerCase() !== 'docker') {
    return;
  }

  const bucket = normalizeString(env.MEDIA_BUCKET_NAME || env.STATIC_CDN_BUCKET);
  const cdnBase = normalizeString(env.STATIC_CDN_URL);
  let parsedCdnBase;
  try {
    parsedCdnBase = new URL(cdnBase);
  } catch {}

  if (
    !bucket ||
    !parsedCdnBase ||
    parsedCdnBase.protocol !== 'https:' ||
    isTemporaryTunnelHostname(parsedCdnBase.hostname) ||
    ['localhost', '127.0.0.1', '0.0.0.0'].includes(parsedCdnBase.hostname.toLowerCase())
  ) {
    throw new Error(
      'Docker external-S3 media delivery requires an explicitly configured MEDIA_BUCKET_NAME (or STATIC_CDN_BUCKET) and public HTTPS STATIC_CDN_URL.'
    );
  }
}
