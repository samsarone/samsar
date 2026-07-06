import fs from 'fs';
import path from 'path';

const ASSETS_PREFIX = 'assets';
const ASSETS_V2_PREFIX = 'assets_v2';
const ASSETS_V2_CHILD_PREFIXES = new Set([
  'ai_video',
  'generations',
  'temp_images',
  'user_resources',
  'video',
]);

const LOCAL_MEDIA_HOSTS = new Set([
  '0.0.0.0',
  '127.0.0.1',
  '::1',
  'host.docker.internal',
  'localhost',
  'media-gateway',
]);

const LOCAL_MEDIA_BASE_URL_ENV_KEYS = [
  'STATIC_CDN_URL',
  'PUBLIC_STATIC_CDN_URL',
  'SAMSAR_DOCKER_PUBLIC_ASSET_BASE_URL',
  'SAMSAR_DOCKER_LOCAL_MEDIA_BASE_URL',
  'SAMSAR_LOCAL_MEDIA_BASE_URL',
  'SAMSAR_INTERNAL_MEDIA_BASE_URL',
  'PUBLIC_API_BASE_URL',
  'PUBLIC_BASE_URL',
  'API_SERVER',
];

function normalizeRoot(value, fallback) {
  return path.resolve(typeof value === 'string' && value.trim() ? value.trim() : fallback);
}

function stripQueryAndHash(value) {
  return String(value || '').split('?')[0].split('#')[0];
}

function decodePathname(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function hasPathTraversalSegment(value) {
  return decodePathname(value)
    .replace(/\\/g, '/')
    .split('/')
    .some((segment) => segment === '..');
}

function isHttpUrl(value) {
  try {
    const parsedUrl = new URL(value);
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseConfiguredLocalMediaHosts(env = process.env) {
  const hosts = new Set();
  for (const key of LOCAL_MEDIA_BASE_URL_ENV_KEYS) {
    const value = env[key];
    if (typeof value !== 'string' || !value.trim()) {
      continue;
    }
    try {
      const parsedUrl = new URL(value.trim());
      if (parsedUrl.hostname) {
        hosts.add(parsedUrl.hostname.toLowerCase());
      }
    } catch {
      // Ignore malformed optional configuration.
    }
  }
  return hosts;
}

function isLocalMediaUrl(value, env = process.env) {
  try {
    const parsedUrl = new URL(value);
    const hostname = parsedUrl.hostname.toLowerCase();
    return LOCAL_MEDIA_HOSTS.has(hostname) || parseConfiguredLocalMediaHosts(env).has(hostname);
  } catch {
    return false;
  }
}

function getRelativeMediaPath(reference) {
  const trimmed = typeof reference === 'string' ? reference.trim() : '';
  if (!trimmed || trimmed.startsWith('data:')) {
    return null;
  }
  if (hasPathTraversalSegment(trimmed)) {
    return null;
  }

  if (isHttpUrl(trimmed)) {
    if (!isLocalMediaUrl(trimmed)) {
      return null;
    }
    try {
      const parsedUrl = new URL(trimmed);
      return decodePathname(parsedUrl.pathname).replace(/^\/+/, '');
    } catch {
      return null;
    }
  }

  return decodePathname(stripQueryAndHash(trimmed)).replace(/^\/+/, '');
}

function resolveWithinRoot(root, relativePath) {
  const normalizedRelative = String(relativePath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (
    !normalizedRelative ||
    normalizedRelative === '..' ||
    normalizedRelative.startsWith('../') ||
    normalizedRelative.includes('/../')
  ) {
    return null;
  }

  const resolvedPath = path.resolve(root, normalizedRelative);
  const normalizedRoot = path.resolve(root);
  if (resolvedPath !== normalizedRoot && !resolvedPath.startsWith(`${normalizedRoot}${path.sep}`)) {
    return null;
  }
  return resolvedPath;
}

export function resolveLocalMediaFilePath(reference, options = {}) {
  const relativePath = getRelativeMediaPath(reference);
  if (!relativePath) {
    return null;
  }

  const assetsRoot = normalizeRoot(options.assetsRoot || process.env.SAMSAR_ASSETS_ROOT, '/assets');
  const assetsV2Root = normalizeRoot(options.assetsV2Root || process.env.SAMSAR_ASSETS_V2_ROOT, '/assets_v2');
  const segments = relativePath.split('/').filter(Boolean);
  if (segments.length === 0) {
    return null;
  }

  const [prefix, ...rest] = segments;
  if (prefix === ASSETS_V2_PREFIX) {
    return resolveWithinRoot(assetsV2Root, rest.join('/'));
  }
  if (prefix === ASSETS_PREFIX) {
    return resolveWithinRoot(assetsRoot, rest.join('/'));
  }
  if (ASSETS_V2_CHILD_PREFIXES.has(prefix)) {
    return resolveWithinRoot(assetsV2Root, segments.join('/'));
  }

  return null;
}

export async function readLocalMediaBufferIfAvailable(reference, options = {}) {
  const filePath = resolveLocalMediaFilePath(reference, options);
  if (!filePath) {
    return null;
  }

  try {
    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile()) {
      return null;
    }
    return fs.promises.readFile(filePath);
  } catch {
    return null;
  }
}
