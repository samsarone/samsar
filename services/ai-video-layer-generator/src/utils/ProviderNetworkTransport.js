import { createNetworkOutageCircuit, createDependencyHealthProbe } from './NetworkOutagePolicy.js';

// One admission circuit for this worker, shared by every video adapter. A
// dependency probe is opt-in; accepted reads bypass admission and can heal it.
export const providerNetworkCircuit = createNetworkOutageCircuit({
  probe: createDependencyHealthProbe({ env: process.env, fetchImpl: (...args) => globalThis.fetch(...args) }),
});
const recordedFailures = new WeakSet();
export function recordProviderNetworkFailure(error) {
  if (error && typeof error === 'object') {
    if (recordedFailures.has(error)) return providerNetworkCircuit.snapshot();
    recordedFailures.add(error);
  }
  return providerNetworkCircuit.recordFailure(error);
}

function finiteTimeout() {
  return Math.max(1000, Number(process.env.AI_VIDEO_PROVIDER_HTTP_TIMEOUT_MS) || 30000);
}

export function providerRequestAxiosOptions(options = {}) {
  const timeout = Number(options.timeout) > 0 ? Number(options.timeout) : finiteTimeout();
  const deadline = AbortSignal.timeout(timeout);
  return { ...options, timeout, signal: options.signal ? AbortSignal.any([options.signal, deadline]) : deadline };
}

// This transport dispatches once, including POSTs. A response lost after send
// belongs to the durable ambiguity guard; it must never trigger a POST retry.
export async function providerRequestFetch(url, options = {}) {
  const deadline = AbortSignal.timeout(finiteTimeout());
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  try {
    const response = await globalThis.fetch(url, { ...options, signal });
    providerNetworkCircuit.recordSuccess();
    return response;
  } catch (error) {
    recordProviderNetworkFailure(error);
    throw error;
  }
}

export function blockedProviderNetworkGateError(gate) {
  return Object.assign(new Error('Network recovery is pending; provider submission has not been sent.'), {
    code: 'NETWORK_OUTAGE_GATE_BLOCKED', providerRequestSent: false,
    retryAfterMs: gate.retryAfterMs, networkGateBlocked: true,
  });
}
