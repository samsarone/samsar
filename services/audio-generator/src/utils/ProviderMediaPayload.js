import { getAccessibleProviderMediaUrl } from './ProviderMediaUrl.js';

const MEDIA_KINDS = new Set(['image', 'video', 'audio']);
const GENERIC_REFERENCE_KEYS = new Set(['href', 'src', 'source', 'sources', 'uri', 'uris', 'url', 'urls']);

function normalizeString(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeToken(value) {
  return typeof value === 'string'
    ? value.trim().replace(/([a-z\d])([A-Z])/g, '$1_$2').toLowerCase().replace(/-/g, '_')
    : '';
}

function inferMediaKindFromType(value) {
  const type = normalizeToken(value);
  if (!type) return '';
  if (/(^|_)image($|_)/.test(type)) return 'image';
  if (/(^|_)video($|_)/.test(type)) return 'video';
  if (/(^|_)audio($|_)/.test(type)) return 'audio';
  return '';
}

function inferMediaKindFromKey(value) {
  const key = normalizeToken(value);
  if (!key) return '';
  if (/^(input_)?images?(_urls?|_uris?|_sources?)?$/.test(key)) return 'image';
  if (/^(input_)?videos?(_urls?|_uris?|_sources?)?$/.test(key)) return 'video';
  if (/^(input_)?audios?(_urls?|_uris?|_sources?)?$/.test(key)) return 'audio';
  return '';
}

function isGenericReferenceKey(value) {
  return GENERIC_REFERENCE_KEYS.has(normalizeString(value));
}

/**
 * Clone a provider payload while resolving every typed media reference. The
 * type context follows nested source/url objects and all list aliases, but an
 * unrelated generic URL is left untouched.
 */
export async function normalizeProviderMediaPayload(
  payload,
  resolver = getAccessibleProviderMediaUrl,
  options = {},
) {
  if (typeof resolver !== 'function') {
    throw new TypeError('resolver must be a function.');
  }
  const seen = new WeakMap();

  async function visit(value, inheritedMediaKind = '') {
    if (typeof value === 'string') {
      return MEDIA_KINDS.has(inheritedMediaKind)
        ? resolver(value, { ...options, mediaKind: inheritedMediaKind })
        : value;
    }
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) return seen.get(value);

    if (Array.isArray(value)) {
      const result = [];
      seen.set(value, result);
      for (const item of value) {
        result.push(await visit(item, inheritedMediaKind));
      }
      return result;
    }

    const objectMediaKind = inferMediaKindFromType(value.type) || inheritedMediaKind;
    const result = {};
    seen.set(value, result);
    for (const [key, child] of Object.entries(value)) {
      const explicitMediaKind = inferMediaKindFromKey(key);
      const childMediaKind = explicitMediaKind ||
        (isGenericReferenceKey(key) ? objectMediaKind : '');
      result[key] = await visit(child, childMediaKind);
    }
    return result;
  }

  return visit(payload);
}
