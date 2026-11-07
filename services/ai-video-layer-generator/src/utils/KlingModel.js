// Current public Kling model keys. Retain old names only as request aliases.
export const KLING_V4_IMAGE_MODEL = 'KLINGIMGTOVID4';
export const KLING_V4_TEXT_MODEL = 'KLINGTXTTOVID4';
export const KLING_V4_DURATION_SECONDS = Object.freeze([5, 10, 15, 20, 25, 30]);
export const KLING_V4_RESOLUTION = '720p';
export const KLING_V4_STUDIO_CREDITS_PER_SECOND = 18.84;

const LEGACY_KLING_MODEL_ALIASES = Object.freeze({
  KLINGIMGTOVID3PRO: KLING_V4_IMAGE_MODEL,
  KLINGIMGTOVIDTURBO: KLING_V4_IMAGE_MODEL,
  KLINGTXTTOVID3PRO: KLING_V4_TEXT_MODEL,
  KLINGTXTTOVIDTURBO: KLING_V4_TEXT_MODEL,
});

export function normalizeKlingModelKey(model) {
  const key = typeof model === 'string' ? model.trim().toUpperCase() : model;
  return LEGACY_KLING_MODEL_ALIASES[key] || key;
}

export function isKlingV4Model(model) {
  return model === KLING_V4_IMAGE_MODEL || model === KLING_V4_TEXT_MODEL;
}

export function validateKlingV4Duration(value = 5) {
  const duration = Number(value);
  if (!KLING_V4_DURATION_SECONDS.includes(duration)) {
    throw Object.assign(new Error('Kling 4 duration must be 5, 10, 15, 20, 25, or 30 seconds.'),
      { status: 400, code: 'KLING_V4_INVALID_DURATION' });
  }
  return duration;
}
