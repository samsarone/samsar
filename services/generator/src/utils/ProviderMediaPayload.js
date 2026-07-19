const IMAGE_KEYS = new Set([
  'image', 'imageurl', 'startimage', 'startimageurl', 'endimage', 'endimageurl',
  'firstframe', 'firstframeurl', 'lastframe', 'lastframeurl', 'inputimage',
  'inputimageurl', 'sourceimage', 'sourceimageurl', 'referenceimage',
  'referenceimageurl', 'promptimage', 'promptimageurl', 'mask', 'maskurl',
  'maskimage', 'maskimageurl',
]);
const VIDEO_KEYS = new Set([
  'video', 'videourl', 'videolink', 'startvideo', 'startvideourl', 'inputvideo',
  'inputvideourl', 'sourcevideo', 'sourcevideourl',
]);
const AUDIO_KEYS = new Set([
  'audio', 'audiourl', 'audiolink', 'inputaudio', 'inputaudiourl', 'sourceaudio',
  'sourceaudiourl', 'audiovideoaudiolink',
]);
const IMAGE_LIST_KEYS = new Set([
  'images', 'imageurls', 'inputimages', 'inputimageurls', 'referenceimages',
  'referenceimageurls', 'promptimages',
]);
const VIDEO_LIST_KEYS = new Set(['videos', 'videourls', 'inputvideos', 'inputvideourls']);
const AUDIO_LIST_KEYS = new Set(['audios', 'audiourls', 'inputaudios', 'inputaudiourls']);

function normalizeKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getMediaKindForKey(key) {
  const normalizedKey = normalizeKey(key);
  if (IMAGE_KEYS.has(normalizedKey) || IMAGE_LIST_KEYS.has(normalizedKey)) return 'image';
  if (VIDEO_KEYS.has(normalizedKey) || VIDEO_LIST_KEYS.has(normalizedKey)) return 'video';
  if (AUDIO_KEYS.has(normalizedKey) || AUDIO_LIST_KEYS.has(normalizedKey)) return 'audio';
  return '';
}

function getMediaKindForObject(value, inheritedKind = '') {
  const type = normalizeKey(value?.type || value?.mediaType || value?.media_type || value?.kind);
  if (type.includes('image') || type.includes('frame')) return 'image';
  if (type.includes('video')) return 'video';
  if (type.includes('audio') || type.includes('sound')) return 'audio';
  return inheritedKind;
}

function isTypedMediaReferenceKey(key, mediaKind) {
  return Boolean(mediaKind) && ['url', 'uri', 'src', 'href', 'source'].includes(normalizeKey(key));
}

function isTypedMediaReferenceListKey(key, mediaKind) {
  return Boolean(mediaKind) && ['urls', 'uris', 'sources'].includes(normalizeKey(key));
}

async function normalizeValue(value, key, inheritedKind, normalizeMediaUrl) {
  const keyMediaKind = getMediaKindForKey(key);
  const mediaKind = keyMediaKind || inheritedKind;

  if (typeof value === 'string') {
    if (keyMediaKind || isTypedMediaReferenceKey(key, inheritedKind)) {
      return normalizeMediaUrl(value, { mediaKind: keyMediaKind || inheritedKind });
    }
    return value;
  }

  if (Array.isArray(value)) {
    const listMediaKind = keyMediaKind ||
      (isTypedMediaReferenceListKey(key, inheritedKind) ? inheritedKind : '');
    const result = [];
    for (const item of value) {
      result.push(typeof item === 'string' && listMediaKind
        ? await normalizeMediaUrl(item, { mediaKind: listMediaKind })
        : await normalizeValue(item, '', mediaKind, normalizeMediaUrl));
    }
    return result;
  }

  if (!value || typeof value !== 'object') return value;
  const objectMediaKind = getMediaKindForObject(value, mediaKind);
  const result = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    result[childKey] = await normalizeValue(childValue, childKey, objectMediaKind, normalizeMediaUrl);
  }
  return result;
}

export async function normalizeProviderMediaPayload(payload, normalizeMediaUrl) {
  if (typeof normalizeMediaUrl !== 'function') {
    throw new TypeError('normalizeMediaUrl must be a function.');
  }
  return normalizeValue(payload, '', '', normalizeMediaUrl);
}
