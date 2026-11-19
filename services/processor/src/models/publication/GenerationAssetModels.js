import GeneratedImage from '../../schema/generations/GeneratedImage.js';
import GeneratedAIVideo from '../../schema/generations/GeneratedAIVideo.js';

const normalizeString = (value) => typeof value === 'string' ? value.trim() : '';
const unique = (values) => [...new Set(values.filter(Boolean))];
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Compare complete asset paths, never filenames: different generations can use
// the same filename. Delivery hosts, asset-root prefixes and signed queries do
// not change an asset's identity within the source session.
function assetPath(value) {
  const reference = normalizeString(value);
  if (!reference || /^(?:data|blob):/i.test(reference)) return '';
  let pathname;
  try {
    pathname = /^https?:\/\//i.test(reference)
      ? new URL(reference).pathname
      : reference.split(/[?#]/)[0];
    pathname = decodeURIComponent(pathname);
  } catch {
    return '';
  }
  const normalized = pathname.replace(/^\/+/, '').replace(/^(?:assets_v2|assets)\//, '');
  if (!normalized || normalized.split('/').some((part) => part === '..' || part === '.') || /[\\\0]/.test(normalized)) return '';
  return normalized;
}

function selectedAssetPaths(session) {
  const image = [];
  const video = [];
  const layers = [
    ...(Array.isArray(session.layers) ? session.layers : []),
    ...(Array.isArray(session.branchRenderPaths) ? session.branchRenderPaths : [])
      .flatMap((branch) => Array.isArray(branch?.timeline) ? branch.timeline : []),
  ];
  for (const layer of layers) {
    const imageSession = layer?.imageSession;
    if (Array.isArray(imageSession?.activeItemList)) {
      for (const item of imageSession.activeItemList) {
        if (item?.type !== 'image' || item.hidden === true || item.isHidden === true) continue;
        image.push(item.src, item.remoteSrc, item.originalSrc, item.originalRemoteSrc);
      }
    } else {
      image.push(imageSession?.activeSelectedImage, imageSession?.activeEditedImage,
        imageSession?.activeGeneratedImage, imageSession?.activeImageRemoteLink);
    }
    video.push(layer?.aiVideoLayer, layer?.aiVideoRemoteLink,
      layer?.lipSyncVideoLayer, layer?.lipSyncRemoteLink,
      layer?.soundEffectVideoLayer, layer?.soundEffectRemoteLink);
  }
  return { image: unique(image.map(assetPath)), video: unique(video.map(assetPath)) };
}

function assetReferenceMatcher(pathname) {
  // Generated asset records store relative paths while layer selections often
  // store absolute delivery URLs. Exact path matching keeps both forms useful.
  const encodedPath = [...pathname].map((character) => {
    const encoded = character === '/' ? character : encodeURIComponent(character);
    return encoded === character ? escapeRegExp(character)
      : `(?:${escapeRegExp(character)}|${escapeRegExp(encoded)})`;
  }).join('');
  return new RegExp(`^(?:https?://[^/?#]+/|/)?(?:assets_v2/|assets/)?${encodedPath}(?:[?#].*)?$`, 'i');
}

async function matchingModels(model, sessionId, paths, fields) {
  if (!paths.length) return [];
  const matchers = paths.map(assetReferenceMatcher);
  const query = { sessionId, $or: fields.map((field) => ({ [field]: { $in: matchers } })) };
  const rows = await model.find(query).select({ model: 1, ...Object.fromEntries(fields.map((field) => [field, 1])) }).lean();
  const selected = new Set(paths);
  return unique(rows
    .filter((row) => fields.some((field) => selected.has(assetPath(row[field]))))
    .map((row) => normalizeString(row.model)));
}

/** Models attached to accepted current assets, excluding generation history.
 * Session scoping prevents another session's similarly named asset from being
 * attributed to this publication. Missing records are left for the caller's
 * explicitly labelled session-settings fallback.
 */
export async function loadPublicationGenerationAssetModels(session = {}, dependencies = {}) {
  const sessionId = normalizeString(session._id?.toString?.() || session.id);
  if (!sessionId) return { image: [], video: [] };
  const selected = selectedAssetPaths(session);
  const [image, video] = await Promise.all([
    matchingModels(dependencies.generatedImageModel || GeneratedImage, sessionId, selected.image, ['url']),
    matchingModels(dependencies.generatedVideoModel || GeneratedAIVideo, sessionId, selected.video, ['url', 'remoteUrl']),
  ]);
  return { image, video };
}
