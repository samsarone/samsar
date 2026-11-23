export const SESSION_POST_PROCESSING_PREFERENCE_FIELDS = Object.freeze([
  'translationEnableSubtitles',
  'translationTranslateOutro',
  'translationTranslateFooter',
]);

const preferenceFields = new Set(SESSION_POST_PROCESSING_PREFERENCE_FIELDS);
const emptyPreferences = () => Object.fromEntries(SESSION_POST_PROCESSING_PREFERENCE_FIELDS.map(field => [field, false]));

function sessionObject(session) {
  return session?.session && typeof session.session === 'object' ? session.session : session;
}

export function getPostProcessingPreferenceSessionId(session) {
  const source = sessionObject(session);
  const value = source?._id ?? source?.sessionId ?? source?.id;
  return value == null ? '' : String(value).trim();
}

export function isSessionPostProcessingPreference(field) {
  return preferenceFields.has(field);
}

export function readSessionPostProcessingPreferences(session, targetSessionId = getPostProcessingPreferenceSessionId(session)) {
  const preferences = emptyPreferences();
  const source = sessionObject(session);
  if (getPostProcessingPreferenceSessionId(session) !== String(targetSessionId || '')) return preferences;
  const saved = source?.postProcessingPreferences;
  for (const field of SESSION_POST_PROCESSING_PREFERENCE_FIELDS) {
    if (typeof saved?.[field] === 'boolean') preferences[field] = saved[field];
  }
  return preferences;
}

function staleSessionError() {
  return Object.assign(new Error('The video session changed while saving post-processing preferences.'), {
    code: 'POST_PROCESSING_PREFERENCE_SESSION_CHANGED',
  });
}

/** Serialize preference patches independently from model requests. */
export function createSessionPostProcessingPreferenceController({ sessionId = '', session, persist, onError } = {}) {
  let target = String(sessionId || getPostProcessingPreferenceSessionId(session));
  let preferences = readSessionPostProcessingPreferences(session, target);
  let generation = 0;
  let disposed = false;
  let error = null;
  let inFlight = null;
  let scheduled = false;
  const edited = new Set();
  const pending = new Map();
  const listeners = new Set();
  let snapshot = { sessionId: target, preferences: { ...preferences }, error };
  const notify = () => {
    snapshot = { sessionId: target, preferences: { ...preferences }, error };
    if (!disposed) for (const listener of listeners) listener(snapshot);
  };

  const hydrate = (nextSession) => {
    const source = sessionObject(nextSession);
    if (getPostProcessingPreferenceSessionId(nextSession) !== target ||
        !source?.postProcessingPreferences || typeof source.postProcessingPreferences !== 'object') return;
    const saved = readSessionPostProcessingPreferences(nextSession, target);
    let changed = false;
    for (const field of SESSION_POST_PROCESSING_PREFERENCE_FIELDS) {
      if (!edited.has(field) && preferences[field] !== saved[field]) {
        preferences[field] = saved[field];
        changed = true;
      }
    }
    if (changed) notify();
  };

  const setSession = (nextSessionId, nextSession) => {
    const nextTarget = String(nextSessionId || '');
    if (target !== nextTarget) {
      generation += 1;
      target = nextTarget;
      preferences = readSessionPostProcessingPreferences(nextSession, target);
      edited.clear();
      pending.clear();
      error = null;
      notify();
    } else hydrate(nextSession);
  };

  const run = async () => {
    while (!disposed && pending.size) {
      const writeGeneration = generation;
      const writeSessionId = target;
      const patch = Object.fromEntries(pending);
      pending.clear();
      try {
        await persist(writeSessionId, patch);
      } catch (failure) {
        if (disposed) throw staleSessionError();
        if (writeGeneration !== generation) continue;
        // A newer toggle wins over a failed older value for the same field.
        for (const [field, value] of Object.entries(patch)) {
          if (!pending.has(field)) pending.set(field, value);
        }
        error = failure instanceof Error ? failure : new Error(
          failure?.response?.data?.message || failure?.message || 'Unable to save post-processing preferences.',
          { cause: failure },
        );
        notify();
        try { onError?.(error, { sessionId: writeSessionId }); } catch { /* Error display cannot schedule another write. */ }
        throw error;
      }
      if (!disposed && writeGeneration === generation && error) {
        error = null;
        notify();
      }
    }
  };

  const flush = async () => {
    const requestedGeneration = generation;
    if (disposed) throw staleSessionError();
    if (!inFlight && pending.size) {
      const work = run();
      inFlight = work;
      work.finally(() => { if (inFlight === work) inFlight = null; }).catch(() => {});
    }
    if (inFlight) await inFlight;
    if (disposed || requestedGeneration !== generation) throw staleSessionError();
    return { ...preferences };
  };

  const updatePreference = (field, value) => {
    if (disposed || !target || !preferenceFields.has(field) || typeof value !== 'boolean') return false;
    preferences[field] = value;
    edited.add(field);
    pending.set(field, value);
    error = null;
    notify();
    if (!scheduled) {
      scheduled = true;
      Promise.resolve().then(() => {
        scheduled = false;
        if (!disposed) return flush();
      }).catch(() => {});
    }
    return true;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    setSession,
    hydrate,
    updatePreference,
    flushPreferences: flush,
    activate: () => { disposed = false; },
    dispose: () => { disposed = true; generation += 1; pending.clear(); listeners.clear(); },
  };
}
