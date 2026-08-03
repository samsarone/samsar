// uploadImageToCDN.js

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import {
  createBackblazeNativeClientFromEnv,
  shouldUseBackblazeNativeApi,
} from '../../utils/BackblazeNativeClient.js';
import { NodeHttpHandler } from '@aws-sdk/node-http-handler';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { resolveFreshManagedProviderMediaUrl } from './ProviderMediaTunnel.js';
import {
  assertExplicitDockerExternalMediaConfiguration,
  buildStableDockerMediaUrl,
} from '../../utils/DockerMediaDeliveryUrl.js';
import { isDockerRuntime as isConfiguredDockerRuntime } from '../../utils/EnvironmentUtils.js';

export { buildStableDockerMediaUrl } from '../../utils/DockerMediaDeliveryUrl.js';

/**
 * Reads AWS credentials and region from environment variables.
 */
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const AWS_REGION = process.env.AWS_CDN_REGION || 'us-west-2';

const STATIC_CDN_URL = process.env.STATIC_CDN_URL || 'https://static.samsar.one/';
const SECURE_ASSET_PREFIX = (process.env.SECURE_ASSET_PREFIX || 'assets_v2').replace(/^\/+|\/+$/g, '');
const SECURE_ASSET_PREFIX_PATTERN = SECURE_ASSET_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MEDIA_KEY_PREFIX_PATTERN = new RegExp(`^(${SECURE_ASSET_PREFIX_PATTERN}|assets|generations|temp_images|video|ai_video)/`);
const DOCKER_GATEWAY_MEDIA_KEY_PATTERN = /^(assets_v2|assets)\//;
const MEDIA_BUCKET_NAME = process.env.MEDIA_BUCKET_NAME || process.env.STATIC_CDN_BUCKET || 'samsar-resources';
const DEFAULT_CLOUDFRONT_SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;
const configuredCloudFrontSignedUrlTtlSeconds = Number(process.env.CLOUDFRONT_SIGNED_URL_TTL_SECONDS);
const CLOUDFRONT_SIGNED_URL_TTL_SECONDS = Number.isFinite(configuredCloudFrontSignedUrlTtlSeconds) && configuredCloudFrontSignedUrlTtlSeconds > 0
  ? configuredCloudFrontSignedUrlTtlSeconds
  : DEFAULT_CLOUDFRONT_SIGNED_URL_TTL_SECONDS;
const DEFAULT_RUNTIME_CONFIG_PATH = '/persistent/config/samsar.config.json';
const PUBLIC_MEDIA_PROBE_TIMEOUT_MS = Number.isFinite(Number(process.env.SAMSAR_PUBLIC_MEDIA_PROBE_TIMEOUT_MS))
  ? Math.max(250, Number(process.env.SAMSAR_PUBLIC_MEDIA_PROBE_TIMEOUT_MS))
  : 1500;
const MULTIPART_UPLOAD_THRESHOLD_BYTES = 5 * 1024 * 1024;
let cachedCloudFrontPrivateKey;
let s3Client;

function encodeObjectKeyForUrl(key) {
  return String(key)
    .replace(/^\/+/, '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function buildStaticCdnUrl(key) {
  const cdnBase = STATIC_CDN_URL.endsWith('/') ? STATIC_CDN_URL.slice(0, -1) : STATIC_CDN_URL;
  return `${cdnBase}/${encodeObjectKeyForUrl(key)}`;
}

function toCloudFrontSafeBase64(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/=/g, '_')
    .replace(/\//g, '~');
}

function resolveCloudFrontPrivateKey() {
  if (cachedCloudFrontPrivateKey !== undefined) {
    return cachedCloudFrontPrivateKey;
  }

  const rawPrivateKey = process.env.CLOUDFRONT_PRIVATE_KEY || process.env.AWS_CLOUDFRONT_PRIVATE_KEY;
  const base64PrivateKey = process.env.CLOUDFRONT_PRIVATE_KEY_BASE64 || process.env.AWS_CLOUDFRONT_PRIVATE_KEY_BASE64;
  const privateKeyPath = process.env.CLOUDFRONT_PRIVATE_KEY_PATH || process.env.AWS_CLOUDFRONT_PRIVATE_KEY_PATH;

  if (base64PrivateKey) {
    cachedCloudFrontPrivateKey = Buffer.from(base64PrivateKey, 'base64').toString('utf8');
  } else if (rawPrivateKey) {
    cachedCloudFrontPrivateKey = rawPrivateKey.replace(/\\n/g, '\n');
  } else if (privateKeyPath) {
    cachedCloudFrontPrivateKey = fs.readFileSync(privateKeyPath, 'utf8');
  } else {
    cachedCloudFrontPrivateKey = null;
  }

  return cachedCloudFrontPrivateKey;
}

function getCloudFrontSigningConfig() {
  const keyPairId = process.env.CLOUDFRONT_KEY_PAIR_ID || process.env.AWS_CLOUDFRONT_KEY_PAIR_ID;
  const privateKey = resolveCloudFrontPrivateKey();
  if (!keyPairId || !privateKey) {
    return null;
  }
  return { keyPairId, privateKey };
}

function signCloudFrontUrl(url) {
  const signingConfig = getCloudFrontSigningConfig();
  if (!signingConfig) {
    return url;
  }

  const expiresAt = Math.floor(Date.now() / 1000) + CLOUDFRONT_SIGNED_URL_TTL_SECONDS;
  const policy = JSON.stringify({
    Statement: [{
      Resource: url,
      Condition: {
        DateLessThan: {
          'AWS:EpochTime': expiresAt,
        },
      },
    }],
  });
  const signer = crypto.createSign('RSA-SHA1');
  signer.update(policy);
  const signature = signer.sign(signingConfig.privateKey);
  const separator = url.includes('?') ? '&' : '?';

  return `${url}${separator}Expires=${expiresAt}&Signature=${toCloudFrontSafeBase64(signature)}&Key-Pair-Id=${encodeURIComponent(signingConfig.keyPairId)}`;
}

function normalizeObjectKey(key) {
  const rawKey = String(key || '').trim();
  if (!rawKey) {
    return '';
  }
  if (/^https?:\/\//i.test(rawKey)) {
    try {
      const parsedUrl = new URL(rawKey);
      let objectKey = decodeURIComponent(parsedUrl.pathname).replace(/^\/+/, '');
      const configuredCdnUrl = new URL(process.env.STATIC_CDN_URL || STATIC_CDN_URL);
      const configuredBasePath = decodeURIComponent(configuredCdnUrl.pathname)
        .replace(/^\/+|\/+$/g, '');
      if (
        configuredBasePath &&
        parsedUrl.origin === configuredCdnUrl.origin &&
        (objectKey === configuredBasePath || objectKey.startsWith(`${configuredBasePath}/`))
      ) {
        objectKey = objectKey.slice(configuredBasePath.length).replace(/^\/+/, '');
      }
      return objectKey;
    } catch {
      return rawKey.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+/, '');
    }
  }
  return rawKey.replace(/^\/+/, '');
}

