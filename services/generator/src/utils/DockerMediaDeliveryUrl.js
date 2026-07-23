import fs from 'node:fs';
import { isDockerRuntime } from './Environment.js';

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

function normalizeStableProcessorBaseUrl(value) {
  try {
    const url = new URL(normalizeString(value));
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      isTemporaryTunnelHostname(url.hostname) ||
      ['media-gateway', 'processor', 'samsar-processor', 'samsar_processor'].includes(
        url.hostname.toLowerCase(),
      )
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
  const urls = [];
  for (const configPath of [
    env.SAMSAR_RUNTIME_CONFIG_FILE,
    env.SAMSAR_CONFIG_FILE,
    DEFAULT_RUNTIME_CONFIG_PATH,
  ].map(normalizeString).filter(Boolean)) {
    try {
      if (!fs.existsSync(configPath)) continue;
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      urls.push(
        config?.publicUrls?.processorApi,
        config?.reverseProxy?.publicUrls?.processorApi,
      );
    } catch {}
  }
  return urls;
}

export function getStableDockerMediaBaseUrl(env = process.env) {
  return [
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
  ].map(normalizeStableProcessorBaseUrl).find(Boolean) || DEFAULT_DOCKER_PROCESSOR_BASE_URL;
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
  if (!isDockerRuntime(env)) return;
  const bucket = normalizeString(env.MEDIA_BUCKET_NAME || env.STATIC_CDN_BUCKET);
  let cdn;
  try {
    cdn = new URL(normalizeString(env.STATIC_CDN_URL));
  } catch {}
  if (
    !bucket ||
    !cdn ||
    cdn.protocol !== 'https:' ||
    isTemporaryTunnelHostname(cdn.hostname) ||
    ['localhost', '127.0.0.1', '0.0.0.0'].includes(cdn.hostname.toLowerCase())
  ) {
    throw new Error(
      'Docker external-S3 media delivery requires an explicitly configured MEDIA_BUCKET_NAME (or STATIC_CDN_BUCKET) and public HTTPS STATIC_CDN_URL.',
    );
  }
}
