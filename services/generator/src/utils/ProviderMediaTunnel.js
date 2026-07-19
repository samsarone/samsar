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
  const normalized = normalizeString(value).replace(/^\/+/, '');
  const segments = normalized.split('/').filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('Provider media path must be a safe non-empty relative path.');
  }
  return segments.map((segment) => {
    try {
      return encodeURIComponent(decodeURIComponent(segment));
    } catch {
      return encodeURIComponent(segment);
    }
  }).join('/');
}

function uniqueBaseUrls(values = []) {
  return values
    .map((value) => normalizeString(value).replace(/\/+$/, ''))
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
}

function buildCandidateUrls(mediaPath, baseUrls) {
  return uniqueBaseUrls(baseUrls).map((baseUrl) => `${baseUrl}/${mediaPath}`);
}

async function probeExactMediaUrl(url) {
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
    return (response.ok || response.status === 206) && !contentType.includes('text/html');
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function findReachableCandidate(mediaPath, getBaseUrlCandidates) {
  const candidateUrls = buildCandidateUrls(mediaPath, await getBaseUrlCandidates());
  for (const candidateUrl of candidateUrls) {
    if (await probeExactMediaUrl(candidateUrl)) {
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
}) {
  if (typeof getBaseUrlCandidates !== 'function') {
    throw new TypeError('getBaseUrlCandidates must be a function.');
  }

  const normalizedMediaPath = normalizeMediaPath(mediaPath);
  const initial = await findReachableCandidate(normalizedMediaPath, getBaseUrlCandidates);
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
    const refreshed = await findReachableCandidate(normalizedMediaPath, getBaseUrlCandidates);
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