function getBasenameFromKey(key) {
  const pathParts = normalizeObjectKey(key).split('/').filter(Boolean);
  return pathParts[pathParts.length - 1] || '';
}

function getSessionIdFromMediaPath(value) {
  const normalizedKey = normalizeObjectKey(value);
  const pathMatch = normalizedKey.match(/(?:^|\/)(?:generations|temp|intermediates|twitter|ai_video\/(?:generations|frames|temp)|video\/(?:audio|frames|outro))\/([a-f0-9]{24})(?:\/|$)/i);
  if (pathMatch) {
    return pathMatch[1];
  }

  const fileName = getBasenameFromKey(normalizedKey);
  const fileNameMatch = fileName.match(/^([a-f0-9]{24})[_-]/i);
  return fileNameMatch ? fileNameMatch[1] : null;
}

function buildSessionScopedRemoteFileName(remoteFileName, sourcePath) {
  const sessionId = getSessionIdFromMediaPath(sourcePath) || getSessionIdFromMediaPath(remoteFileName);
  if (!sessionId) {
    return remoteFileName;
  }

  const normalizedRemoteName = normalizeObjectKey(remoteFileName);
  if (normalizedRemoteName.startsWith(`${sessionId}/`)) {
    return normalizedRemoteName;
  }

  const fileName = getBasenameFromKey(remoteFileName);
  return fileName ? `${sessionId}/${fileName}` : remoteFileName;
}

function isSecureAssetKey(key) {
  return normalizeObjectKey(key).startsWith(`${SECURE_ASSET_PREFIX}/`);
}

function toSecureAssetKey(key) {
  const normalizedKey = normalizeObjectKey(key);
  return isSecureAssetKey(normalizedKey) ? normalizedKey : `${SECURE_ASSET_PREFIX}/${normalizedKey}`;
}

function buildMediaUploadKey(folderName, remoteFileName) {
  const folderKey = normalizeObjectKey(folderName).replace(/\/+$/g, '');
  const remoteKey = normalizeObjectKey(remoteFileName);
  const uploadKey = isSecureAssetKey(remoteKey) || !folderKey
    ? remoteKey
    : `${folderKey}/${remoteKey}`;
  return toSecureAssetKey(uploadKey);
}

function buildMediaDeliveryUrl(key) {
  if (shouldUseDockerLocalMedia()) {
    return buildStableDockerMediaUrl(key);
  }
  const cdnUrl = buildStaticCdnUrl(key);
  return isSecureAssetKey(key) ? signCloudFrontUrl(cdnUrl) : cdnUrl;
}

export function buildSecureMediaDeliveryUrl(value) {
  const normalizedValue = normalizeString(value);
  if (/^https?:\/\//i.test(normalizedValue) && !isOwnedDockerMediaUrl(normalizedValue)) {
    return value;
  }
  const normalizedKey = /^https?:\/\//i.test(normalizedValue)
    ? getProviderMediaKeyReference(normalizedValue)
    : normalizeObjectKey(normalizedValue);
  if (!normalizedKey) {
    return value;
  }
  return buildMediaDeliveryUrl(toSecureAssetKey(normalizedKey));
}

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function isDockerRuntime() {
  return isConfiguredDockerRuntime();
}

function isExternalMediaPublishEnabled() {
  return ['1', 'true', 'yes', 'on'].includes(
    normalizeString(process.env.SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED || process.env.EXTERNAL_MEDIA_PUBLISH_ENABLED)
      .toLowerCase()
  );
}

function shouldUseDockerLocalMedia() {
  const configuredMode = normalizeString(process.env.SAMSAR_MEDIA_DELIVERY_MODE || process.env.MEDIA_DELIVERY_MODE)
    .toLowerCase();
  if (configuredMode === 'docker-local' || configuredMode === 'local-filesystem') {
    return true;
  }
  if (configuredMode === 's3-cloudfront' || configuredMode === 'external-s3') {
    return false;
  }
  return isDockerRuntime() && !isExternalMediaPublishEnabled();
}

function stripQueryAndHash(value) {
  return String(value || '').split('?')[0].split('#')[0];
}

function getReferencePath(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return '';
  }
  if (/^https?:\/\//i.test(normalized)) {
    try {
      return decodeURIComponent(new URL(normalized).pathname).replace(/^\/+/, '');
    } catch {
      return normalized.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+/, '');
    }
  }
  if (normalized.startsWith('file://')) {
    try {
      return new URL(normalized).pathname;
    } catch {
      return normalized.replace(/^file:\/\//i, '');
    }
  }
  return stripQueryAndHash(normalized);
}

