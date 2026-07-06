const OUTRO_CTA_IMAGE_PAYLOAD_KEYS = [
  'outro_cta_image',
  'outroCtaImage',
  'cta_image',
  'ctaImage',
];

const OUTRO_CTA_IMAGE_SOURCE_KEYS = [
  'url',
  'image_url',
  'imageUrl',
  'public_url',
  'publicUrl',
  'source_url',
  'sourceUrl',
  'source',
  'src',
  'image',
  'middle_image_url',
  'middleImageUrl',
  'center_image_url',
  'centerImageUrl',
  'data_url',
  'dataUrl',
  'image_data',
  'imageData',
  'data',
];

const OUTRO_CTA_IMAGE_MIME_TYPE_KEYS = [
  'mime_type',
  'mimeType',
  'content_type',
  'contentType',
];

const OUTRO_CTA_IMAGE_MIDDLE_KEYS = [
  'middle_image',
  'middleImage',
  'center_image',
  'centerImage',
  'middle',
  'center',
];

const OUTRO_CTA_IMAGE_TOP_TEXT_KEYS = [
  'top_text',
  'topText',
  'cta_text_top',
  'ctaTextTop',
  'outro_cta_text_top',
  'outroCtaTextTop',
];

const OUTRO_CTA_IMAGE_BOTTOM_TEXT_KEYS = [
  'bottom_text',
  'bottomText',
  'cta_text_bottom',
  'ctaTextBottom',
  'outro_cta_text_bottom',
  'outroCtaTextBottom',
];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isImageDataUrl(value) {
  return typeof value === 'string' && /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(value.trim());
}

function firstPayloadValue(payload = {}, keys = []) {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) {
      continue;
    }
    const value = payload[key];
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}

function normalizeBase64ImagePayload(value, mimeType) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || isImageDataUrl(trimmed)) {
    return trimmed || null;
  }

  const normalizedMimeType = typeof mimeType === 'string' ? mimeType.trim().toLowerCase() : '';
  if (!/^image\/[a-zA-Z0-9.+-]+$/.test(normalizedMimeType)) {
    return null;
  }

  const normalizedBase64 = trimmed.replace(/^base64,/i, '').replace(/\s+/g, '');
  if (!/^[a-zA-Z0-9+/]+={0,2}$/.test(normalizedBase64)) {
    return null;
  }

  return `data:${normalizedMimeType};base64,${normalizedBase64}`;
}

function normalizeOptionalTextPayloadValue(value, fieldName) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    const error = new Error(`${fieldName} must be a string when provided.`);
    error.status = 400;
    throw error;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

export function getOutroCtaImagePayloadValue(payload = {}) {
  return firstPayloadValue(payload, OUTRO_CTA_IMAGE_PAYLOAD_KEYS);
}

export function normalizeOutroCtaImagePayload(value, {
  fieldName = 'outro_cta_image',
} = {}) {
  if (value === undefined || value === null) {
    return null;
  }

  let rawSource;
  let rawMimeType;

  if (typeof value === 'string') {
    rawSource = value;
  } else if (isPlainObject(value)) {
    const middleImage = firstPayloadValue(value, OUTRO_CTA_IMAGE_MIDDLE_KEYS);
    const imagePayload = middleImage === undefined ? value : middleImage;

    if (typeof imagePayload === 'string') {
      rawSource = imagePayload;
    } else if (isPlainObject(imagePayload)) {
      rawSource = firstPayloadValue(imagePayload, OUTRO_CTA_IMAGE_SOURCE_KEYS);
      rawMimeType = firstPayloadValue(imagePayload, OUTRO_CTA_IMAGE_MIME_TYPE_KEYS);
    } else if (imagePayload !== undefined && imagePayload !== null) {
      const error = new Error(`${fieldName}.middle_image must be a string or an object with url/image_url/data_url/image_data.`);
      error.status = 400;
      throw error;
    }
  } else {
    const error = new Error(`${fieldName} must be an object with url/image_url/data_url/image_data.`);
    error.status = 400;
    throw error;
  }

  if (rawSource === undefined || rawSource === null) {
    const error = new Error(`${fieldName} must include url, image_url, data_url, or image_data.`);
    error.status = 400;
    throw error;
  }

  if (typeof rawSource !== 'string') {
    const error = new Error(`${fieldName} image source must be a string.`);
    error.status = 400;
    throw error;
  }

  const trimmedSource = rawSource.trim();
  const source = normalizeBase64ImagePayload(trimmedSource, rawMimeType) || trimmedSource;
  if (!source) {
    const error = new Error(`${fieldName} image source must be non-empty.`);
    error.status = 400;
    throw error;
  }

  if (!isHttpUrl(source) && !isImageDataUrl(source)) {
    const error = new Error(`${fieldName} image source must be an http(s) URL or image data URL.`);
    error.status = 400;
    throw error;
  }

  return {
    source,
    sourceType: isHttpUrl(source) ? 'url' : 'data_url',
  };
}

export function normalizeOutroCtaImageTextFields(value, {
  fieldName = 'outro_cta_image',
} = {}) {
  if (value === undefined || value === null || typeof value === 'string') {
    return {
      ctaTextTop: null,
      ctaTextBottom: null,
    };
  }

  if (!isPlainObject(value)) {
    return {
      ctaTextTop: null,
      ctaTextBottom: null,
    };
  }

  return {
    ctaTextTop: normalizeOptionalTextPayloadValue(
      firstPayloadValue(value, OUTRO_CTA_IMAGE_TOP_TEXT_KEYS),
      `${fieldName}.top_text`,
    ),
    ctaTextBottom: normalizeOptionalTextPayloadValue(
      firstPayloadValue(value, OUTRO_CTA_IMAGE_BOTTOM_TEXT_KEYS),
      `${fieldName}.bottom_text`,
    ),
  };
}

export function normalizeOutroCtaImageFromPayload(payload = {}, options = {}) {
  return normalizeOutroCtaImagePayload(getOutroCtaImagePayloadValue(payload), options);
}

export function normalizeOutroCtaImageTextFieldsFromPayload(payload = {}, options = {}) {
  return normalizeOutroCtaImageTextFields(getOutroCtaImagePayloadValue(payload), options);
}
