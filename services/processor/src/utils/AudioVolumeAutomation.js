const DEFAULT_AUDIO_LAYER_VOLUME = 100;
const AUDIO_VOLUME_PRECISION = 4;
const AUDIO_TIME_PRECISION = 4;
const AUDIO_TIME_EPSILON = 0.0001;

function roundAudioNumber(value, precision = AUDIO_VOLUME_PRECISION) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Number(numericValue.toFixed(precision));
}

export function clampAudioLayerVolumeValue(value, fallbackValue = DEFAULT_AUDIO_LAYER_VOLUME) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return roundAudioNumber(Math.max(0, Number(fallbackValue) || DEFAULT_AUDIO_LAYER_VOLUME));
  }

  return roundAudioNumber(Math.max(0, numericValue));
}

export function resolveAudioLayerDuration(audioLayer = {}) {
  const startTime = Number.isFinite(Number(audioLayer?.startTime))
    ? Math.max(0, Number(audioLayer.startTime))
    : 0;
  const endTime = Number.isFinite(Number(audioLayer?.endTime))
    ? Math.max(startTime, Number(audioLayer.endTime))
    : startTime;
  const explicitDuration = Number.isFinite(Number(audioLayer?.duration))
    ? Math.max(0, Number(audioLayer.duration))
    : null;

  if (explicitDuration != null) {
    return explicitDuration;
  }

  return Math.max(0, endTime - startTime);
}

export function normalizeTimestampedVolumes(timestampedVolumes, duration, fallbackVolume = DEFAULT_AUDIO_LAYER_VOLUME) {
  const resolvedDuration = Number.isFinite(Number(duration))
    ? Math.max(0, Number(duration))
    : 0;
  const normalizedTimestampedVolumes = Array.isArray(timestampedVolumes)
    ? timestampedVolumes
    : [];

  const dedupedPointsByTime = new Map();

  normalizedTimestampedVolumes.forEach((point, index) => {
    const time = Number.isFinite(Number(point?.time))
      ? Math.max(0, Math.min(resolvedDuration, Number(point.time)))
      : null;

    if (time == null) {
      return;
    }

    if (
      time <= AUDIO_TIME_EPSILON
      || (resolvedDuration > 0 && time >= resolvedDuration - AUDIO_TIME_EPSILON)
    ) {
      return;
    }

    const normalizedTime = roundAudioNumber(time, AUDIO_TIME_PRECISION);
    const pointId = typeof point?.id === 'string' && point.id.trim()
      ? point.id.trim()
      : `point_${index}_${normalizedTime}`;

    dedupedPointsByTime.set(normalizedTime, {
      id: pointId,
      time: normalizedTime,
      volume: clampAudioLayerVolumeValue(point?.volume, fallbackVolume),
    });
  });

  return Array.from(dedupedPointsByTime.values()).sort((leftPoint, rightPoint) => {
    if (leftPoint.time !== rightPoint.time) {
      return leftPoint.time - rightPoint.time;
    }

    return leftPoint.id.localeCompare(rightPoint.id);
  });
}

export function normalizeAudioLayerManualVolumeSettings(audioLayer = {}) {
  const baseVolume = clampAudioLayerVolumeValue(audioLayer?.volume, DEFAULT_AUDIO_LAYER_VOLUME);
  const duration = resolveAudioLayerDuration(audioLayer);

  return {
    manualVolumeAdjustmentEnabled: Boolean(audioLayer?.manualVolumeAdjustmentEnabled),
    startVolume: clampAudioLayerVolumeValue(audioLayer?.startVolume, baseVolume),
    endVolume: clampAudioLayerVolumeValue(audioLayer?.endVolume, baseVolume),
    timestampedVolumes: normalizeTimestampedVolumes(
      audioLayer?.timestampedVolumes || audioLayer?.volumeEnvelope,
      duration,
      baseVolume,
    ),
  };
}

export function applyAudioLayerManualVolumeDefaults(audioLayer = {}) {
  return {
    ...audioLayer,
    ...normalizeAudioLayerManualVolumeSettings(audioLayer),
  };
}