function getProviderMediaKeyReference(value) {
  const referencePath = getReferencePath(value).replace(/^[\\/]+/, '');
  if (!referencePath) {
    return '';
  }

  const normalizedValue = normalizeString(value);
  if (!/^https?:\/\//i.test(normalizedValue) && MEDIA_KEY_PREFIX_PATTERN.test(referencePath)) {
    return referencePath;
  }

  if (!/^https?:\/\//i.test(normalizedValue) || !isOwnedDockerMediaUrl(normalizedValue)) {
    return '';
  }

  if (MEDIA_KEY_PREFIX_PATTERN.test(referencePath)) {
    return referencePath;
  }

  const pathParts = referencePath.split('/').filter(Boolean);
  for (let index = 1; index < pathParts.length; index += 1) {
    const candidate = pathParts.slice(index).join('/');
    if (MEDIA_KEY_PREFIX_PATTERN.test(candidate)) {
      return candidate;
    }
  }

  return '';
}

const getDockerProviderMediaKeyReference = getProviderMediaKeyReference;

function getProcessorAssetsRoot(folderName = 'assets') {
  if (folderName === 'assets_v2' && process.env.SAMSAR_ASSETS_V2_ROOT) {
    return process.env.SAMSAR_ASSETS_V2_ROOT;
  }
  if (folderName === 'assets' && process.env.SAMSAR_ASSETS_ROOT) {
    return process.env.SAMSAR_ASSETS_ROOT;
  }
  if (isDockerRuntime()) {
    if (folderName === 'assets_v2') {
      return '/assets_v2';
    }
    if (folderName === 'assets') {
      return '/assets';
    }
    return `/${folderName}`;
  }
  return path.join(process.cwd(), '..', 'samsar_processor', folderName);
}

function getExistingFilePath(candidates) {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {}
  }
  return null;
}

function resolveLocalMediaReferencePath(reference) {
  const normalizedReference = normalizeString(reference);
  if (/^https?:\/\//i.test(normalizedReference) && !isOwnedDockerMediaUrl(normalizedReference)) {
    return null;
  }
  const referencePath = getReferencePath(reference);
  if (!referencePath) {
    return null;
  }

  const normalized = referencePath.replace(/^[\\/]+/, '');
  if (path.isAbsolute(referencePath) && !MEDIA_KEY_PREFIX_PATTERN.test(normalized)) {
    return getExistingFilePath([referencePath]);
  }

  const assetsRoot = getProcessorAssetsRoot('assets');
  const assetsV2Root = getProcessorAssetsRoot(SECURE_ASSET_PREFIX);
  const candidates = [];

  if (normalized.startsWith(`${SECURE_ASSET_PREFIX}/`)) {
    candidates.push(path.join(assetsV2Root, normalized.slice(SECURE_ASSET_PREFIX.length + 1)));
  } else if (normalized.startsWith('assets_v2/')) {
    candidates.push(path.join(assetsV2Root, normalized.slice('assets_v2/'.length)));
  } else if (normalized.startsWith('assets/')) {
    candidates.push(path.join(assetsRoot, normalized.slice('assets/'.length)));
  } else if (MEDIA_KEY_PREFIX_PATTERN.test(normalized)) {
    candidates.push(path.join(assetsV2Root, normalized));
    candidates.push(path.join(assetsRoot, normalized));
  }

  candidates.push(path.join(assetsV2Root, normalized));
  candidates.push(path.join(assetsRoot, normalized));

  return getExistingFilePath(candidates);
}

