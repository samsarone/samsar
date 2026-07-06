export function roundConnectedAudioSeconds(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }
  return Math.round(numericValue * 1000) / 1000;
}

const CONNECTED_AUDIO_TIME_EPSILON = 0.001;

function toFiniteNumber(value, fallback = null) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function getLayerId(layer = {}) {
  return layer?._id?.toString?.() || layer?._id || null;
}

function getAudioConnectedLayerId(audioLayer = {}) {
  return audioLayer?.connectedLayerId?.toString?.() || audioLayer?.connectedLayerId || null;
}

function getAudioConnectedLayerIndex(audioLayer = {}) {
  const connectedLayerIndex = toFiniteNumber(audioLayer?.connectedLayerIndex);
  if (connectedLayerIndex === null) {
    return null;
  }
  return Number.isInteger(connectedLayerIndex) ? connectedLayerIndex : null;
}

function getReferenceAudioWindow({ audioLayer = {}, referenceStartTime = 0, fallbackLayerDuration = 0 }) {
  const rawStartTime = toFiniteNumber(audioLayer?.startTime);
  const rawEndTime = toFiniteNumber(audioLayer?.endTime);
  const rawDuration = toFiniteNumber(audioLayer?.duration);
  const resolvedFallbackDuration = Math.max(0, Number(fallbackLayerDuration) || 0);
  const relativeStart = Math.max(
    0,
    rawStartTime !== null ? rawStartTime - referenceStartTime : 0,
  );
  let relativeEnd = rawEndTime !== null
    ? rawEndTime - referenceStartTime
    : (relativeStart + (rawDuration !== null ? Math.max(0, rawDuration) : resolvedFallbackDuration));
  if (!Number.isFinite(relativeEnd)) {
    relativeEnd = relativeStart + resolvedFallbackDuration;
  }

  return {
    relativeStart,
    relativeEnd: Math.max(relativeStart, relativeEnd),
    duration: Math.max(0, relativeEnd - relativeStart),
    sourceTrimStartTime: Math.max(0, Number(audioLayer?.sourceTrimStartTime) || 0),
  };
}

function isReferenceStartTimeCompatible({ audioLayer = {}, referenceStartTime = 0, fallbackLayerDuration = 0 }) {
  const rawStartTime = toFiniteNumber(audioLayer?.startTime);
  if (rawStartTime === null) {
    return true;
  }

  const resolvedFallbackDuration = Math.max(0, Number(fallbackLayerDuration) || 0);

  if (rawStartTime < referenceStartTime - CONNECTED_AUDIO_TIME_EPSILON) {
    return false;
  }

  if (
    resolvedFallbackDuration > 0 &&
    rawStartTime > referenceStartTime + resolvedFallbackDuration + CONNECTED_AUDIO_TIME_EPSILON
  ) {
    return false;
  }

  return true;
}

function resolveConnectedAudioReferenceStartTime(audioLayer = {}, layerStartTime = 0, fallbackLayerDuration = 0) {
  const fallbackStartTime = Math.max(0, Number(layerStartTime) || 0);
  const storedStartTime = toFiniteNumber(audioLayer?.connectedLayerStartTimeOffset);

  if (storedStartTime === null) {
    return fallbackStartTime;
  }

  if (
    Math.abs(storedStartTime - fallbackStartTime) > CONNECTED_AUDIO_TIME_EPSILON &&
    isReferenceStartTimeCompatible({
      audioLayer,
      referenceStartTime: fallbackStartTime,
      fallbackLayerDuration,
    })
  ) {
    return fallbackStartTime;
  }

  if (isReferenceStartTimeCompatible({
    audioLayer,
    referenceStartTime: storedStartTime,
    fallbackLayerDuration,
  })) {
    return storedStartTime;
  }

  if (isReferenceStartTimeCompatible({
    audioLayer,
    referenceStartTime: fallbackStartTime,
    fallbackLayerDuration,
  })) {
    return fallbackStartTime;
  }

  return storedStartTime;
}

export function getConnectedAudioRelativeWindow(audioLayer = {}, layerStartTime = 0, fallbackLayerDuration = 0) {
  const resolvedLayerStartTime = resolveConnectedAudioReferenceStartTime(
    audioLayer,
    layerStartTime,
    fallbackLayerDuration,
  );

  return getReferenceAudioWindow({
    audioLayer,
    referenceStartTime: resolvedLayerStartTime,
    fallbackLayerDuration,
  });
}

