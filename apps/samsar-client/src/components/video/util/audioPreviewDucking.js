const MUSIC_DUCK_FADE_DURATION_SECONDS = 0.5;
const MUSIC_DUCKED_VOLUME_RATIO = 0.225;
const MUSIC_DUCK_MERGE_GAP_SECONDS = MUSIC_DUCK_FADE_DURATION_SECONDS;
const AUDIO_VOLUME_PRECISION = 4;
const AUDIO_TIME_EPSILON = 0.0001;

export function clampAudioValue(value, min = 0, max = 1) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

export function normalizeAudioLayerType(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'music' ||
    normalized === 'background_music' ||
    normalized === 'background music' ||
    normalized === 'bgm' ||
    normalized === 'backing_track' ||
    normalized === 'backing track'
  ) {
    return 'music';
  }

  if (normalized === 'sound') {
    return 'sound_effect';
  }

  if (normalized === 'lip sync') {
    return 'lip_sync';
  }

  if (
    normalized === 'custom_speech' ||
    normalized === 'custom speech' ||
    normalized === 'recorded_speech' ||
    normalized === 'recorded speech'
  ) {
    return 'speech';
  }

  return normalized;
}

export function isMusicLikeAudioType(value) {
  return normalizeAudioLayerType(value) === 'music';
}

export function isSpeechLikeAudioType(value) {
  const normalized = normalizeAudioLayerType(value);
  return (
    normalized === 'speech' ||
    normalized === 'lip_sync' ||
    normalized === 'user_video'
  );
}

export function shouldDuckMusicAgainstAudioType(value) {
  const normalized = normalizeAudioLayerType(value);
  return Boolean(normalized) && normalized !== 'music';
}

function roundAudioNumber(value, precision = AUDIO_VOLUME_PRECISION) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Number(numericValue.toFixed(precision));
}

export function clampAudioVolumeValue(value, fallbackValue = 100) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return roundAudioNumber(Math.max(0, Number(fallbackValue) || 100));
  }

  return roundAudioNumber(Math.max(0, numericValue));
}

function resolvePreviewVolumeGainFromVolumeValue(volumeValue) {
  const rawVolume = Number(volumeValue);
  if (!Number.isFinite(rawVolume) || rawVolume < 0) {
    return 1;
  }

  return roundAudioNumber(rawVolume / 100);
}

function isManualAudioVolumeAdjustmentEnabled(audioLayer = {}) {
  return Boolean(audioLayer?.manualVolumeAdjustmentEnabled);
}

function resolveAudioLayerAutomationDuration(audioLayer = {}) {
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

function normalizeAudioLayerTimestampedVolumes(timestampedVolumes, duration, fallbackVolume = 100) {
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

    const normalizedTime = roundAudioNumber(time);
    const pointId = typeof point?.id === 'string' && point.id.trim()
      ? point.id.trim()
      : `point_${index}_${normalizedTime}`;

    dedupedPointsByTime.set(normalizedTime, {
      id: pointId,
      time: normalizedTime,
      volume: clampAudioVolumeValue(point?.volume, fallbackVolume),
    });
  });

  return Array.from(dedupedPointsByTime.values()).sort((leftPoint, rightPoint) => leftPoint.time - rightPoint.time);
}

export function buildAudioLayerVolumeAutomationPoints(audioLayer = {}, durationOverride = null) {
  const baseVolume = clampAudioVolumeValue(audioLayer?.volume, 100);
  const duration = durationOverride != null
    ? Math.max(0, Number(durationOverride) || 0)
    : resolveAudioLayerAutomationDuration(audioLayer);
  const timestampedVolumes = normalizeAudioLayerTimestampedVolumes(
    audioLayer?.timestampedVolumes || audioLayer?.volumeEnvelope,
    duration,
    baseVolume,
  );

  return [
    {
      id: 'start',
      time: 0,
      volume: clampAudioVolumeValue(audioLayer?.startVolume, baseVolume),
      kind: 'start',
      fixed: true,
    },
    ...timestampedVolumes.map((point) => ({
      ...point,
      kind: 'point',
      fixed: false,
    })),
    {
      id: 'end',
      time: roundAudioNumber(duration),
      volume: clampAudioVolumeValue(audioLayer?.endVolume, baseVolume),
      kind: 'end',
      fixed: true,
    },
  ];
}

export function buildResolvedPreviewAudioVolumeAutomationPoints(audioLayer = {}, durationOverride = null) {
  return buildAudioLayerVolumeAutomationPoints(audioLayer, durationOverride).map((point) => ({
    ...point,
    gain: resolvePreviewVolumeGainFromVolumeValue(point.volume, audioLayer?.generationType),
  }));
}