function isProbablyPublicUrl(value) {
  if (!/^https?:\/\//i.test(value)) {
    return false;
  }

  try {
    const hostname = new URL(value).hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === 'media-gateway' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname.endsWith('.local')
    ) {
      return false;
    }
    if (/^10\./.test(hostname) || /^192\.168\./.test(hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isPrivateOrLocalHostname(hostname = '') {
  const normalized = normalizeString(hostname).toLowerCase();
  return normalized === 'localhost' ||
    normalized === 'media-gateway' ||
    normalized === '127.0.0.1' ||
    normalized === '0.0.0.0' ||
    normalized.endsWith('.local') ||
    /^10\./.test(normalized) ||
    /^192\.168\./.test(normalized) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(normalized);
}

function getConfiguredOwnedMediaHostnames() {
  const hostnames = new Set();
  const configuredUrls = [
    process.env.SAMSAR_MEDIA_TUNNEL_PUBLIC_URL,
    process.env.SAMSAR_PROVIDER_MEDIA_BASE_URL,
    process.env.SAMSAR_DOCKER_PUBLIC_ASSET_BASE_URL,
    process.env.SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL,
    process.env.SAMSAR_PUBLIC_MEDIA_BASE_URL,
    process.env.SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL,
    process.env.MEDIA_PUBLIC_URL,
    process.env.PUBLIC_API_BASE_URL,
    process.env.PROCESSOR_API,
    process.env.PROCESSOR_URL,
    ...readRuntimeConfigPublicMediaUrls({ includeStorage: !shouldUseDockerLocalMedia() }),
    ...(!shouldUseDockerLocalMedia()
      ? [process.env.PUBLIC_STATIC_CDN_URL, process.env.STATIC_CDN_URL]
      : []),
  ];
  for (const value of configuredUrls) {
    try {
      hostnames.add(new URL(value).hostname.toLowerCase());
    } catch {}
  }
  return hostnames;
}

function isConfiguredS3MediaUrl(url) {
  const hostname = url.hostname.toLowerCase();
  const normalizedBucketName = normalizeString(
    process.env.MEDIA_BUCKET_NAME || process.env.STATIC_CDN_BUCKET,
  ).toLowerCase();
  if (!normalizedBucketName) return false;
  if (
    hostname === `${normalizedBucketName}.s3.amazonaws.com` ||
    hostname.startsWith(`${normalizedBucketName}.s3.`)
  ) {
    return true;
  }
  if (hostname !== 's3.amazonaws.com' && !hostname.startsWith('s3.')) {
    return false;
  }
  try {
    return decodeURIComponent(url.pathname).replace(/^\/+/, '').startsWith(`${normalizedBucketName}/`);
  } catch {
    return false;
  }
}

function isTunnelHostname(hostname) {
  const normalized = normalizeString(hostname).toLowerCase();
  return normalized.endsWith('.trycloudflare.com') ||
    normalized.endsWith('.loca.lt') ||
    normalized.endsWith('.share.zrok.io');
}

function getDockerMediaKeyFromPathname(pathname) {
  let referencePath = '';
  try {
    referencePath = decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    return '';
  }
  if (MEDIA_KEY_PREFIX_PATTERN.test(referencePath)) return referencePath;
  const parts = referencePath.split('/').filter(Boolean);
  for (let index = 1; index < parts.length; index += 1) {
    const candidate = parts.slice(index).join('/');
    if (MEDIA_KEY_PREFIX_PATTERN.test(candidate)) return candidate;
  }
  return '';
}

function isOwnedDockerMediaUrl(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (
      isPrivateOrLocalHostname(hostname) ||
      getConfiguredOwnedMediaHostnames().has(hostname) ||
      (!shouldUseDockerLocalMedia() && isConfiguredS3MediaUrl(url))
    ) {
      return true;
    }
    if (!isTunnelHostname(hostname)) return false;
    const mediaKey = getDockerMediaKeyFromPathname(url.pathname);
    return Boolean(mediaKey && resolveLocalMediaReferencePath(mediaKey));
  } catch {
    return false;
  }
}

function normalizeBaseUrl(value) {
  return normalizeString(value).replace(/\/+$/, '');
}

function normalizeTunnelBaseUrl(value) {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  try {
    const url = new URL(normalized);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      (url.pathname && url.pathname !== '/') ||
      url.search ||
      url.hash
    ) {
      return '';
    }
    return url.origin;
  } catch {
    return '';
  }
}

function getRuntimeConfigPaths() {
  return [
    process.env.SAMSAR_RUNTIME_CONFIG_FILE,
    process.env.SAMSAR_CONFIG_FILE,
    DEFAULT_RUNTIME_CONFIG_PATH,
  ]
    .map(normalizeString)
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
}

function readRuntimeConfigPublicMediaUrls({ includeStorage = true } = {}) {
  const urls = [];
  for (const configPath of getRuntimeConfigPaths()) {
    try {
      if (!fs.existsSync(configPath)) {
        continue;
      }
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const localTunnel = config?.localMediaTunnel || {};
      const legacyTunnel = config?.mediaTunnel || {};
      urls.push(
        ...(localTunnel.enabled === false ? [] : [localTunnel.publicUrl, localTunnel.url]),
        ...(legacyTunnel.enabled === false ? [] : [legacyTunnel.publicUrl, legacyTunnel.url]),
        config?.publicUrls?.media,
        ...(includeStorage
          ? [
            config?.storage?.publicMediaBaseUrl,
            config?.storage?.externalMediaPublicBaseUrl,
            config?.storage?.staticCdnUrl,
          ]
          : []),
      );
    } catch (error) {
      console.warn('[AWS] Unable to read runtime media config', {
        configPath,
        error: error?.message || error,
      });
    }
  }
  return urls;
}

function isTunnelMediaBaseUrl(value) {
  const normalized = normalizeBaseUrl(value);
  if (!normalized) {
    return false;
  }
  const explicitTunnelUrl = normalizeBaseUrl(process.env.SAMSAR_MEDIA_TUNNEL_PUBLIC_URL);
  if (explicitTunnelUrl && normalized === explicitTunnelUrl) {
    return true;
  }
  try {
    const hostname = new URL(normalized).hostname.toLowerCase();
    return hostname.endsWith('.trycloudflare.com') ||
      hostname.endsWith('.loca.lt') ||
      hostname.endsWith('.share.zrok.io');
  } catch {
    return false;
  }
}

function getDockerTunnelMediaBaseUrlCandidates() {
  const candidates = [
    process.env.SAMSAR_PROVIDER_MEDIA_BASE_URL,
    process.env.SAMSAR_PUBLIC_MEDIA_BASE_URL,
    process.env.SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL,
    process.env.MEDIA_PUBLIC_URL,
    process.env.SAMSAR_DOCKER_PUBLIC_ASSET_BASE_URL,
    process.env.SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL,
    ...readRuntimeConfigPublicMediaUrls(),
    process.env.SAMSAR_MEDIA_TUNNEL_PUBLIC_URL,
  ]
    .map(normalizeTunnelBaseUrl)
    .filter(Boolean)
    .filter(isProbablyPublicUrl)
    .filter((value, index, list) => list.indexOf(value) === index);
  return [
    ...candidates.filter((value) => !isTunnelMediaBaseUrl(value)),
    ...candidates.filter(isTunnelMediaBaseUrl),
  ];
}

function getPublicMediaBaseUrlCandidates() {
  return [
    process.env.SAMSAR_PROVIDER_MEDIA_BASE_URL,
    process.env.SAMSAR_DOCKER_PUBLIC_ASSET_BASE_URL,
    process.env.SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL,
    process.env.SAMSAR_PUBLIC_MEDIA_BASE_URL,
    process.env.SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL,
    process.env.MEDIA_PUBLIC_URL,
    process.env.PUBLIC_API_BASE_URL,
    process.env.PROCESSOR_API,
    process.env.PROCESSOR_URL,
    ...readRuntimeConfigPublicMediaUrls(),
    process.env.SAMSAR_MEDIA_TUNNEL_PUBLIC_URL,
    process.env.PUBLIC_STATIC_CDN_URL,
    process.env.STATIC_CDN_URL,
  ]
    .map(normalizeBaseUrl)
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
}

function getLocalPublicMediaBaseUrlCandidates() {
  const staticBaseUrls = new Set([
    process.env.PUBLIC_STATIC_CDN_URL,
    process.env.STATIC_CDN_URL,
    STATIC_CDN_URL,
  ].map(normalizeBaseUrl).filter(Boolean));

  return [
    process.env.SAMSAR_PROVIDER_MEDIA_BASE_URL,
    process.env.SAMSAR_PUBLIC_MEDIA_BASE_URL,
    process.env.SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL,
    process.env.MEDIA_PUBLIC_URL,
    process.env.PUBLIC_API_BASE_URL,
    process.env.PROCESSOR_API,
    process.env.PROCESSOR_URL,
    ...readRuntimeConfigPublicMediaUrls(),
    process.env.SAMSAR_MEDIA_TUNNEL_PUBLIC_URL,
    process.env.SAMSAR_DOCKER_PUBLIC_ASSET_BASE_URL,
    process.env.SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL,
  ]
    .map(normalizeBaseUrl)
    .filter(Boolean)
    .filter(isProbablyPublicUrl)
    .filter((value) => !staticBaseUrls.has(value))
    .filter((value, index, list) => list.indexOf(value) === index);
}

function shouldProbePublicMediaUrl() {
  const normalized = normalizeString(process.env.SAMSAR_VALIDATE_PUBLIC_MEDIA_URL).toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(normalized);
}

async function isReachablePublicMediaUrl(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PUBLIC_MEDIA_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      signal: controller.signal,
    });
    if (response.body) {
      try {
        if (typeof response.body.cancel === 'function') {
          await response.body.cancel();
        }
      } catch {}
    }
    return response.ok || response.status === 206;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export function getDockerPublicMediaBaseUrl() {
  const publicBaseUrl = getDockerTunnelMediaBaseUrlCandidates()[0];
  if (publicBaseUrl) {
    return publicBaseUrl;
  }
  throw new Error(
    'A public media URL is required before sending local audio/video assets to remote video providers. ' +
    'Configure a stable HTTPS origin or wait for the Compose media-tunnel-controller.'
  );
}