export function applyConnectedAudioWindowToLayer({
  audioLayer,
  layer,
  layerIndex,
  relativeStart = 0,
  duration = 0,
  sourceTrimStartTime,
}) {
  if (!audioLayer || !layer) {
    return audioLayer;
  }

  const layerStartTime = Math.max(0, Number(layer?.durationOffset) || 0);
  const layerDuration = Math.max(0, Number(layer?.duration) || 0);
  const nextRelativeStart = Math.min(Math.max(0, Number(relativeStart) || 0), layerDuration);
  const maxDuration = Math.max(0, layerDuration - nextRelativeStart);
  const nextDuration = Math.min(Math.max(0, Number(duration) || 0), maxDuration);

  audioLayer.connectedLayerIndex = layerIndex;
  audioLayer.connectedLayerStartTimeOffset = roundConnectedAudioSeconds(layerStartTime);
  audioLayer.startTime = roundConnectedAudioSeconds(layerStartTime + nextRelativeStart);
  audioLayer.duration = roundConnectedAudioSeconds(nextDuration);
  audioLayer.endTime = roundConnectedAudioSeconds(audioLayer.startTime + audioLayer.duration);

  if (sourceTrimStartTime !== undefined) {
    audioLayer.sourceTrimStartTime = roundConnectedAudioSeconds(
      Math.max(0, Number(sourceTrimStartTime) || 0)
    );
  }

  return audioLayer;
}

export function mapConnectedAudioWindowThroughEdgeTrim({
  relativeStart = 0,
  duration = 0,
  sourceTrimStartTime = 0,
  previousLayerDuration = 0,
  trimStartSeconds = 0,
  trimEndSeconds = 0,
}) {
  const safePreviousLayerDuration = Math.max(0, Number(previousLayerDuration) || 0);
  const safeTrimStartSeconds = Math.max(0, Number(trimStartSeconds) || 0);
  const safeTrimEndSeconds = Math.max(0, Number(trimEndSeconds) || 0);
  const keptStart = Math.min(safeTrimStartSeconds, safePreviousLayerDuration);
  const keptEnd = Math.max(keptStart, safePreviousLayerDuration - safeTrimEndSeconds);
  const oldWindowStart = Math.max(0, Number(relativeStart) || 0);
  const oldWindowEnd = Math.max(oldWindowStart, oldWindowStart + Math.max(0, Number(duration) || 0));
  const overlapStart = Math.max(oldWindowStart, keptStart);
  const overlapEnd = Math.min(oldWindowEnd, keptEnd);

  if (overlapEnd <= overlapStart) {
    return {
      relativeStart: 0,
      duration: 0,
      sourceTrimStartTime: roundConnectedAudioSeconds(
        Math.max(0, Number(sourceTrimStartTime) || 0) + Math.max(0, keptStart - oldWindowStart)
      ),
    };
  }

  return {
    relativeStart: roundConnectedAudioSeconds(overlapStart - keptStart),
    duration: roundConnectedAudioSeconds(overlapEnd - overlapStart),
    sourceTrimStartTime: roundConnectedAudioSeconds(
      Math.max(0, Number(sourceTrimStartTime) || 0) + Math.max(0, overlapStart - oldWindowStart)
    ),
  };
}

export function annotateVideoEditSegmentsWithOutputTimeline(segments = []) {
  let outputCursor = 0;

  return segments.map((segment) => {
    const segmentDuration = Math.max(
      0,
      ((Number(segment?.visibleEnd) || 0) - (Number(segment?.visibleStart) || 0))
        / Math.max(1, Number(segment?.speedMultiplier) || 1)
    );
    const nextSegment = {
      ...segment,
      outputStart: roundConnectedAudioSeconds(outputCursor),
      outputEnd: roundConnectedAudioSeconds(outputCursor + segmentDuration),
    };
    outputCursor = nextSegment.outputEnd;
    return nextSegment;
  });
}

export function buildAudioEditSegmentsForConnectedAudio({
  relativeStart = 0,
  duration = 0,
  sourceTrimStartTime = 0,
  segments = [],
}) {
  const oldWindowStart = Math.max(0, Number(relativeStart) || 0);
  const oldWindowEnd = Math.max(oldWindowStart, oldWindowStart + Math.max(0, Number(duration) || 0));
  const sourceStartOffset = Math.max(0, Number(sourceTrimStartTime) || 0);
  const outputSegments = [];

  for (const segment of Array.isArray(segments) ? segments : []) {
    const segmentVisibleStart = Math.max(0, Number(segment?.visibleStart) || 0);
    const segmentVisibleEnd = Math.max(segmentVisibleStart, Number(segment?.visibleEnd) || 0);
    const speedMultiplier = Math.max(1, Number(segment?.speedMultiplier) || 1);
    const overlapStart = Math.max(oldWindowStart, segmentVisibleStart);
    const overlapEnd = Math.min(oldWindowEnd, segmentVisibleEnd);

    if (overlapEnd <= overlapStart) {
      continue;
    }

    outputSegments.push({
      sourceStart: roundConnectedAudioSeconds(sourceStartOffset + (overlapStart - oldWindowStart)),
      sourceEnd: roundConnectedAudioSeconds(sourceStartOffset + (overlapEnd - oldWindowStart)),
      speedMultiplier,
    });
  }

  return outputSegments.filter((segment) => segment.sourceEnd > segment.sourceStart);
}

