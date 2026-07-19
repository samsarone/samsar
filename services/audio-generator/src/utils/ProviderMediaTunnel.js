import fs from 'fs';
import path from 'path';

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
  const segments = normalizeString(value).replace(/^\/+/, '').split('/').filter(Boolean);
  if (!segments.length) {
    throw new Error('Provider media path must be a safe non-empty relative path.');
  }
  return segments.map((segment) => {
    let decoded = segment;
    try {
      for (let index = 0; index < 2; index += 1) {
        const next = decodeURIComponent(decoded);
        if (next === decoded) break;
        decoded = next;
      }
    } catch {
      throw new Error('Provider media path contains invalid encoding.');
    }
    if (
      decoded === '.' || decoded === '..' || decoded.includes('/') ||
      decoded.includes('\\') || decoded.includes('\0')
    ) {
      throw new Error('Provider media path contains unsafe segments.');
    }
    return encodeURIComponent(decoded);
  }).join('/');
}

function uniqueBaseUrls(values = []) {
  return values
    .map((value) => normalizeString(value).replace(/\/+$/, ''))
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
}

function buildCandidateUrl(mediaPath, baseUrl) {
  try {
    const parsed = new URL(baseUrl);
    if (
      parsed.protocol !== 'https:' || parsed.username || parsed.password ||
      parsed.search || parsed.hash || isPrivateOrLocalUrl(parsed.toString())
    ) {
      return '';
    }
    const basePath = parsed.pathname.replace(/^\/+|\/+$/g, '');
    const combinedPath = basePath && (mediaPath === basePath || mediaPath.startsWith(`${basePath}/`))
      ? mediaPath
      : [basePath, mediaPath].filter(Boolean).join('/');
    parsed.pathname = `/${combinedPath}`;
    return parsed.toString();
  } catch {
    return '';
  }
}

function isPrivateOrLocalUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return hostname === 'localhost' || hostname === 'media-gateway' ||
      hostname === 'host.docker.internal' || hostname === '0.0.0.0' || hostname === '::1' ||
      hostname.endsWith('.local') || /^127\./.test(hostname) || /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
      /^169\.254\./.test(hostname) || /^f[cd][0-9a-f]{2}:/i.test(hostname) ||
      /^fe[89ab][0-9a-f]:/i.test(hostname);
  } catch {
    return true;
  }
}

async function probeExactMediaUrl(url, expectedContentTypePrefix, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    positiveInteger(process.env.SAMSAR_PUBLIC_MEDIA_PROBE_TIMEOUT_MS, DEFAULT_PROBE_TIMEOUT_MS, 100),
  );
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0', 'Cache-Control': 'no-cache' },
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
    });
    const contentType = normalizeString(response.headers?.get?.('content-type')).toLowerCase();
    const finalUrl = normalizeString(response.url);
    let parsedFinalUrl;
    try {
      parsedFinalUrl = new URL(finalUrl || url);
    } catch {
      parsedFinalUrl = null;
    }
    const valid = (response.ok || response.status === 206) &&
      contentType.startsWith(expectedContentTypePrefix) &&
      Boolean(parsedFinalUrl) && parsedFinalUrl.protocol === 'https:' &&
      !isPrivateOrLocalUrl(parsedFinalUrl.toString());
    try {
      if (typeof response.body?.cancel === 'function') await response.body.cancel();
      else if (typeof response.body?.destroy === 'function') response.body.destroy();
    } catch {}
    return valid;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function findReachableCandidate(mediaPath, getBaseUrlCandidates, expectedContentTypePrefix, fetchImpl) {
  const candidateUrls = uniqueBaseUrls(await getBaseUrlCandidates())
    .map((baseUrl) => buildCandidateUrl(mediaPath, baseUrl))
    .filter(Boolean);
  for (const candidateUrl of candidateUrls) {
    if (await probeExactMediaUrl(candidateUrl, expectedContentTypePrefix, fetchImpl)) {
      return { url: candidateUrl, attemptedUrls: candidateUrls };
    }
  }
  return { url: '', attemptedUrls: candidateUrls };
}

function getRefreshRequestPath() {
  const configured = normalizeString(
    process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_REQUEST_PATH ||
    process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_REQUEST_FILE,
  );
  if (configured) return configured;
  const runtimeConfigPath = normalizeString(
    process.env.SAMSAR_RUNTIME_CONFIG_FILE || process.env.SAMSAR_CONFIG_FILE,
  ) || DEFAULT_RUNTIME_CONFIG_PATH;
  return path.join(path.dirname(runtimeConfigPath), 'media-tunnel-refresh.request.json');
}

function writeRefreshRequest({ serviceName, mediaPath, attemptedUrls }) {
  const requestPath = getRefreshRequestPath();
  fs.mkdirSync(path.dirname(requestPath), { recursive: true });
  const temporaryPath = `${requestPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify({
    schema: 'samsar.media-tunnel-refresh.v1',
    requestedAt: new Date().toISOString(),
    requesterPid: process.pid,
    service: serviceName,
    reason: 'exact_provider_media_url_unreachable',
    mediaPath,
    attemptedUrls,
  }, null, 2)}\n`, { mode: 0o600 });
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

/** Probe the exact asset and request a managed-tunnel refresh when stale. */
export async function resolveFreshManagedProviderMediaUrl({
  mediaPath,
  getBaseUrlCandidates,
  serviceName = 'samsar_audio_generator',
  expectedContentTypePrefix = 'application/',
  fetchImpl = globalThis.fetch,
}) {
  if (typeof getBaseUrlCandidates !== 'function') {
    throw new TypeError('getBaseUrlCandidates must be a function.');
  }
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('fetchImpl must be a function.');
  }
  const normalizedMediaPath = normalizeMediaPath(mediaPath);
  const contentTypePrefix = normalizeString(expectedContentTypePrefix).toLowerCase();
  if (!contentTypePrefix.endsWith('/')) {
    throw new TypeError('expectedContentTypePrefix must be a MIME type prefix ending in /.');
  }

  const initial = await findReachableCandidate(
    normalizedMediaPath, getBaseUrlCandidates, contentTypePrefix, fetchImpl,
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

  const deadline = Date.now() + positiveInteger(
    process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_WAIT_MS, DEFAULT_REFRESH_WAIT_MS,
  );
  const pollMs = positiveInteger(
    process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_POLL_MS, DEFAULT_REFRESH_POLL_MS, 10,
  );
  let attemptedUrls = initial.attemptedUrls;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, Math.max(1, deadline - Date.now()))));
    const refreshed = await findReachableCandidate(
      normalizedMediaPath, getBaseUrlCandidates, contentTypePrefix, fetchImpl,
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
