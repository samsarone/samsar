export const STUDIO_PENDING_EDIT_KEY = 'advancedVideoEditPendingSession';

// Scope preparation polling to the target session and the user who requested it.
export function readStudioPostProcessingHandoff(sessionId, userId, storage = globalThis.sessionStorage, now = Date.now()) {
  try {
    const handoff = JSON.parse(storage?.getItem(STUDIO_PENDING_EDIT_KEY) || 'null');
    const age = now - Number(handoff?.startedAt);
    return handoff?.origin === 'studio-express-post-processing'
      && handoff.sessionId === sessionId && userId && handoff.userId === userId
      && handoff.sourceSessionId && handoff.sourceSessionId !== sessionId
      && Number.isFinite(age) && age >= 0 && age < 10 * 60 * 1000
      ? handoff : null;
  } catch { return null; }
}