export function mapConnectedAudioWindowThroughVideoEditSegments({
  relativeStart = 0,
  duration = 0,
  segments = [],
}) {
  const oldWindowStart = Math.max(0, Number(relativeStart) || 0);
  const oldWindowEnd = Math.max(oldWindowStart, oldWindowStart + Math.max(0, Number(duration) || 0));
  let mappedStart = null;
  let mappedEnd = null;

  for (const segment of Array.isArray(segments) ? segments : []) {
    const segmentVisibleStart = Math.max(0, Number(segment?.visibleStart) || 0);
    const segmentVisibleEnd = Math.max(segmentVisibleStart, Number(segment?.visibleEnd) || 0);
    const segmentOutputStart = Math.max(0, Number(segment?.outputStart) || 0);
    const speedMultiplier = Math.max(1, Number(segment?.speedMultiplier) || 1);
    const overlapStart = Math.max(oldWindowStart, segmentVisibleStart);
    const overlapEnd = Math.min(oldWindowEnd, segmentVisibleEnd);

    if (overlapEnd <= overlapStart) {
      continue;
    }

    const mappedOverlapStart = segmentOutputStart + ((overlapStart - segmentVisibleStart) / speedMultiplier);
    const mappedOverlapEnd = segmentOutputStart + ((overlapEnd - segmentVisibleStart) / speedMultiplier);

    if (mappedStart === null) {
      mappedStart = mappedOverlapStart;
    }
    mappedEnd = mappedOverlapEnd;
  }

  if (mappedStart === null || mappedEnd === null || mappedEnd <= mappedStart) {
    return {
      relativeStart: 0,
      duration: 0,
    };
  }

  return {
    relativeStart: roundConnectedAudioSeconds(mappedStart),
    duration: roundConnectedAudioSeconds(mappedEnd - mappedStart),
  };
}

export function recalculateLayerOffsetsAndConnectedAudio(layers = [], audioLayers = []) {
  let durationOffset = 0;
  const layerIndexById = new Map();

  for (let i = 0; i < layers.length; i++) {
    const layerId = getLayerId(layers[i]);
    if (layerId) {
      layerIndexById.set(layerId.toString(), i);
    }
  }

  const connectedAudioByLayerId = new Map();

  for (let i = 0; i < audioLayers.length; i++) {
    const audioLayer = audioLayers[i];
    const connectedLayerId = getAudioConnectedLayerId(audioLayer);
    let connectedLayerIndex = connectedLayerId
      ? layerIndexById.get(connectedLayerId.toString())
      : null;

    if (connectedLayerIndex == null) {
      const indexConnectedLayerIndex = getAudioConnectedLayerIndex(audioLayer);
      if (indexConnectedLayerIndex != null && layers[indexConnectedLayerIndex]) {
        connectedLayerIndex = indexConnectedLayerIndex;
        const resolvedLayerId = getLayerId(layers[connectedLayerIndex]);
        if (resolvedLayerId) {
          audioLayer.connectedLayerId = resolvedLayerId.toString();
        }
      }
    }

    if (connectedLayerIndex == null || !layers[connectedLayerIndex]) {
      continue;
    }

    const resolvedLayerId = getLayerId(layers[connectedLayerIndex]);
    if (!resolvedLayerId) {
      continue;
    }

    const resolvedLayerIdString = resolvedLayerId.toString();
    if (!connectedAudioByLayerId.has(resolvedLayerIdString)) {
      connectedAudioByLayerId.set(resolvedLayerIdString, []);
    }
    connectedAudioByLayerId.get(resolvedLayerIdString).push(audioLayer);
  }

  for (let i = 0; i < layers.length; i++) {
    const previousLayerStartTime = Math.max(0, Number(layers[i]?.durationOffset) || 0);
    const previousLayerDuration = Math.max(0, Number(layers[i]?.duration) || 0);
    layers[i].durationOffset = durationOffset;
    const currentLayerId = getLayerId(layers[i]);
    const connectedAudioLayers = currentLayerId
      ? connectedAudioByLayerId.get(currentLayerId.toString()) || []
      : [];

    for (let j = 0; j < connectedAudioLayers.length; j++) {
      const previousWindow = getConnectedAudioRelativeWindow(
        connectedAudioLayers[j],
        previousLayerStartTime,
        previousLayerDuration,
      );

      applyConnectedAudioWindowToLayer({
        audioLayer: connectedAudioLayers[j],
        layer: layers[i],
        layerIndex: i,
        relativeStart: previousWindow.relativeStart,
        duration: previousWindow.duration,
        sourceTrimStartTime: previousWindow.sourceTrimStartTime,
      });
    }

    durationOffset += layers[i].duration;
  }

  return durationOffset;
}
