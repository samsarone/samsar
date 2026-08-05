export const TEMPORARILY_DISABLED_VIDEO_MODEL_KEYS = Object.freeze([]);

const TEMPORARILY_DISABLED_VIDEO_MODELS = new Set(
  TEMPORARILY_DISABLED_VIDEO_MODEL_KEYS,
);

export function isVideoModelTemporarilyDisabled(modelKey) {
  const normalizedModelKey = typeof modelKey === 'string'
    ? modelKey.trim().toUpperCase()
    : '';
  return TEMPORARILY_DISABLED_VIDEO_MODELS.has(normalizedModelKey);
}

export function assertVideoModelEnabled(modelKey) {
  if (!isVideoModelTemporarilyDisabled(modelKey)) {
    return;
  }

  const error = new Error(`${String(modelKey).trim()} is temporarily unavailable.`);
  error.status = 400;
  error.code = 'VIDEO_MODEL_TEMPORARILY_DISABLED';
  throw error;
}
