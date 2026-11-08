import { getRenderableImageUrl } from '../../../utils/image.jsx';
import { resolveStudioLayerVideo } from './studioVideoLayers.mjs';

export const STUDIO_PENDING_EDIT_KEY = 'advancedVideoEditPendingSession';

// Only a handoff created by Studio's Express edits may display the source render.
// Store media separately: it must never become a layer or render URL of the new session.
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

export function hasStudioPreviewMedia(session, processorApiUrl, staticCdnUrl) {
  const layers = Array.isArray(session?.layers) ? session.layers : [];
  return layers.some(layer => {
    if (resolveStudioLayerVideo(layer, session, { processorApiUrl, staticCdnUrl }).url) return true;
    const images = Array.isArray(layer?.imageSession?.activeItemList) ? layer.imageSession.activeItemList : [];
    return images.some(item => {
      if (item?.type !== 'image' || item.isHidden) return false;
      // Blank/draft image items can contain a display label in `image`, not a URL.
      const source = [item.previewUrl, item.preview_url, item.signedUrl, item.signed_url,
        item.displayUrl, item.display_url, item.url, item.imageUrl, item.image_url, item.src, item.image]
        .find(value => typeof value === 'string' && value.trim());
      return source && (/^(https?:|data:|blob:)/i.test(source) || source.includes('/'))
        && Boolean(getRenderableImageUrl(item, processorApiUrl));
    });
  });
}
