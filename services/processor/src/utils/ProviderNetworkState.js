function setField(target, key, value) {
  if (typeof target?.set === 'function') target.set(key, value, { strict: false });
  if (target) target[key] = typeof target.get === 'function' ? target.get(key) : value;
}

// Called only when an explicit user operation creates a new session. An old
// attempt's terminal receipt must never become the new operation's failure.
export function clearInheritedProviderNetworkFailure(session = {}) {
  setField(session, 'providerNetworkFailure', null);
  for (const layer of session.layers || []) {
    setField(layer, 'lipSyncInfrastructureFailure', false);
    setField(layer, 'lipSyncVideoGenerationErrorCode', null);
  }
  return session;
}
