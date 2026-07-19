const IMAGE_MEDIA_KEYS = new Set([
  'image',
  'imageurl',
  'startimage',
  'startimageurl',
  'endimage',
  'endimageurl',
  'firstframe',
  'firstframeurl',
  'lastframe',
  'lastframeurl',
  'inputimage',
  'inputimageurl',
  'sourceimage',
  'sourceimageurl',
  'referenceimage',
  'referenceimageurl',
  'promptimage',
  'promptimageurl',
  'mask',
  'maskimage',
  'maskimageurl',
  'maskurl',
]);

const VIDEO_MEDIA_KEYS = new Set([
  'video',
  'videourl',
  'videolink',
  'startvideo',
  'startvideourl',
  'inputvideo',
  'inputvideourl',
  'sourcevideo',
  'sourcevideourl',
]);

const AUDIO_MEDIA_KEYS = new Set([
  'audio',
  'audiourl',
  'audiolink',
  'inputaudio',
  'inputaudiourl',
  'sourceaudio',
  'sourceaudiourl',
  'audiovideoaudiolink',
]);

const IMAGE_MEDIA_LIST_KEYS = new Set([
  'images',
  'imageurls',
  'inputimages',
  'inputimageurls',
  'referenceimages',
  'referenceimageurls',
  'promptimages',
]);
const VIDEO_MEDIA_LIST_KEYS = new Set(['videos', 'videourls', 'inputvideos', 'inputvideourls']);
const AUDIO_MEDIA_LIST_KEYS = new Set(['audios', 'audiourls', 'inputaudios', 'inputaudiourls']);

function normalizeKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getMediaKindForKey(key) {
  const normalizedKey = normalizeKey(key);
  if (IMAGE_MEDIA_KEYS.has(normalizedKey) || IMAGE_MEDIA_LIST_KEYS.has(normalizedKey)) return 'image';
  if (VIDEO_MEDIA_KEYS.has(normalizedKey) || VIDEO_MEDIA_LIST_KEYS.has(normalizedKey)) return 'video';
  if (AUDIO_MEDIA_KEYS.has(normalizedKey) || AUDIO_MEDIA_LIST_KEYS.has(normalizedKey)) return 'audio';
  return '';
}

function getMediaKindForObject(value, inheritedKind = '') {
  const type = normalizeKey(value?.type || value?.mediaType || value?.media_type || value?.kind);
  if (type.includes('image') || type.includes('frame')) return 'image';
  if (type.includes('video')) return 'video';
  if (type.includes('audio') || type.includes('sound')) return 'audio';
  return inheritedKind;
}

function isUrlKeyForTypedMedia(key, mediaKind) {
  return Boolean(mediaKind) && ['url', 'uri', 'src', 'href', 'source'].includes(normalizeKey(key));
}

function isUrlListKeyForTypedMedia(key, mediaKind) {
  return Boolean(mediaKind) && ['urls', 'uris', 'sources'].includes(normalizeKey(key));
}

async function normalizeValue(value, key, inheritedKind, normalizeMediaUrl) {
  const keyMediaKind = getMediaKindForKey(key);
  const mediaKind = keyMediaKind || inheritedKind;

  if (typeof value === 'string') {
    if (keyMediaKind || isUrlKeyForTypedMedia(key, inheritedKind)) {
      return normalizeMediaUrl(value, { mediaKind: keyMediaKind || inheritedKind });
    }
    return value;
  }

  if (Array.isArray(value)) {
    const listMediaKind = keyMediaKind || (isUrlListKeyForTypedMedia(key, inheritedKind) ? inheritedKind : '');
    const normalizedItems = [];
    for (const item of value) {
      if (typeof item === 'string' && listMediaKind) {
        normalizedItems.push(await normalizeMediaUrl(item, { mediaKind: listMediaKind }));
      } else {
        normalizedItems.push(await normalizeValue(item, '', mediaKind, normalizeMediaUrl));
      }
    }
    return normalizedItems;
  }

  if (!value || typeof value !== 'object') return value;

  const objectMediaKind = getMediaKindForObject(value, mediaKind);
  const normalizedObject = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    normalizedObject[childKey] = await normalizeValue(
      childValue,
      childKey,
      objectMediaKind,
      normalizeMediaUrl,
    );
  }
  return normalizedObject;
}

/**
 * Clones a provider-bound payload while refreshing every explicitly typed
 * image, video, and audio input. Unknown strings and retry-candidate metadata
 * are intentionally left untouched until they become selected provider input.
 */
export async function normalizeProviderMediaPayload(payload, normalizeMediaUrl) {
  if (typeof normalizeMediaUrl !== 'function') {
    throw new TypeError('normalizeMediaUrl must be a function.');
  }
  const source = typeof payload?.toObject === 'function' ? payload.toObject() : payload;
  return normalizeValue(source, '', '', normalizeMediaUrl);
}
