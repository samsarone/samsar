import fs from 'fs';
import path from 'path';

const DEFAULT_RUNTIME_CONFIG_PATH = '/persistent/config/samsar.config.json';
const DEFAULT_REFRESH_WAIT_MS = 120_000;
const DEFAULT_REFRESH_POLL_MS = 500;
const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isPrivateOrLocalHostname(value) {
  const hostname = normalizeString(value).toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  return hostname === 'localhost' || hostname === 'media-gateway' ||
    hostname === 'host.docker.internal' || hostname === '0.0.0.0' || hostname === '::1' ||
    hostname.endsWith('.local') || /^127\./.test(hostname) || /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    /^169\.254\./.test(hostname) || /^f[cd][0-9a-f]{2}:/i.test(hostname) ||
    /^fe[89ab][0-9a-f]:/i.test(hostname);
}

function positiveInteger(value, fallback, minimum = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? Math.floor(parsed) : fallback;
}

function normalizeMediaPath(value) {
  const normalized = normalizeString(value).replace(/^\/+/, '');
  const segments = normalized.split('/').filter(Boolean);
  const decodedSegments = segments.map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      throw new Error('Provider media path contains invalid URL encoding.');
    }
  });
  if (
    !decodedSegments.length ||
    decodedSegments.some((segment) => segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\'))
  ) {
    throw new Error('Provider media path must be a safe non-empty relative path.');
  }
  return decodedSegments.map((segment) => encodeURIComponent(segment)).join('/');
}

