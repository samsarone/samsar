function normalizeSessionId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'object') {
    if (typeof value.$oid === 'string') {
      return value.$oid.trim() || null;
    }
    if (typeof value.toString === 'function') {
      const stringValue = value.toString();
      return stringValue && stringValue !== '[object Object]' ? stringValue : null;
    }
  }
  return null;
}

export function getStudioSessionId(session) {
  return normalizeSessionId(
    session?._id || session?.id || session?.sessionId || session?.session_id,
  );
}

export function hasInitialStudioLayer(session) {
  return Boolean(
    getStudioSessionId(session) &&
    Array.isArray(session?.layers) &&
    session.layers.length > 0,
  );
}

export function shouldAddInitialLayerToNewStudioSession(session) {
  return Boolean(
    getStudioSessionId(session) &&
    Array.isArray(session?.layers) &&
    session.layers.length === 0,
  );
}
