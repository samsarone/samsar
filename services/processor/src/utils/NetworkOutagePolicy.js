// Canonical dependency-free policy. Keep worker copies byte-identical; this
// module classifies and gates work, and never executes or replays provider jobs.
export const NETWORK_OUTAGE_POLICY_VERSION = 1;
const TRANSPORT_CODES = new Set([
  'ECONNRESET', 'ECONNABORTED', 'ERR_CANCELED', 'ECONNREFUSED', 'ETIMEDOUT', 'ESOCKETTIMEDOUT',
  'EAI_AGAIN', 'ENOTFOUND', 'EPIPE', 'ENETDOWN', 'ENETUNREACH', 'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET', 'SAMSAR_MEDIA_TUNNEL_UNREACHABLE', 'NETWORK_OUTAGE_GATE_BLOCKED',
]);
const SAFE_PHASES = new Set(['prepare', 'poll', 'result', 'download', 'deliver']);
const positive = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;

/** Classifications contain safe codes/status only, never error messages/URLs. */
export function classifyNetworkOutage(error) {
  const pending = [error], seen = new Set();
  while (pending.length && seen.size < 64) {
    const current = pending.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    const status = Number(current.response?.status ?? current.statusCode ?? current.status ?? current.$metadata?.httpStatusCode);
    if (status === 408 || status === 425 || status === 429 || status >= 500 && status <= 599) {
      return { kind: 'transient_http', retryable: true, code: 'PROVIDER_HTTP_UNAVAILABLE', status };
    }
    if (status >= 400 && status <= 499) {
      return { kind: 'provider_terminal', retryable: false, code: 'PROVIDER_HTTP_TERMINAL', status };
    }
    if (TRANSPORT_CODES.has(current.code)) return { kind: 'transport', retryable: true, code: current.code };
    if (['TimeoutError', 'RequestTimeout', 'AbortError'].includes(current.name)) {
      return { kind: 'transport', retryable: true, code: 'NETWORK_REQUEST_TIMEOUT_OR_ABORT' };
    }
    pending.push(current.cause);
    if (Array.isArray(current.errors)) pending.push(...current.errors);
  }
  return { kind: 'other', retryable: false, code: 'NETWORK_ERROR_UNCLASSIFIED' };
}

export const isNetworkOutageError = error => classifyNetworkOutage(error).retryable;

/** Apply only after an attempted operation fails. A blocked pre-submit gate is
 * a safe skip/wait, not an attempted submission with an unknown outcome. */
export function decideNetworkOutageAction({ phase, error, providerRequestId, attempt = 0, maxAttempts = 3 } = {}) {
  const classification = classifyNetworkOutage(error);
  const safety = { maySubmit: false, sameRequestRequired: true };
  if (phase === 'submit' && error?.providerRequestSent === false && error?.code === 'NETWORK_OUTAGE_GATE_BLOCKED') phase = 'prepare';
  if (phase === 'submit') {
    if (classification.kind === 'provider_terminal') return { ...safety, action: 'terminal', code: classification.code };
    const accepted = typeof providerRequestId === 'string' ? providerRequestId.trim()
      : typeof providerRequestId === 'number' && Number.isFinite(providerRequestId);
    return accepted ? { ...safety, action: 'poll', code: 'PROVIDER_REQUEST_ACCEPTED' }
      : { ...safety, action: 'fail', code: 'PROVIDER_SUBMISSION_OUTCOME_UNKNOWN' };
  }
  if (!classification.retryable) return { ...safety, action: 'terminal', code: classification.code };
  if (!SAFE_PHASES.has(phase)) return { ...safety, action: 'fail', code: 'PROVIDER_NETWORK_REPLAY_UNSAFE' };
  return Number(attempt) >= positive(maxAttempts, 3)
    ? { ...safety, action: 'fail', code: 'PROVIDER_NETWORK_RETRY_EXHAUSTED' }
    : { ...safety, action: 'retry', code: 'PROVIDER_NETWORK_RETRY_PENDING' };
}

async function boundedProbe(probe, timeoutMs) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => probe({ signal: controller.signal })),
      new Promise((_, reject) => { timer = setTimeout(() => {
        const error = Object.assign(new Error('Dependency probe timed out.'), { code: 'ETIMEDOUT' });
        reject(error);
        controller.abort();
      }, timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** No probe is configured by default, and provider 429/5xx never open this
 * transport circuit. Accepted request polling must remain outside admission. */
export function createNetworkOutageCircuit({ probe = null, now = Date.now, cooldownMs = 5000, maxFailures = 3, probeTimeoutMs = 5000 } = {}) {
  cooldownMs = positive(cooldownMs, 5000);
  maxFailures = positive(maxFailures, 3);
  probeTimeoutMs = positive(probeTimeoutMs, 5000);
  let failures = 0, retryAt = 0, verified = false, inFlight = null, lastCode = null, revision = 0;
  const snapshot = () => {
    const retryAfterMs = Math.max(0, retryAt - now());
    const state = retryAfterMs ? failures >= maxFailures ? 'exhausted' : 'cooldown' : 'ready';
    return { allowed: !retryAfterMs, state, retryAfterMs, failures, ...(lastCode ? { code: lastCode } : {}) };
  };
  const recordSuccess = () => {
    failures = 0; retryAt = 0; lastCode = null; verified = true; revision++;
    return snapshot();
  };
  const open = code => {
    failures++; retryAt = now() + cooldownMs; verified = false; lastCode = code; revision++;
    return snapshot();
  };
  const recordFailure = error => {
    const classification = classifyNetworkOutage(error);
    return classification.kind === 'transport' && classification.code !== 'NETWORK_OUTAGE_GATE_BLOCKED'
      ? open(classification.code) : snapshot();
  };
  const gate = async ({ forceProbe = false } = {}) => {
    const current = snapshot();
    if (!current.allowed) return current;
    if (inFlight) return inFlight;
    if (typeof probe !== 'function' || verified && !forceProbe) return current;
    const probeRevision = revision;
    inFlight = (async () => {
      try {
        const result = await boundedProbe(probe, probeTimeoutMs);
        if (revision !== probeRevision) return snapshot();
        if (result === true || result?.ok === true) return recordSuccess();
      } catch {}
      if (revision !== probeRevision) return snapshot();
      const blocked = open('NETWORK_DEPENDENCY_UNAVAILABLE');
      return { ...blocked, state: blocked.failures >= maxFailures ? 'exhausted' : 'blocked' };
    })();
    try { return await inFlight; } finally { inFlight = null; }
  };
  return { gate, recordFailure, recordSuccess, snapshot };
}

/** Opt-in read-only health probe. Never infer an endpoint or paid provider call. */
export function createDependencyHealthProbe({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const configured = typeof env.SAMSAR_NETWORK_DEPENDENCY_HEALTH_URL === 'string'
    ? env.SAMSAR_NETWORK_DEPENDENCY_HEALTH_URL.trim() : '';
  if (!configured) return null;
  let url;
  try {
    url = new URL(configured);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return async () => ({ ok: false });
  } catch { return async () => ({ ok: false }); }
  return async ({ signal } = {}) => {
    if (typeof fetchImpl !== 'function') return { ok: false };
    try {
      const response = await fetchImpl(url.href, { method: 'HEAD', redirect: 'error', cache: 'no-store', signal });
      if (response.body?.cancel) { try { await response.body.cancel(); } catch {} }
      return { ok: response.ok === true };
    } catch { return { ok: false }; }
  };
}
