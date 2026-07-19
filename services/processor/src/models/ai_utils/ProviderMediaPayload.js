import { getAccessibleProviderMediaUrl } from './VisionMediaUrl.js';

const MEDIA_REFERENCE_FIELDS = Object.freeze({
  image: Object.freeze(['image_url', 'imageUrl', 'input_image', 'image']),
  video: Object.freeze(['video_url', 'videoUrl', 'input_video', 'video']),
  audio: Object.freeze(['audio_url', 'audioUrl', 'input_audio', 'audio']),
});
const MEDIA_REFERENCE_LIST_FIELDS = Object.freeze({
  image: Object.freeze(['image_urls', 'imageUrls']),
  video: Object.freeze(['video_urls', 'videoUrls']),
  audio: Object.freeze(['audio_urls', 'audioUrls']),
});
const COMMON_MEDIA_REFERENCE_FIELDS = Object.freeze(['url', 'uri', 'source', 'src', 'href']);
const COMMON_MEDIA_REFERENCE_LIST_FIELDS = Object.freeze(['urls', 'uris', 'sources']);

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function getTypedMediaKind(value) {
  const type = normalizeString(value).toLowerCase().replace(/[\s-]+/g, '_');
  const match = type.match(/(?:^|_)(image|video|audio)(?:_|$)/);
  return match?.[1] || '';
}

function getNestedReferencePaths(value, mediaKind, basePath, depth = 0) {
  if (typeof value === 'string' && value.trim()) {
    return [{ path: basePath, source: value.trim() }];
  }
  if (Array.isArray(value) && depth < 3) {
    return value.flatMap((entry, index) => getNestedReferencePaths(
      entry,
      mediaKind,
      [...basePath, index],
      depth + 1,
    ));
  }
  if (!isPlainObject(value) || depth >= 3) {
    return [];
  }

  const fields = [
    ...MEDIA_REFERENCE_FIELDS[mediaKind],
    ...MEDIA_REFERENCE_LIST_FIELDS[mediaKind],
    ...COMMON_MEDIA_REFERENCE_FIELDS,
    ...COMMON_MEDIA_REFERENCE_LIST_FIELDS,
  ];
  const references = [];
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      continue;
    }
    references.push(...getNestedReferencePaths(
      value[field],
      mediaKind,
      [...basePath, field],
      depth + 1,
    ));
  }
  return references;
}

function getTypedMediaReferences(value, mediaKind) {
  const fields = [
    ...MEDIA_REFERENCE_FIELDS[mediaKind],
    ...MEDIA_REFERENCE_LIST_FIELDS[mediaKind],
    ...COMMON_MEDIA_REFERENCE_FIELDS,
    ...COMMON_MEDIA_REFERENCE_LIST_FIELDS,
  ];
  const references = [];
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      continue;
    }
    references.push(...getNestedReferencePaths(value[field], mediaKind, [field]));
  }
  return references;
}

function setPathValue(target, path, value) {
  let cursor = target;
  for (let index = 0; index < path.length - 1; index += 1) {
    cursor = cursor[path[index]];
  }
  cursor[path[path.length - 1]] = value;
}

/**
 * Clone a provider request payload and resolve URL-backed typed media parts.
 * Only objects whose `type` identifies image, video, or audio content are
 * interpreted as media, so ordinary URLs in text, metadata, and tool payloads
 * remain untouched. Inline data and public provider URLs are delegated to the
 * canonical media resolver, which preserves them without rewriting.
 */
export async function resolveProviderMediaPayload(payload, options = {}) {
  const resolveMediaUrl = typeof options.resolveMediaUrl === 'function'
    ? options.resolveMediaUrl
    : getAccessibleProviderMediaUrl;
  const serviceName = normalizeString(options.serviceName) || 'samsar_processor_provider_payload';
  const seen = new WeakMap();

  async function cloneAndResolve(value) {
    if (Array.isArray(value)) {
      if (seen.has(value)) {
        return seen.get(value);
      }
      const clone = [];
      seen.set(value, clone);
      for (const item of value) {
        clone.push(await cloneAndResolve(item));
      }
      return clone;
    }

    if (!isPlainObject(value)) {
      return value;
    }
    if (seen.has(value)) {
      return seen.get(value);
    }

    const clone = Object.create(Object.getPrototypeOf(value));
    seen.set(value, clone);
    for (const [key, entry] of Object.entries(value)) {
      clone[key] = await cloneAndResolve(entry);
    }

    const mediaKind = getTypedMediaKind(clone.type);
    if (!mediaKind) {
      return clone;
    }
    const references = getTypedMediaReferences(clone, mediaKind);
    if (!references.length) {
      return clone;
    }

    for (const reference of references) {
      const resolvedUrl = await resolveMediaUrl(reference.source, {
        mediaKind,
        serviceName,
      });
      setPathValue(clone, reference.path, resolvedUrl);
    }
    return clone;
  }

  return cloneAndResolve(payload);
}
