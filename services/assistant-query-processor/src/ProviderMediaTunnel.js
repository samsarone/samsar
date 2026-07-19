import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_RUNTIME_CONFIG_PATH = '/persistent/config/samsar.config.json';
const DEFAULT_REFRESH_WAIT_MS = 120_000;
const DEFAULT_REFRESH_POLL_MS = 500;
const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInteger(value, fallback, minimum = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? Math.floor(parsed) : fallback;
}

function normalizeMediaPath(value) {
  const normalized = normalizeString(value).replace(/^\/+/, '');
  const rawSegments = normalized.split('/').filter(Boolean);
  if (!rawSegments.length) {
    throw new Error('Provider media path must be a safe non-empty relative path.');
  }

  return rawSegments.map((segment) => {
    let decodedSegment = segment;
    try {
      for (let index = 0; index < 2; index += 1) {
        const next = decodeURIComponent(decodedSegment);
        if (next === decodedSegment) break;
        decodedSegment = next;
      }
    } catch {
      throw new Error('Provider media path contains invalid encoding.');
    }

    if (
      decodedSegment === '.' ||
      decodedSegment === '..' ||
      decodedSegment.includes('/') ||
      decodedSegment.includes('\\') ||
      decodedSegment.includes('\0')
    ) {
      throw new Error('Provider media path must not contain traversal or encoded path separators.');
    }
    return encodeURIComponent(decodedSegment);
  }).join('/');
}

function isPrivateOrLocalHostname(value) {
  const hostname = normalizeString(value).toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  return hostname === 'localhost' ||
    hostname === 'media-gateway' ||
    hostname === 'host.docker.internal' ||
    hostname === '0.0.0.0' ||
    hostname === '::1' ||
    hostname.endsWith('.local') ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    /^169\.254\./.test(hostname) ||
    /^f[cd][0-9a-f]{2}:/i.test(hostname) ||
    /^fe[89ab][0-9a-f]:/i.test(hostname);
}

