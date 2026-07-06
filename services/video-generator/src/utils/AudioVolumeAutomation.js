const DEFAULT_AUDIO_LAYER_VOLUME = 100;
const DEFAULT_LAYER_EDGE_DUCKING_FADE_RATIO = 0.05;
const AUDIO_NUMBER_PRECISION = 4;
const AUDIO_TIME_EPSILON = 0.0001;

function roundAudioNumber(value, precision = AUDIO_NUMBER_PRECISION) {
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

export function isManualAudioVolumeAdjustmentEnabled(audioLayer = {}) {
  return Boolean(audioLayer?.manualVolumeAdjustmentEnabled);
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

    const normalizedTime = roundAudioNumber(time);
    const pointId = typeof point?.id === 'string' && point.id.trim()
      ? point.id.trim()
      : `point_${index}_${normalizedTime}`;

    dedupedPointsByTime.set(normalizedTime, {
      id: pointId,
      time: normalizedTime,
      volume: clampAudioLayerVolumeValue(point?.volume, fallbackVolume),
    });
  });

  return Array.from(dedupedPointsByTime.values()).sort((leftPoint, rightPoint) => leftPoint.time - rightPoint.time);
}

export function buildAudioVolumeAutomationPoints(audioLayer = {}, durationOverride = null) {
  const baseVolume = clampAudioLayerVolumeValue(audioLayer?.volume, DEFAULT_AUDIO_LAYER_VOLUME);
  const duration = durationOverride != null
    ? Math.max(0, Number(durationOverride) || 0)
    : resolveAudioLayerDuration(audioLayer);
  const timestampedVolumes = normalizeTimestampedVolumes(
    audioLayer?.timestampedVolumes || audioLayer?.volumeEnvelope,
    duration,
    baseVolume,
  );

  return [
    {
      id: 'start',
      time: 0,
      volume: clampAudioLayerVolumeValue(audioLayer?.startVolume, baseVolume),
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
      volume: clampAudioLayerVolumeValue(audioLayer?.endVolume, baseVolume),
      kind: 'end',
      fixed: true,
    },
  ];
}

export function buildResolvedAudioVolumeAutomationPoints(
  audioLayer = {},
  {
    duration = null,
    mapVolume = (value) => value,
  } = {},
) {
  return buildAudioVolumeAutomationPoints(audioLayer, duration).map((point) => ({
    ...point,
    gain: roundAudioNumber(Math.max(0, Number(mapVolume(point.volume)) || 0)),
  }));
}

export function hasManualAudioVolumeAutomation(audioLayer = {}, duration = null) {
  return isManualAudioVolumeAdjustmentEnabled(audioLayer)
    && buildAudioVolumeAutomationPoints(audioLayer, duration).length >= 2;
}

function resolvePointGain(point = {}) {
  if (Number.isFinite(Number(point?.gain))) {
    return Math.max(0, Number(point.gain));
  }

  if (Number.isFinite(Number(point?.volume))) {
    return Math.max(0, Number(point.volume));
  }

  return 0;
}

export function buildAudioVolumeExpression(points = [], formatNumber = (value) => `${roundAudioNumber(value)}`) {
  if (!Array.isArray(points) || points.length === 0) {
    return '1';
  }

  const sortedPoints = points
    .map((point, originalIndex) => ({
      point,
      originalIndex,
    }))
    .sort((leftEntry, rightEntry) => {
      const leftTime = Number.isFinite(Number(leftEntry.point?.time))
        ? Number(leftEntry.point.time)
        : 0;
      const rightTime = Number.isFinite(Number(rightEntry.point?.time))
        ? Number(rightEntry.point.time)
        : 0;

      if (leftTime !== rightTime) {
        return leftTime - rightTime;
      }

      return leftEntry.originalIndex - rightEntry.originalIndex;
    })
    .map((entry) => entry.point);

  let expression = formatNumber(resolvePointGain(sortedPoints[sortedPoints.length - 1]));

  for (let index = sortedPoints.length - 2; index >= 0; index -= 1) {
    const currentPoint = sortedPoints[index];
    const nextPoint = sortedPoints[index + 1];
    const currentTime = Number.isFinite(Number(currentPoint?.time))
      ? Math.max(0, Number(currentPoint.time))
      : 0;
    const nextTime = Number.isFinite(Number(nextPoint?.time))
      ? Math.max(currentTime, Number(nextPoint.time))
      : currentTime;
    const currentGain = resolvePointGain(currentPoint);
    const nextGain = resolvePointGain(nextPoint);

    if (nextTime <= currentTime + AUDIO_TIME_EPSILON) {
      expression = `if(lt(t,${formatNumber(nextTime)}),${formatNumber(currentGain)},${expression})`;
      continue;
    }

    const segmentDuration = nextTime - currentTime;
    const gainDelta = nextGain - currentGain;
    const currentTimeValue = formatNumber(currentTime);
    const nextTimeValue = formatNumber(nextTime);
    const segmentDurationValue = formatNumber(segmentDuration);
    const currentGainValue = formatNumber(currentGain);
    const gainDeltaValue = formatNumber(gainDelta);
    const segmentExpression = `${currentGainValue}+((${gainDeltaValue})*((t-${currentTimeValue})/${segmentDurationValue}))`;

    expression = `if(lt(t,${nextTimeValue}),${segmentExpression},${expression})`;
  }

  return expression;
}