export function getDockerPublicMediaKey(reference, localPath = '') {
  const referencePath = getReferencePath(reference).replace(/^[\\/]+/, '');
  const assetsV2Root = getProcessorAssetsRoot(SECURE_ASSET_PREFIX).replace(/\\/g, '/').replace(/\/+$/, '');
  const assetsRoot = getProcessorAssetsRoot('assets').replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedLocalPath = normalizeString(localPath).replace(/\\/g, '/');
  if (normalizedLocalPath.startsWith(`${assetsV2Root}/`)) {
    return `assets_v2/${normalizedLocalPath.slice(assetsV2Root.length + 1)}`;
  }
  if (normalizedLocalPath.startsWith(`${assetsRoot}/`)) {
    return `assets/${normalizedLocalPath.slice(assetsRoot.length + 1)}`;
  }
  return DOCKER_GATEWAY_MEDIA_KEY_PATTERN.test(referencePath) ? referencePath : '';
}

export function buildDockerPublicMediaUrl(reference, localPath = '') {
  const mediaKey = getDockerPublicMediaKey(reference, localPath);
  if (!mediaKey) {
    throw new Error(
      'A tunneled media URL is required before sending local audio/video assets to remote video providers. ' +
      'Ensure the Compose media-tunnel-controller is healthy and has published localMediaTunnel.publicUrl.'
    );
  }

  return `${getDockerPublicMediaBaseUrl()}/${mediaKey.replace(/^\/+/, '')}`;
}

function getExpectedProviderMediaContentTypePrefix(mediaKind, reference, localPath) {
  const normalizedKind = normalizeString(mediaKind).toLowerCase();
  if (['image', 'video', 'audio'].includes(normalizedKind)) return `${normalizedKind}/`;
  const extension = path.extname(stripQueryAndHash(localPath || getReferencePath(reference))).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'].includes(extension)) return 'image/';
  if (['.mp4', '.mov', '.webm', '.mkv', '.avi'].includes(extension)) return 'video/';
  if (['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg'].includes(extension)) return 'audio/';
  return '';
}

