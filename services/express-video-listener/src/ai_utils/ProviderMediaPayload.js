const MEDIA_KEYS_BY_KIND = Object.freeze({
  image: new Set([
    'image', 'imageurl', 'images', 'imageurls', 'inputimage', 'inputimageurl',
    'inputimages', 'inputimageurls', 'referenceimage', 'referenceimageurl',
    'referenceimages', 'referenceimageurls', 'promptimage', 'promptimageurl',
    'promptimages', 'startimage', 'startimageurl', 'endimage', 'endimageurl',
    'firstframe', 'firstframeurl', 'lastframe', 'lastframeurl', 'mask',
    'maskimage', 'maskimageurl', 'maskurl',
  ]),
  video: new Set([
    'video', 'videourl', 'videolink', 'videos', 'videourls', 'inputvideo',
    'inputvideourl', 'inputvideos', 'inputvideourls', 'sourcevideo',
    'sourcevideourl', 'startvideo', 'startvideourl',
  ]),
  audio: new Set([
    'audio', 'audiourl', 'audiolink', 'audios', 'audiourls', 'inputaudio',
    'inputaudiourl', 'inputaudios', 'inputaudiourls', 'sourceaudio',
    'sourceaudiourl', 'audiovideoaudiolink',
  ]),
});

function normalizeKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getMediaKindForKey(key) {
  const normalizedKey = normalizeKey(key);
  return Object.entries(MEDIA_KEYS_BY_KIND)
    .find(([, keys]) => keys.has(normalizedKey))?.[0] || '';
}

function getObjectMediaKind(value, inheritedKind = '') {
  const type = normalizeKey(value?.type || value?.mediaType || value?.media_type || value?.kind);
  if (type.includes('image') || type.includes('frame')) return 'image';
  if (type.includes('video')) return 'video';
  if (type.includes('audio') || type.includes('sound')) return 'audio';
  return inheritedKind;
}

async function normalizeValue(value, key, inheritedKind, resolveMediaUrl) {
  const keyMediaKind = getMediaKindForKey(key);
  const mediaKind = keyMediaKind || inheritedKind;
  const normalizedKey = normalizeKey(key);
  if (typeof value === 'string') {
    if (keyMediaKind || (inheritedKind && ['url', 'uri', 'src', 'href', 'source'].includes(normalizedKey))) {
      return resolveMediaUrl(value, { mediaKind });
    }
    return value;
  }
  if (Array.isArray(value)) {
    const listMediaKind = keyMediaKind ||
      (inheritedKind && ['urls', 'uris', 'sources'].includes(normalizedKey) ? inheritedKind : '');
    return Promise.all(value.map((item) => (
      typeof item === 'string' && listMediaKind
        ? resolveMediaUrl(item, { mediaKind: listMediaKind })
        : normalizeValue(item, '', mediaKind, resolveMediaUrl)
    )));
  }
  if (!value || typeof value !== 'object') return value;

  const objectMediaKind = getObjectMediaKind(value, mediaKind);
  const result = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    result[childKey] = await normalizeValue(
      childValue,
      childKey,
      objectMediaKind,
      resolveMediaUrl,
    );
  }
  return result;
}

export async function normalizeProviderMediaPayload(payload, resolveMediaUrl) {
  if (typeof resolveMediaUrl !== 'function') {
    throw new TypeError('resolveMediaUrl must be a function.');
  }
  const source = typeof payload?.toObject === 'function' ? payload.toObject() : payload;
  return normalizeValue(source, '', '', resolveMediaUrl);
}