function smoothStep(value) {
  const clampedValue = Math.min(Math.max(Number(value) || 0, 0), 1);
  return clampedValue * clampedValue * (3 - (2 * clampedValue));
}

function pushSmoothGainRamp({
  automationPoints,
  startTime,
  endTime,
  startGain,
  endGain,
}) {
  const resolvedStartTime = Number.isFinite(Number(startTime))
    ? Math.max(0, Number(startTime))
    : 0;
  const resolvedEndTime = Number.isFinite(Number(endTime))
    ? Math.max(resolvedStartTime, Number(endTime))
    : resolvedStartTime;
  const resolvedStartGain = Math.max(0, Number(startGain) || 0);
  const resolvedEndGain = Math.max(0, Number(endGain) || 0);

  if (resolvedEndTime <= resolvedStartTime + AUDIO_TIME_EPSILON) {
    automationPoints.push({ time: resolvedStartTime, gain: resolvedEndGain });
    return;
  }

  const rampStops = [0, 0.2, 0.4, 0.6, 0.8, 1];
  rampStops.forEach((progress) => {
    const easedProgress = smoothStep(progress);
    automationPoints.push({
      time: resolvedStartTime + ((resolvedEndTime - resolvedStartTime) * progress),
      gain: resolvedStartGain + ((resolvedEndGain - resolvedStartGain) * easedProgress),
    });
  });
}

export function buildLayerEdgeDuckingAutomationPoints({
  duration,
  fadeRatio = DEFAULT_LAYER_EDGE_DUCKING_FADE_RATIO,
  fadeDuration = null,
  startGain = 0,
  bodyGain = 1,
  endGain = 0,
} = {}) {
  const resolvedDuration = Number.isFinite(Number(duration))
    ? Math.max(0, Number(duration))
    : 0;

  if (resolvedDuration <= AUDIO_TIME_EPSILON) {
    return [];
  }

  const requestedFadeDuration = fadeDuration != null && Number.isFinite(Number(fadeDuration))
    ? Math.max(0, Number(fadeDuration))
    : resolvedDuration * Math.max(0, Number(fadeRatio) || 0);
  const resolvedFadeDuration = Math.min(resolvedDuration / 2, requestedFadeDuration);

  if (resolvedFadeDuration <= AUDIO_TIME_EPSILON) {
    return [];
  }

  const automationPoints = [];
  pushSmoothGainRamp({
    automationPoints,
    startTime: 0,
    endTime: resolvedFadeDuration,
    startGain,
    endGain: bodyGain,
  });

  const fadeOutStartTime = Math.max(resolvedFadeDuration, resolvedDuration - resolvedFadeDuration);
  if (fadeOutStartTime > resolvedFadeDuration + AUDIO_TIME_EPSILON) {
    automationPoints.push({
      time: fadeOutStartTime,
      gain: bodyGain,
    });
  }

  pushSmoothGainRamp({
    automationPoints,
    startTime: fadeOutStartTime,
    endTime: resolvedDuration,
    startGain: bodyGain,
    endGain,
  });

  const dedupedPoints = [];
  automationPoints.forEach((point) => {
    const normalizedPoint = {
      time: roundAudioNumber(point.time),
      gain: roundAudioNumber(point.gain),
    };
    const previousPoint = dedupedPoints[dedupedPoints.length - 1];
    if (
      previousPoint
      && Math.abs(previousPoint.time - normalizedPoint.time) < AUDIO_TIME_EPSILON
      && Math.abs(previousPoint.gain - normalizedPoint.gain) < AUDIO_TIME_EPSILON
    ) {
      return;
    }

    dedupedPoints.push(normalizedPoint);
  });

  return dedupedPoints;
}