async function buildBestDockerPublicMediaUrl(reference, localPath = '', options = {}) {
  const mediaKey = getDockerPublicMediaKey(reference, localPath);
  if (!mediaKey) {
    throw new Error(
      'A tunneled media URL is required before sending local audio/video assets to remote video providers. ' +
      'Ensure the Compose media-tunnel-controller is healthy and has published localMediaTunnel.publicUrl.'
    );
  }

  const mediaPath = mediaKey.replace(/^\/+/, '');
  return resolveFreshManagedProviderMediaUrl({
    mediaPath,
    getBaseUrlCandidates: getDockerTunnelMediaBaseUrlCandidates,
    serviceName: 'samsar_express_video_listener',
    expectedContentTypePrefix: getExpectedProviderMediaContentTypePrefix(
      options.mediaKind,
      reference,
      localPath,
    ),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
}

async function buildBestLocalPublicMediaUrl(reference, localPath = '') {
  const mediaKey = getDockerPublicMediaKey(reference, localPath);
  if (!mediaKey) {
    throw new Error('A public media URL is required before sending local audio/video assets to remote video providers.');
  }

  const publicBases = getLocalPublicMediaBaseUrlCandidates();
  if (!publicBases.length) {
    throw new Error('A public media URL is required before sending local audio/video assets to remote video providers.');
  }

  const mediaPath = mediaKey.replace(/^\/+/, '');
  const candidateUrls = publicBases
    .map((baseUrl) => `${baseUrl}/${mediaPath}`)
    .filter((value, index, list) => list.indexOf(value) === index);

  if (shouldProbePublicMediaUrl()) {
    for (const candidateUrl of candidateUrls) {
      if (await isReachablePublicMediaUrl(candidateUrl)) {
        return candidateUrl;
      }
    }
  }

  return candidateUrls[0];
}

function hasAWSEnvVariables() {
  return Boolean(
    normalizeString(process.env.AWS_ACCESS_KEY_ID || AWS_ACCESS_KEY_ID) &&
    normalizeString(process.env.AWS_SECRET_ACCESS_KEY || AWS_SECRET_ACCESS_KEY) &&
    normalizeString(process.env.AWS_CDN_REGION || AWS_REGION)
  );
}

function getMediaContentType(filePath) {
  const extension = path.extname(filePath || '').toLowerCase();
  if (extension === '.mp4') return 'video/mp4';
  if (extension === '.mov') return 'video/quicktime';
  if (extension === '.webm') return 'video/webm';
  if (extension === '.mp3') return 'audio/mpeg';
  if (extension === '.wav') return 'audio/wav';
  if (extension === '.m4a') return 'audio/mp4';
  if (extension === '.ogg' || extension === '.oga') return 'audio/ogg';
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

function getS3Client() {
  assertExplicitDockerExternalMediaConfiguration();
  validateAWSEnvVariables();
  if (!s3Client) {
    s3Client = initializeS3Client();
  }
  return s3Client;
}

async function uploadLocalMediaFileToCDN(localPath, mediaKey) {
  if (!hasAWSEnvVariables()) {
    throw new Error('Missing AWS credentials for local media CDN publish.');
  }

  const uploadKey = toSecureAssetKey(mediaKey);
  const fileSize = fs.statSync(localPath).size;
  const uploadParams = {
    Bucket: MEDIA_BUCKET_NAME,
    Key: uploadKey,
    Body: fs.createReadStream(localPath),
    ContentType: getMediaContentType(localPath),
    ContentLength: fileSize,
  };

  if (fileSize >= MULTIPART_UPLOAD_THRESHOLD_BYTES && !shouldUseBackblazeNativeApi()) {
    const upload = new Upload({
      client: getS3Client(),
      params: uploadParams,
      leavePartsOnError: false,
    });
    await upload.done();
  } else {
    await getS3Client().send(new PutObjectCommand(uploadParams));
  }

  const cdnUrl = buildMediaDeliveryUrl(uploadKey);
  await primeCDNCache(cdnUrl, { requireSuccess: true });
  return cdnUrl;
}

async function resolveLocalProviderMediaUrl(normalizedValue, localPath, mediaKeyReference) {
  const secureReference = mediaKeyReference || normalizedValue;
  const signedUrl = buildSecureMediaDeliveryUrl(secureReference);
  if (signedUrl && /^https?:\/\//i.test(signedUrl)) {
    if (await primeCDNCache(signedUrl, { requireSuccess: false, attempts: 1 })) {
      return signedUrl;
    }
  }

  if (hasAWSEnvVariables()) {
    try {
      return await uploadLocalMediaFileToCDN(localPath, secureReference);
    } catch (error) {
      console.error('[AWS] Falling back to public local media URL after CDN publish failure', {
        url: String(normalizedValue).split('?')[0],
        signedUrl: signedUrl ? signedUrl.split('?')[0] : null,
        localPath,
        error: error?.message || error,
      });
    }
  }

  return buildBestLocalPublicMediaUrl(secureReference, localPath);
}

function buildInvalidProviderMediaReferenceError(value) {
  const error = new Error(
    `Docker provider media reference is not a mounted Samsar asset or an independently public URL: ${String(value || '').split('?')[0]}`,
  );
  error.name = 'SamsarProviderMediaReferenceError';
  error.code = 'SAMSAR_PROVIDER_MEDIA_REFERENCE_INVALID';
  error.retryable = false;
  error.mediaReference = value;
  return error;
}

function assertConfiguredDockerExternalMediaDelivery(value) {
  const bucket = normalizeString(
    process.env.MEDIA_BUCKET_NAME || process.env.STATIC_CDN_BUCKET,
  );
  const cdnBase = normalizeString(process.env.STATIC_CDN_URL);
  let parsedCdnBase;
  try {
    parsedCdnBase = new URL(cdnBase);
  } catch {}
  if (
    !bucket ||
    !parsedCdnBase ||
    parsedCdnBase.protocol !== 'https:' ||
    isPrivateOrLocalHostname(parsedCdnBase.hostname)
  ) {
    const error = buildInvalidProviderMediaReferenceError(value);
    error.message = 'Docker external-S3 provider media requires an explicitly configured bucket and public HTTPS STATIC_CDN_URL.';
    throw error;
  }
}

function isDockerOwnedOrUnsafeMediaReference(value) {
  const normalized = normalizeString(value);
  if (!normalized) return false;
  if (/^(file|blob):/i.test(normalized) || !/^https?:\/\//i.test(normalized)) return true;
  return isOwnedDockerMediaUrl(normalized) || !isProbablyPublicUrl(normalized);
}

export async function normalizeProviderMediaUrl(value, options = {}) {
  const normalizedValue = normalizeString(value);
  if (!normalizedValue || normalizedValue.startsWith('data:')) {
    return normalizedValue;
  }

  if (isDockerRuntime()) {
    const localPath = resolveLocalMediaReferencePath(normalizedValue);
    const mediaKeyReference = getDockerProviderMediaKeyReference(normalizedValue);
    const canCanonicalizeMediaKey = !/^https?:\/\//i.test(normalizedValue) ||
      Boolean(mediaKeyReference || localPath);
    const canonicalMediaKey = canCanonicalizeMediaKey
      ? getDockerPublicMediaKey(mediaKeyReference || normalizedValue, localPath || '')
      : '';

    if (!shouldUseDockerLocalMedia() && canonicalMediaKey) {
      const secureReference = canonicalMediaKey;
      assertConfiguredDockerExternalMediaDelivery(normalizedValue);
      const signedUrl = buildSecureMediaDeliveryUrl(secureReference);
      if (signedUrl && signedUrl !== secureReference && /^https?:\/\//i.test(signedUrl)) {
        await primeCDNCache(signedUrl, { requireSuccess: true });
        return signedUrl;
      }
      throw buildInvalidProviderMediaReferenceError(normalizedValue);
    }

    if (shouldUseDockerLocalMedia() && canonicalMediaKey) {
      return buildBestDockerPublicMediaUrl(canonicalMediaKey, localPath || '', options);
    }

    if (isDockerOwnedOrUnsafeMediaReference(normalizedValue)) {
      throw buildInvalidProviderMediaReferenceError(normalizedValue);
    }
  }

  const localPath = resolveLocalMediaReferencePath(normalizedValue);
  const referencePath = getReferencePath(normalizedValue).replace(/^[\\/]+/, '');
  const mediaKeyReference = getProviderMediaKeyReference(normalizedValue) ||
    (MEDIA_KEY_PREFIX_PATTERN.test(referencePath) ? referencePath : '');

  if (!shouldUseDockerLocalMedia()) {
    if (localPath && mediaKeyReference) {
      return resolveLocalProviderMediaUrl(normalizedValue, localPath, mediaKeyReference);
    }
    return normalizedValue;
  }

  if (isDockerRuntime()) {
    return normalizedValue;
  }

  if (localPath) {
    return buildBestDockerPublicMediaUrl(normalizedValue, localPath, options);
  }

  if (mediaKeyReference) {
    return buildBestDockerPublicMediaUrl(mediaKeyReference, '', options);
  }

  if (/^https?:\/\//i.test(normalizedValue) && !isProbablyPublicUrl(normalizedValue)) {
    if (mediaKeyReference) {
      return buildBestDockerPublicMediaUrl(mediaKeyReference, '', options);
    }
  }

  return normalizedValue;
}

function getDockerMediaFilePath(key) {
  const normalizedKey = normalizeObjectKey(key);
  const relativeKey = normalizedKey
    .replace(new RegExp(`^${SECURE_ASSET_PREFIX}/`), '')
    .replace(/^assets_v2\//, '');
  return path.join(process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2', relativeKey);
}

async function persistDockerMediaFile(absolutePath, key) {
  const destinationPath = getDockerMediaFilePath(key);
  await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
  if (path.resolve(absolutePath) !== path.resolve(destinationPath)) {
    await fs.promises.copyFile(absolutePath, destinationPath);
  }
  return buildMediaDeliveryUrl(key);
}

/**
 * Validates that all required AWS environment variables are set.
 */
function validateAWSEnvVariables() {
  if (!normalizeString(process.env.AWS_ACCESS_KEY_ID || AWS_ACCESS_KEY_ID)) {
    throw new Error('Missing AWS_ACCESS_KEY_ID environment variable.');
  }
  if (!normalizeString(process.env.AWS_SECRET_ACCESS_KEY || AWS_SECRET_ACCESS_KEY)) {
    throw new Error('Missing AWS_SECRET_ACCESS_KEY environment variable.');
  }
  if (!normalizeString(process.env.AWS_CDN_REGION || AWS_REGION)) {
    throw new Error('Missing AWS_REGION environment variable.');
  }
}

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function getS3EndpointOptions() {
  const options = {};
  const endpoint = process.env.S3_ENDPOINT || process.env.AWS_S3_ENDPOINT;
  if (endpoint) {
    options.endpoint = endpoint;
  }
  if (isTruthyEnv(process.env.S3_FORCE_PATH_STYLE || process.env.AWS_S3_FORCE_PATH_STYLE)) {
    options.forcePathStyle = true;
  }
  return options;
}

/**
 * Initializes and returns an S3 client with the provided credentials and region.
 *
 * @returns {S3Client} - Configured S3 client instance.
 */
function initializeS3Client() {
  if (shouldUseBackblazeNativeApi()) {
    return createBackblazeNativeClientFromEnv();
  }
  return new S3Client({
    region: process.env.AWS_CDN_REGION || AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || AWS_SECRET_ACCESS_KEY,
    },
    ...getS3EndpointOptions(),
    requestHandler: new NodeHttpHandler({
      connectionTimeout: getPositiveIntegerEnv('SAMSAR_S3_CONNECTION_TIMEOUT_MS', 30_000),
      socketTimeout: getPositiveIntegerEnv('SAMSAR_S3_SOCKET_TIMEOUT_MS', 300_000),
    }),
    maxAttempts: getPositiveIntegerEnv('SAMSAR_S3_CLIENT_MAX_ATTEMPTS', 3),
    retryMode: 'standard',
  });
}

function getPositiveIntegerEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/**
 * Creates and returns a read stream for the specified file path.
 * This is needed because a read stream can only be used once.
 */
function createFileStream(filePath) {
  return fs.createReadStream(filePath);
}

function getUploadErrorCode(error) {
  let current = error;
  for (let depth = 0; current && depth < 4; depth += 1) {
    const code = current.code || current.name;
    if (code) {
      return String(code);
    }
    current = current.cause;
  }
  return '';
}

function getUploadErrorSummary(error) {
  const name = error?.name && error.name !== 'Error' ? `${error.name}: ` : '';
  const message = error?.message || String(error || 'Unknown upload error');
  return `${name}${message}`;
}

function isRetryableUploadError(error) {
  const statusCode = Number(error?.$metadata?.httpStatusCode || error?.statusCode || error?.status);
  if (Number.isFinite(statusCode)) {
    return statusCode === 408 || statusCode === 429 || statusCode >= 500;
  }

  const code = getUploadErrorCode(error).toUpperCase();
  if (
    code.includes('TIMEOUT') ||
    [
      'ECONNRESET',
      'ECONNABORTED',
      'ECONNREFUSED',
      'EPIPE',
      'ETIMEDOUT',
      'EAI_AGAIN',
      'ENETUNREACH',
      'REQUESTTIMEOUT',
      'SLOWDOWN',
      'SERVICEUNAVAILABLE',
      'INTERNALERROR',
    ].includes(code)
  ) {
    return true;
  }

  return error?.$retryable !== undefined || !Number.isFinite(statusCode);
}

function getUploadRetryDelayMs(attempt) {
  const baseDelayMs = getPositiveIntegerEnv('SAMSAR_MEDIA_UPLOAD_RETRY_BASE_DELAY_MS', 500);
  const maxDelayMs = getPositiveIntegerEnv('SAMSAR_MEDIA_UPLOAD_RETRY_MAX_DELAY_MS', 5_000);
  const exponentialDelayMs = Math.min(maxDelayMs, baseDelayMs * (2 ** Math.max(0, attempt - 1)));
  return exponentialDelayMs + Math.floor(Math.random() * Math.max(1, baseDelayMs));
}

async function uploadImageObject({ absolutePath, fileSize, uploadKey }) {
  const maxAttempts = getPositiveIntegerEnv('SAMSAR_MEDIA_UPLOAD_MAX_ATTEMPTS', 3);
  const reusableBody = fileSize < MULTIPART_UPLOAD_THRESHOLD_BYTES
    ? await fs.promises.readFile(absolutePath)
    : null;
  let attemptsMade = 0;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attemptsMade = attempt;
    const fileStream = reusableBody ? null : createFileStream(absolutePath);
    const uploadParams = {
      Bucket: MEDIA_BUCKET_NAME,
      Key: uploadKey,
      Body: reusableBody || fileStream,
      ContentType: getMediaContentType(absolutePath),
      ContentLength: fileSize,
    };

    try {
      if (fileSize >= MULTIPART_UPLOAD_THRESHOLD_BYTES && !shouldUseBackblazeNativeApi()) {
        const upload = new Upload({
          client: getS3Client(),
          params: uploadParams,
          leavePartsOnError: false,
        });
        await upload.done();
      } else {
        await getS3Client().send(new PutObjectCommand(uploadParams));
      }
      return;
    } catch (error) {
      lastError = error;
      if (fileStream && !fileStream.destroyed) {
        fileStream.destroy();
      }

      const willRetry = attempt < maxAttempts && isRetryableUploadError(error);
      console.warn('[AWS] Image media upload attempt failed', {
        attempt,
        maxAttempts,
        willRetry,
        objectKey: uploadKey,
        fileSize,
        error: getUploadErrorSummary(error),
      });
      if (!willRetry) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, getUploadRetryDelayMs(attempt)));
    }
  }

  const error = new Error(
    `Failed to upload image to media storage after ${attemptsMade} attempts. ` +
    `Last error: ${getUploadErrorSummary(lastError)}`,
    { cause: lastError },
  );
  error.name = 'MediaUploadError';
  error.code = 'SAMSAR_MEDIA_UPLOAD_FAILED';
  error.attempts = attemptsMade;
  error.objectKey = uploadKey;
  throw error;
}

export async function uploadFrameLayerImageToCDN(absolutePath, remoteFileName) {
  const folderName = 'temp_images';

  if (!remoteFileName) {
    return;
  }

  // Check if the file exists
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found at path: ${absolutePath}`);
  }

  const remoteImageKey = buildSessionScopedRemoteFileName(remoteFileName, absolutePath);
  const uploadKey = buildMediaUploadKey(folderName, remoteImageKey);

  if (shouldUseDockerLocalMedia()) {
    return persistDockerMediaFile(absolutePath, uploadKey);
  }
  assertExplicitDockerExternalMediaConfiguration();

  const fileSize = fs.statSync(absolutePath).size;
  await uploadImageObject({ absolutePath, fileSize, uploadKey });

  // Cache priming is intentionally left to callers as a best-effort step. A
  // transient CDN read failure must not turn a completed object write into a
  // failed upload or cause the same object to be uploaded repeatedly.
  return buildMediaDeliveryUrl(uploadKey);
}

/**
 * Helper function to access a URL to prime the CDN cache.
 *
 * @param {string} url - The URL to access.
 */
export async function primeCDNCache(url, options = {}) {
  if (shouldUseDockerLocalMedia()) {
    return true;
  }

  const requireSuccess = Boolean(options.requireSuccess);
  const attempts = Math.max(1, Number(options.attempts || (requireSuccess ? 3 : 1)));
  const retryDelayMs = Number(options.retryDelayMs || 500);
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
      });
      if (response.body) {
        try {
          if (typeof response.body.cancel === 'function') {
            await response.body.cancel();
          } else if (typeof response.body.destroy === 'function') {
            response.body.destroy();
          }
        } catch {}
      }
      if (response.ok || response.status === 206) {
        return true;
      }
      lastError = new Error(`CDN cache prime returned status ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  if (requireSuccess) {
    throw lastError || new Error(`Failed to prime CDN cache for URL: ${url}`);
  }
  return false;
}
