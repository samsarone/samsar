export const ELEVENLABS_MUSIC_DEFAULT_DURATION_MS = 10000;
export const ELEVENLABS_MUSIC_DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function removeEmptyValues(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}

function isBackingTrack(payload = {}) {
  return Boolean(
    payload.isBackingTrack ||
    payload.is_backing_track ||
    payload.generationMeta?.isBackingTrack ||
    payload.generationMeta?.is_backing_track
  );
}

export function resolveElevenLabsMusicLengthMs(payload = {}) {
  const requestedMusicLengthMs = Number(payload.generationMeta?.musicLengthMs);
  const requestedDurationSeconds = Number(payload.duration);
  const requestedDurationMusicLengthMs = Number.isFinite(requestedDurationSeconds) && requestedDurationSeconds > 0
    ? Math.round(requestedDurationSeconds * 1000)
    : null;

  if (requestedDurationMusicLengthMs !== null) {
    return requestedDurationMusicLengthMs;
  }

  if (Number.isFinite(requestedMusicLengthMs) && requestedMusicLengthMs > 0) {
    return Math.round(requestedMusicLengthMs);
  }

  return ELEVENLABS_MUSIC_DEFAULT_DURATION_MS;
}

export function buildElevenLabsMusicPrompt(payload = {}) {
  const basePrompt = normalizeString(payload.prompt)
    || 'Create an original cinematic background music track for a video scene.';
  const instrumentalOnly = isBackingTrack(payload) || Boolean(payload.isInstrumental);

  const lyrics = normalizeString(payload.generationMeta?.lyrics);
  if (!lyrics || instrumentalOnly) {
    return basePrompt;
  }

  return `${basePrompt}\n\nUse these lyrics for the vocal performance:\n${lyrics}`;
}

export function buildElevenLabsMusicInput(payload = {}) {
  const instrumentalOnly = isBackingTrack(payload) || Boolean(payload.isInstrumental);
  return removeEmptyValues({
    prompt: buildElevenLabsMusicPrompt(payload),
    music_length_ms: resolveElevenLabsMusicLengthMs(payload),
    force_instrumental: instrumentalOnly,
    output_format: normalizeString(payload.generationMeta?.outputFormat) || ELEVENLABS_MUSIC_DEFAULT_OUTPUT_FORMAT,
    model_id: normalizeString(payload.generationMeta?.modelId || payload.generationMeta?.model_id) || undefined,
  });
}