function normalizeManagedBaseUrl(value) {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  try {
    const url = new URL(normalized);
    if (
      url.protocol !== 'https:' ||
      isPrivateOrLocalHostname(url.hostname) ||
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

function uniqueBaseUrls(values = []) {
  return values
    .map(normalizeManagedBaseUrl)
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
}

function buildCandidateUrls(mediaPath, baseUrls) {
  return uniqueBaseUrls(baseUrls).map((baseUrl) => new URL(mediaPath, `${baseUrl}/`).href);
}

async function probeExactMediaUrl(url, expectedContentTypePrefix = '') {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    positiveInteger(process.env.SAMSAR_PUBLIC_MEDIA_PROBE_TIMEOUT_MS, DEFAULT_PROBE_TIMEOUT_MS, 100),
  );
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
    });
    const contentType = normalizeString(response.headers?.get?.('content-type')).toLowerCase();
    if (response.body && typeof response.body.cancel === 'function') {
      try {
        await response.body.cancel();
      } catch {}
    }
    const invalidContentType = contentType.includes('text/html') ||
      contentType.includes('application/json') ||
      contentType.startsWith('text/');
    let finalUrl;
    try {
      finalUrl = new URL(normalizeString(response.url) || url);
    } catch {
      return false;
    }
    const publicHttpsRedirect = finalUrl.protocol === 'https:' &&
      !isPrivateOrLocalHostname(finalUrl.hostname);
    const validExpectedContentType = !expectedContentTypePrefix ||
      contentType.startsWith(expectedContentTypePrefix);
    return (response.ok || response.status === 206) && !invalidContentType &&
      validExpectedContentType && publicHttpsRedirect;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function findReachableCandidate(mediaPath, getBaseUrlCandidates, expectedContentTypePrefix = '') {
  const candidateUrls = buildCandidateUrls(mediaPath, await getBaseUrlCandidates());
  for (const candidateUrl of candidateUrls) {
    if (await probeExactMediaUrl(candidateUrl, expectedContentTypePrefix)) {
      return { url: candidateUrl, attemptedUrls: candidateUrls };
    }
  }
  return { url: '', attemptedUrls: candidateUrls };
}

function getRefreshRequestPath() {
  const configuredPath = normalizeString(
    process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_REQUEST_PATH ||
    process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_REQUEST_FILE,
  );
  if (configuredPath) {
    return configuredPath;
  }
  const runtimeConfigPath = normalizeString(
    process.env.SAMSAR_RUNTIME_CONFIG_FILE ||
    process.env.SAMSAR_CONFIG_FILE ||
    DEFAULT_RUNTIME_CONFIG_PATH,
  ) || DEFAULT_RUNTIME_CONFIG_PATH;
  return path.join(path.dirname(runtimeConfigPath), 'media-tunnel-refresh.request.json');
}

function writeRefreshRequest({ serviceName, mediaPath, attemptedUrls }) {
  const requestPath = getRefreshRequestPath();
  const requestDirectory = path.dirname(requestPath);
  fs.mkdirSync(requestDirectory, { recursive: true });
  const payload = {
    schema: 'samsar.media-tunnel-refresh.v1',
    requestedAt: new Date().toISOString(),
    requesterPid: process.pid,
    service: serviceName,
    reason: 'exact_provider_media_url_unreachable',
    mediaPath,
    attemptedUrls,
  };
  const temporaryPath = `${requestPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, requestPath);
  return requestPath;
}

function buildUnreachableError({ serviceName, mediaPath, attemptedUrls, refreshRequestPath, cause }) {
  const error = new Error(
    `No fresh public tunnel URL could serve ${mediaPath} for ${serviceName}; provider dispatch was blocked.`,
    cause ? { cause } : undefined,
  );
  error.name = 'SamsarMediaTunnelError';
  error.code = 'SAMSAR_MEDIA_TUNNEL_UNREACHABLE';
  error.retryable = true;
  error.mediaPath = mediaPath;
  error.attemptedUrls = attemptedUrls;
  error.refreshRequestPath = refreshRequestPath;
  return error;
}

/**
 * Resolves and probes the exact local Docker asset immediately before an
 * external provider request. An unreachable managed tunnel triggers the shared
 * setup-controller refresh marker. Stale URLs are never returned.
 */
export async function resolveFreshManagedProviderMediaUrl({
  mediaPath,
  getBaseUrlCandidates,
  serviceName = 'samsar_provider_worker',
  expectedContentTypePrefix = '',
}) {
  if (typeof getBaseUrlCandidates !== 'function') {
    throw new TypeError('getBaseUrlCandidates must be a function.');
  }

  const normalizedMediaPath = normalizeMediaPath(mediaPath);
  const normalizedContentTypePrefix = normalizeString(expectedContentTypePrefix).toLowerCase();
  if (normalizedContentTypePrefix && !normalizedContentTypePrefix.endsWith('/')) {
    throw new TypeError('expectedContentTypePrefix must be empty or a MIME type prefix ending in /.');
  }
  const initial = await findReachableCandidate(
    normalizedMediaPath,
    getBaseUrlCandidates,
    normalizedContentTypePrefix,
  );
  if (initial.url) {
    return initial.url;
  }

  let refreshRequestPath = '';
  try {
    refreshRequestPath = writeRefreshRequest({
      serviceName,
      mediaPath: normalizedMediaPath,
      attemptedUrls: initial.attemptedUrls,
    });
  } catch (cause) {
    throw buildUnreachableError({
      serviceName,
      mediaPath: normalizedMediaPath,
      attemptedUrls: initial.attemptedUrls,
      refreshRequestPath,
      cause,
    });
  }

  const waitMs = positiveInteger(
    process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_WAIT_MS,
    DEFAULT_REFRESH_WAIT_MS,
    1,
  );
  const pollMs = positiveInteger(
    process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_POLL_MS,
    DEFAULT_REFRESH_POLL_MS,
    10,
  );
  const deadline = Date.now() + waitMs;
  let attemptedUrls = initial.attemptedUrls;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, Math.max(1, deadline - Date.now()))));
    const refreshed = await findReachableCandidate(
      normalizedMediaPath,
      getBaseUrlCandidates,
      normalizedContentTypePrefix,
    );
    attemptedUrls = [...new Set([...attemptedUrls, ...refreshed.attemptedUrls])];
    if (refreshed.url) {
      return refreshed.url;
    }
  }

  throw buildUnreachableError({
    serviceName,
    mediaPath: normalizedMediaPath,
    attemptedUrls,
    refreshRequestPath,
  });
}
