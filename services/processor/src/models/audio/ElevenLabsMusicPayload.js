export const ELEVENLABS_MUSIC_MODEL = 'ELEVENLABS_MUSIC';
export const ELEVENLABS_MUSIC_DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128';

function resolveElevenLabsMusicLengthMs({
  requestedMusicLengthMs,
  requestedDurationSeconds,
} = {}) {
  const requestedDurationMusicLengthMs = Number.isFinite(requestedDurationSeconds) && requestedDurationSeconds > 0
    ? Math.round(requestedDurationSeconds * 1000)
    : null;

  if (requestedDurationMusicLengthMs !== null) {
    return requestedDurationMusicLengthMs;
  }

  if (Number.isFinite(requestedMusicLengthMs) && requestedMusicLengthMs > 0) {
    return Math.round(requestedMusicLengthMs);
  }

  return 10000;
}

export function normalizeElevenLabsMusicPayload(payload = {}) {
  if (payload.model !== ELEVENLABS_MUSIC_MODEL) {
    return payload;
  }

  const currentGenerationMeta = payload.generationMeta && typeof payload.generationMeta === 'object'
    ? payload.generationMeta
    : {};

  const requestedDurationSeconds = Number(payload.duration);
  const requestedMusicLengthMs = Number(currentGenerationMeta.musicLengthMs);
  const isBackingTrack = Boolean(payload.isBackingTrack || currentGenerationMeta.isBackingTrack);
  const musicLengthMs = resolveElevenLabsMusicLengthMs({
    requestedMusicLengthMs,
    requestedDurationSeconds,
  });

  const normalizedLyrics = typeof payload.lyrics === 'string'
    ? payload.lyrics.trim()
    : typeof currentGenerationMeta.lyrics === 'string'
      ? currentGenerationMeta.lyrics.trim()
      : '';
  const normalizedIsInstrumental = isBackingTrack || Boolean(payload.isInstrumental);
  const normalizedDuration = isBackingTrack
    ? (
        Number.isFinite(requestedDurationSeconds) && requestedDurationSeconds > 0
          ? requestedDurationSeconds
          : musicLengthMs / 1000
      )
    : musicLengthMs / 1000;

  return {
    ...payload,
    duration: normalizedDuration,
    isInstrumental: normalizedIsInstrumental,
    isBackingTrack,
    generationMeta: {
      ...currentGenerationMeta,
      providerKey: ELEVENLABS_MUSIC_MODEL,
      musicLengthMs,
      forceInstrumental: normalizedIsInstrumental,
      outputFormat: currentGenerationMeta.outputFormat || ELEVENLABS_MUSIC_DEFAULT_OUTPUT_FORMAT,
      ...(isBackingTrack
        ? {
            isBackingTrack: true,
            targetDurationSeconds: normalizedDuration,
          }
        : {}),
      ...(normalizedLyrics ? { lyrics: normalizedLyrics } : {}),
    },
  };
}

export function syncElevenLabsBackingTrackMusicLengthMeta(generationMeta = {}, duration) {
  const normalizedDuration = Number(duration);
  if (!Number.isFinite(normalizedDuration) || normalizedDuration <= 0) {
    return generationMeta;
  }

  return {
    ...(generationMeta && typeof generationMeta === 'object' ? generationMeta : {}),
    musicLengthMs: resolveElevenLabsMusicLengthMs({
      requestedDurationSeconds: normalizedDuration,
    }),
  };
}
