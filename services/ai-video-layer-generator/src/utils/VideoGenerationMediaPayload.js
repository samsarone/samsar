const LIP_SYNC_MODELS = new Set([
  'SYNCLIPSYNC',
  'LATENTSYNC',
  'KLINGLIPSYNC',
  'HUMMINGBIRDLIPSYNC',
  'CREATIFYLIPSYNC',
]);

const TEXT_TO_VIDEO_MODELS = new Set([
  'SEEDANCE2.0T2V',
  'SEEDANCET2V',
  'VEO',
  'VEO3.1',
  'VEO3.1FAST',
]);

const SOUND_EFFECT_MODELS = new Set(['MMAUDIOV2', 'MIRELOAI']);
const END_IMAGE_MODELS = new Set([
  'SEEDANCEI2V',
  'SEEDANCE2.0I2V',
  'VEO3.1FLIV',
  'CUSTOM_IMAGE_TO_VIDEO',
]);

const START_IMAGE_KEYS = [
  'startImage',
  'startImageUrl',
  'start_image',
  'start_image_url',
  'image',
  'imageUrl',
  'imageURL',
  'image_url',
];
const END_IMAGE_KEYS = [
  'endImage',
  'endImageUrl',
  'end_image',
  'end_image_url',
  'lastFrame',
  'lastFrameUrl',
  'last_frame',
  'last_frame_url',
];
const VIDEO_KEYS = ['video', 'videoUrl', 'video_url', 'videoLink'];
const AUDIO_KEYS = ['audio', 'audioUrl', 'audio_url', 'audioLink', 'audioVideoAudioLink'];

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function normalizePresentFields(payload, keys, mediaKind, normalizeMediaUrl) {
  for (const key of keys) {
    if (typeof payload[key] === 'string' && payload[key].trim()) {
      payload[key] = await normalizeMediaUrl(payload[key], { mediaKind });
    }
  }
}

/**
 * Refresh only media that the selected video adapter will actually put in its
 * public provider request. The database job may contain historical or fallback
 * media fields; resolving the whole document would create tunnels for assets
 * that are never sent to the provider.
 */
export async function normalizeSelectedVideoGenerationMediaPayload(
  inputPayload,
  normalizeMediaUrl,
) {
  if (typeof normalizeMediaUrl !== 'function') {
    throw new TypeError('normalizeMediaUrl must be a function.');
  }

  const source = typeof inputPayload?.toObject === 'function'
    ? inputPayload.toObject()
    : inputPayload;
  const payload = { ...(source || {}) };
  const model = normalizeString(payload.model).toUpperCase();
  const generationType = normalizeString(
    payload.generationType || payload.layerAiVideoType,
  ).toLowerCase();

  if (LIP_SYNC_MODELS.has(model) || generationType === 'lip_sync') {
    await normalizePresentFields(payload, VIDEO_KEYS, 'video', normalizeMediaUrl);
    await normalizePresentFields(payload, AUDIO_KEYS, 'audio', normalizeMediaUrl);
    return payload;
  }

  if (
    SOUND_EFFECT_MODELS.has(model) ||
    generationType === 'sound_effect' ||
    generationType === 'text_to_sound_effect'
  ) {
    await normalizePresentFields(payload, VIDEO_KEYS, 'video', normalizeMediaUrl);
    return payload;
  }

  if (TEXT_TO_VIDEO_MODELS.has(model)) {
    return payload;
  }

  await normalizePresentFields(payload, START_IMAGE_KEYS, 'image', normalizeMediaUrl);
  if (END_IMAGE_MODELS.has(model)) {
    await normalizePresentFields(payload, END_IMAGE_KEYS, 'image', normalizeMediaUrl);
  }
  return payload;
}
