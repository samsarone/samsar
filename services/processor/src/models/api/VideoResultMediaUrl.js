import {
  normalizeResponseAssetUrl,
  selectResponseMediaSource,
} from './StatusAPI.js';

export function resolveVideoResultUrl(session = {}, req = null) {
  return normalizeResponseAssetUrl(selectResponseMediaSource({
    local: session.videoLink || session.videoVideoLink,
    remote: session.remoteURL,
  }), req);
}