export function hasManualAudioVolumeAutomation(audioLayer = {}, durationOverride = null) {
  return isManualAudioVolumeAdjustmentEnabled(audioLayer)
    && buildAudioLayerVolumeAutomationPoints(audioLayer, durationOverride).length >= 2;
}

export function getAudioVolumeGainAtTime(layerTimeSeconds, points = []) {
  if (!Array.isArray(points) || points.length === 0) {
    return 1;
  }

  const time = Number.isFinite(Number(layerTimeSeconds))
    ? Math.max(0, Number(layerTimeSeconds))
    : 0;
  const sortedPoints = [...points].sort((leftPoint, rightPoint) => leftPoint.time - rightPoint.time);

  if (time <= sortedPoints[0].time) {
    return Number(sortedPoints[0].gain ?? sortedPoints[0].volume ?? 1) || 1;
  }

  for (let index = 1; index < sortedPoints.length; index += 1) {
    const previousPoint = sortedPoints[index - 1];
    const nextPoint = sortedPoints[index];
    if (time > nextPoint.time) {
      continue;
    }

    const previousGain = Number(previousPoint?.gain ?? previousPoint?.volume ?? 1) || 1;
    const nextGain = Number(nextPoint?.gain ?? nextPoint?.volume ?? 1) || 1;
    const segmentDuration = Number(nextPoint.time) - Number(previousPoint.time);

    if (segmentDuration <= AUDIO_TIME_EPSILON) {
      return nextGain;
    }

    const progress = clampAudioValue((time - Number(previousPoint.time)) / segmentDuration);
    return previousGain + ((nextGain - previousGain) * progress);
  }

  return Number(sortedPoints[sortedPoints.length - 1].gain ?? sortedPoints[sortedPoints.length - 1].volume ?? 1) || 1;
}

export function resolvePreviewLayerBaseVolume(audioLayer = {}) {
  return resolvePreviewVolumeGainFromVolumeValue(audioLayer?.volume, audioLayer?.generationType);
}

export function isRenderablePreviewAudioLayer(layer = {}) {
  if (!layer) {
    return false;
  }

  const hasExplicitSelectionState =
    typeof layer.isEnabled === 'boolean' || typeof layer.defaultSelected === 'boolean';
  const isSelectedLayer = hasExplicitSelectionState
    ? Boolean(layer.isEnabled || layer.defaultSelected)
    : true;
  const generationStatus = typeof layer.generationStatus === 'string'
    ? layer.generationStatus.trim().toUpperCase()
    : '';

  return Boolean(resolveAudioLayerSourceValue(layer))
    && isSelectedLayer
    && generationStatus !== 'PENDING';
}

function resolveAudioLayerSourceValue(audioLayer = {}) {
  if (typeof audioLayer.selectedLocalAudioLink === 'string' && audioLayer.selectedLocalAudioLink.trim()) {
    return audioLayer.selectedLocalAudioLink.trim();
  }

  if (Array.isArray(audioLayer.localAudioLinks) && audioLayer.localAudioLinks.length > 0) {
    const localAudioLink = audioLayer.localAudioLinks.find((link) => typeof link === 'string' && link.trim());
    if (localAudioLink) {
      return localAudioLink.trim();
    }
  }

  if (typeof audioLayer.url === 'string' && audioLayer.url.trim()) {
    return audioLayer.url.trim();
  }

  if (typeof audioLayer.selectedRemoteAudioLink === 'string' && audioLayer.selectedRemoteAudioLink.trim()) {
    return audioLayer.selectedRemoteAudioLink.trim();
  }

  if (Array.isArray(audioLayer.remoteAudioLinks) && audioLayer.remoteAudioLinks.length > 0) {
    const remoteAudioLink = audioLayer.remoteAudioLinks.find((link) => typeof link === 'string' && link.trim());
    if (remoteAudioLink) {
      return remoteAudioLink.trim();
    }
  }

  if (Array.isArray(audioLayer.remoteAudioData) && audioLayer.remoteAudioData.length > 0) {
    const remoteAudioData = audioLayer.remoteAudioData.find((audioData) => (
      typeof audioData?.audio_url === 'string' && audioData.audio_url.trim()
    ));
    if (remoteAudioData?.audio_url) {
      return remoteAudioData.audio_url.trim();
    }
  }

  return null;
}