function normalizePublicHttpsBaseUrl(value) {
  try {
    const url = new URL(normalizeString(value));
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      isPrivateOrLocalHostname(url.hostname)
    ) {
      return '';
    }
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function uniqueBaseUrls(values = []) {
  return values
    .map(normalizePublicHttpsBaseUrl)
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
}

export function buildProviderMediaUrl(mediaPath, baseUrl) {
  const normalizedMediaPath = normalizeMediaPath(mediaPath);
  const normalizedBaseUrl = normalizePublicHttpsBaseUrl(baseUrl);
  if (!normalizedBaseUrl) return '';

  try {
    const parsedBaseUrl = new URL(normalizedBaseUrl);
    const basePath = parsedBaseUrl.pathname.replace(/^\/+|\/+$/g, '');
    const combinedPath = basePath && (
      normalizedMediaPath === basePath || normalizedMediaPath.startsWith(`${basePath}/`)
    )
      ? normalizedMediaPath
      : [basePath, normalizedMediaPath].filter(Boolean).join('/');
    parsedBaseUrl.pathname = `/${combinedPath}`;
    return parsedBaseUrl.toString();
  } catch {
    return '';
  }
}

function buildCandidateUrls(mediaPath, baseUrls) {
  return uniqueBaseUrls(baseUrls)
    .map((baseUrl) => buildProviderMediaUrl(mediaPath, baseUrl))
    .filter(Boolean);
}

export async function probeExactProviderMediaUrl(
  url,
  expectedContentTypePrefix,
  { fetchImpl = globalThis.fetch } = {},
) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    positiveInteger(process.env.SAMSAR_PUBLIC_MEDIA_PROBE_TIMEOUT_MS, DEFAULT_PROBE_TIMEOUT_MS, 100),
  );

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
    });
    const contentType = normalizeString(response.headers?.get?.('content-type')).toLowerCase();
    const finalUrl = normalizeString(response.url) || url;
    let parsedFinalUrl;
    try {
      parsedFinalUrl = new URL(finalUrl);
    } catch {
      parsedFinalUrl = null;
    }
    const publicHttpsFinalUrl = Boolean(
      parsedFinalUrl &&
      parsedFinalUrl.protocol === 'https:' &&
      !isPrivateOrLocalHostname(parsedFinalUrl.hostname),
    );

    if (response.body) {
      try {
        if (typeof response.body.cancel === 'function') {
          await response.body.cancel();
        } else if (typeof response.body.destroy === 'function') {
          response.body.destroy();
        }
      } catch {}
    }

    return (response.ok || response.status === 206) &&
      contentType.startsWith(expectedContentTypePrefix) &&
      publicHttpsFinalUrl;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function findReachableCandidate(
  mediaPath,
  getBaseUrlCandidates,
  expectedContentTypePrefix,
  fetchImpl,
) {
  const candidateUrls = buildCandidateUrls(mediaPath, await getBaseUrlCandidates());
  for (const candidateUrl of candidateUrls) {
    if (await probeExactProviderMediaUrl(candidateUrl, expectedContentTypePrefix, { fetchImpl })) {
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
  if (configuredPath) return configuredPath;

  const runtimeConfigPath = normalizeString(
    process.env.SAMSAR_RUNTIME_CONFIG_FILE ||
    process.env.SAMSAR_CONFIG_FILE ||
    DEFAULT_RUNTIME_CONFIG_PATH,
  ) || DEFAULT_RUNTIME_CONFIG_PATH;
  return path.join(path.dirname(runtimeConfigPath), 'media-tunnel-refresh.request.json');
}

function writeRefreshRequest({ serviceName, mediaPath, attemptedUrls }) {
  const requestPath = getRefreshRequestPath();
  fs.mkdirSync(path.dirname(requestPath), { recursive: true });
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
 * Resolve and probe the exact mounted Docker asset at the provider boundary.
 * A stale managed tunnel asks the Compose controller for a replacement and
 * polls the shared runtime config; an unprobed URL is never returned.
 */
export async function resolveFreshManagedProviderMediaUrl({
  mediaPath,
  getBaseUrlCandidates,
  serviceName = 'samsar_assistant_query_processor',
  expectedContentTypePrefix = 'application/',
  fetchImpl = globalThis.fetch,
}) {
  if (typeof getBaseUrlCandidates !== 'function') {
    throw new TypeError('getBaseUrlCandidates must be a function.');
  }
  const normalizedMediaPath = normalizeMediaPath(mediaPath);
  const normalizedContentTypePrefix = normalizeString(expectedContentTypePrefix).toLowerCase();
  if (!normalizedContentTypePrefix || !normalizedContentTypePrefix.endsWith('/')) {
    throw new TypeError('expectedContentTypePrefix must be a MIME type prefix ending in /.');
  }

  const initial = await findReachableCandidate(
    normalizedMediaPath,
    getBaseUrlCandidates,
    normalizedContentTypePrefix,
    fetchImpl,
  );
  if (initial.url) return initial.url;

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
  );
  const pollMs = positiveInteger(
    process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_POLL_MS,
    DEFAULT_REFRESH_POLL_MS,
    10,
  );
  const deadline = Date.now() + waitMs;
  let attemptedUrls = initial.attemptedUrls;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(
      resolve,
      Math.min(pollMs, Math.max(1, deadline - Date.now())),
    ));
    const refreshed = await findReachableCandidate(
      normalizedMediaPath,
      getBaseUrlCandidates,
      normalizedContentTypePrefix,
      fetchImpl,
    );
    attemptedUrls = [...new Set([...attemptedUrls, ...refreshed.attemptedUrls])];
    if (refreshed.url) return refreshed.url;
  }

  throw buildUnreachableError({
    serviceName,
    mediaPath: normalizedMediaPath,
    attemptedUrls,
    refreshRequestPath,
  });
}

export async function resolveReachableConfiguredProviderMediaUrl({
  mediaPath,
  baseUrls,
  expectedContentTypePrefix,
  serviceName = 'samsar_assistant_query_processor',
  fetchImpl = globalThis.fetch,
}) {
  const normalizedMediaPath = normalizeMediaPath(mediaPath);
  const candidates = buildCandidateUrls(normalizedMediaPath, baseUrls);
  for (const candidate of candidates) {
    if (await probeExactProviderMediaUrl(candidate, expectedContentTypePrefix, { fetchImpl })) {
      return candidate;
    }
  }

  const error = new Error(
    `No configured public HTTPS CDN could serve ${normalizedMediaPath} for ${serviceName}; provider dispatch was blocked.`,
  );
  error.name = 'SamsarProviderMediaCdnError';
  error.code = 'SAMSAR_PROVIDER_MEDIA_CDN_UNREACHABLE';
  error.retryable = true;
  error.mediaPath = normalizedMediaPath;
  error.attemptedUrls = candidates;
  throw error;
}
