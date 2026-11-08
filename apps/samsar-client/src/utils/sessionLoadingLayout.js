// Presentation hints only: never restore session data, permissions, or generation
// state from this cache. Keep it tab-local, bounded and short-lived.
const STORAGE_KEY = 'sessionLoadingLayouts.v1';
const MAX_AGE = 30 * 60 * 1000;
const VARIANTS = new Set(['init', 'pending', 'completed']);
const RATIOS = new Set(['16:9', '9:16', '1:1']);

export function getSessionLoadingLayout(session) {
  if (!session || typeof session !== 'object') return null;
  const pending = session.videoGenerationPending || session.expressGenerationPending
    || session.expressGenerationPaused || session.isGenerationWaitingForApproval;
  const hasVideo = [session.videoLink, session.video_link, session.remoteURL, session.remoteUrl,
    session.remote_url, session.result_url, session.result?.url, session.result_urls?.[0],
    session.publishedVideoURL, session.published_video_url]
    .some(value => typeof value === 'string' && value.trim());
  return {
    variant: pending ? 'pending' : hasVideo ? 'completed' : 'init',
    aspectRatio: RATIOS.has(session.aspectRatio) ? session.aspectRatio : '16:9',
  };
}

function readEntries() {
  try {
    const entries = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(entries) ? entries.filter(entry => entry
      && typeof entry.id === 'string' && VARIANTS.has(entry.variant)
      && RATIOS.has(entry.aspectRatio) && Number.isFinite(entry.updatedAt)
      && Date.now() - entry.updatedAt >= 0 && Date.now() - entry.updatedAt < MAX_AGE) : [];
  } catch {
    return [];
  }
}

export function readSessionLoadingLayout(sessionId) {
  return readEntries().find(entry => entry.id === String(sessionId || '')) || null;
}

export function rememberSessionLoadingLayout(session, layout = getSessionLoadingLayout(session)) {
  const id = String(session?._id?.$oid || session?._id || session?.id || '');
  if (!id || !layout || !VARIANTS.has(layout.variant)) return;
  try {
    const entries = readEntries().filter(entry => entry.id !== id);
    entries.push({ id, variant: layout.variant, aspectRatio: RATIOS.has(layout.aspectRatio) ? layout.aspectRatio : '16:9', updatedAt: Date.now() });
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-24)));
  } catch {
    // Storage limits must not interrupt loading the real page.
  }
}