function resolvePreviewMediaUrl(value, baseUrl = '') {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmedValue)) {
    return trimmedValue;
  }

  const normalizedPath = trimmedValue.startsWith('/') ? trimmedValue : `/${trimmedValue}`;
  const trimmedBaseUrl = typeof baseUrl === 'string'
    ? baseUrl.trim().replace(/\/+$/, '')
    : '';

  if (!trimmedBaseUrl) {
    return normalizedPath;
  }

  return `${trimmedBaseUrl}${normalizedPath}`;
}

export function resolvePreviewAudioUrl(audioLayer = {}, processorApiUrl = '') {
  const sourceValue = resolveAudioLayerSourceValue(audioLayer);
  if (!sourceValue) {
    return null;
  }

  return resolvePreviewMediaUrl(sourceValue, processorApiUrl);
}

export function buildMusicDuckingWindows({
  musicStartTime,
  musicEndTime,
  duckingLayers,
  fadeDurationSeconds = MUSIC_DUCK_FADE_DURATION_SECONDS,
  mergeGapSeconds = MUSIC_DUCK_MERGE_GAP_SECONDS,
}) {
  if (!Array.isArray(duckingLayers) || duckingLayers.length === 0) {
    return [];
  }

  const overlapWindows = duckingLayers
    .map((layer) => {
      const layerStartTime = Number.isFinite(Number(layer?.startTime))
        ? Math.max(0, Number(layer.startTime))
        : 0;
      const layerEndTime = Number.isFinite(Number(layer?.endTime))
        ? Math.max(layerStartTime, Number(layer.endTime))
        : layerStartTime;
      const overlapStart = Math.max(musicStartTime, layerStartTime);
      const overlapEnd = Math.min(musicEndTime, layerEndTime);
      if (overlapEnd <= overlapStart) {
        return null;
      }

      return {
        start: overlapStart,
        end: overlapEnd,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.start !== right.start) {
        return left.start - right.start;
      }
      return left.end - right.end;
    });

  if (overlapWindows.length === 0) {
    return [];
  }

  const mergedWindows = [overlapWindows[0]];
  for (let index = 1; index < overlapWindows.length; index += 1) {
    const currentWindow = overlapWindows[index];
    const previousWindow = mergedWindows[mergedWindows.length - 1];

    if (currentWindow.start <= previousWindow.end + mergeGapSeconds) {
      previousWindow.end = Math.max(previousWindow.end, currentWindow.end);
      continue;
    }

    mergedWindows.push(currentWindow);
  }

  return mergedWindows.map((window) => {
    const windowDuration = Math.max(0, window.end - window.start);
    return {
      start: window.start,
      end: window.end,
      fadeDuration: Math.min(fadeDurationSeconds, windowDuration / 2),
    };
  });
}

export function getMusicDuckingVolumeAtTime(timeSeconds, duckingWindows) {
  if (!Array.isArray(duckingWindows) || duckingWindows.length === 0) {
    return 1;
  }

  const time = Number.isFinite(Number(timeSeconds)) ? Math.max(0, Number(timeSeconds)) : 0;

  for (const duckingWindow of duckingWindows) {
    const fadeDuration = Number.isFinite(Number(duckingWindow?.fadeDuration))
      ? Math.max(0, Number(duckingWindow.fadeDuration))
      : 0;
    const duckStart = Number.isFinite(Number(duckingWindow?.start))
      ? Math.max(0, Number(duckingWindow.start))
      : 0;
    const duckEnd = Number.isFinite(Number(duckingWindow?.end))
      ? Math.max(duckStart, Number(duckingWindow.end))
      : duckStart;

    if (duckEnd <= duckStart) {
      continue;
    }

    if (fadeDuration <= 0) {
      if (time >= duckStart && time <= duckEnd) {
        return MUSIC_DUCKED_VOLUME_RATIO;
      }
      continue;
    }

    const fadeInStart = Math.max(0, duckStart - fadeDuration);
    const fadeOutEnd = duckEnd + fadeDuration;

    if (time < fadeInStart || time >= fadeOutEnd) {
      continue;
    }

    if (time < duckStart) {
      const fadeProgress = clampAudioValue((time - fadeInStart) / fadeDuration);
      return 1 - ((1 - MUSIC_DUCKED_VOLUME_RATIO) * fadeProgress);
    }

    if (time < duckEnd) {
      return MUSIC_DUCKED_VOLUME_RATIO;
    }

    const fadeProgress = clampAudioValue((time - duckEnd) / fadeDuration);
    return MUSIC_DUCKED_VOLUME_RATIO + ((1 - MUSIC_DUCKED_VOLUME_RATIO) * fadeProgress);
  }

  return 1;
}
