function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function removeEmptyValues(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => (
      value !== undefined &&
      value !== null &&
      !(typeof value === 'string' && value.trim() === '')
    ))
  );
}

function normalizeDurationSeconds(payload = {}) {
  const candidates = [
    payload.duration,
    payload.durationSeconds,
    payload.duration_seconds,
    payload.secondsTotal,
    payload.seconds_total,
    payload.generationMeta?.duration,
    payload.generationMeta?.targetDurationSeconds,
    payload.generationMeta?.fullTimelineDurationSeconds,
  ];

  for (const candidate of candidates) {
    const normalized = Number(candidate);
    if (Number.isFinite(normalized) && normalized > 0) {
      return normalized;
    }
  }

  return undefined;
}

export function buildMusicInputPayload(payload = {}) {
  const model = normalizeString(payload.model || payload.musicProvider) || 'ELEVENLABS_MUSIC';
  const duration = normalizeDurationSeconds(payload);
  const isInstrumental = payload.isInstrumental !== false;
  const sourceGenerationMeta = payload.generationMeta && typeof payload.generationMeta === 'object'
    ? payload.generationMeta
    : {};
  const isBackingTrack = Boolean(
    payload.isBackingTrack ||
    payload.is_backing_track ||
    sourceGenerationMeta.isBackingTrack ||
    sourceGenerationMeta.is_backing_track
  );
  const generationMeta = {
    ...sourceGenerationMeta,
    ...(isBackingTrack ? { isBackingTrack: true } : {}),
  };

  return removeEmptyValues({
    prompt: normalizeString(payload.prompt) || 'Create an original cinematic background music track.',
    model,
    music_model: model,
    musicModel: model,
    music_provider: model,
    musicProvider: model,
    duration,
    duration_seconds: duration,
    durationSeconds: duration,
    seconds_total: duration,
    secondsTotal: duration,
    is_instrumental: isInstrumental,
    isInstrumental,
    is_backing_track: isBackingTrack,
    isBackingTrack,
    make_instrumental: isInstrumental,
    force_instrumental: Boolean(isInstrumental || sourceGenerationMeta.forceInstrumental),
    lyrics: normalizeString(sourceGenerationMeta.lyrics) || undefined,
    generation_meta: generationMeta,
    generationMeta,
    metadata: generationMeta,
    end_user_id: payload.userId,
  });
}
