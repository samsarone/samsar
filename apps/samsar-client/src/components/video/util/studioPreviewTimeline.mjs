export const STUDIO_DISPLAY_FRAMES_PER_SECOND = 30;

export function secondsToDisplayFrames(value) {
  return Math.max(
    0,
    Math.round((Number(value) || 0) * STUDIO_DISPLAY_FRAMES_PER_SECOND)
  );
}

export function getLayerDisplayFrameRange(layer) {
  const startFrame = secondsToDisplayFrames(layer?.durationOffset);
  const durationFrames = Math.max(1, secondsToDisplayFrames(layer?.duration));

  return {
    startFrame,
    endFrame: startFrame + durationFrames,
  };
}

export function getLayerDisplayFrameRanges(layers) {
  if (!Array.isArray(layers)) {
    return [];
  }

  let previousEndFrame = 0;
  return layers.map((layer) => {
    const rawOffset = layer?.durationOffset;
    const hasExplicitOffset = rawOffset !== undefined
      && rawOffset !== null
      && rawOffset !== ''
      && Number.isFinite(Number(rawOffset));
    const configuredStartFrame = hasExplicitOffset
      ? secondsToDisplayFrames(rawOffset)
      : previousEndFrame;
    // Layer insertions can briefly expose the new ordering before every
    // durationOffset in the response has caught up. Keep the client timeline
    // monotonic so the inserted scene still participates in layout immediately.
    const startFrame = Math.max(previousEndFrame, configuredStartFrame);
    const durationFrames = Math.max(1, secondsToDisplayFrames(layer?.duration));
    const range = { startFrame, endFrame: startFrame + durationFrames };
    previousEndFrame = range.endFrame;
    return range;
  });
}

export function findLayerIndexAtDisplayFrame(layers, displayFrame) {
  if (!Array.isArray(layers) || layers.length === 0) {
    return -1;
  }

  const resolvedFrame = Math.max(0, Number(displayFrame) || 0);
  const layerRanges = getLayerDisplayFrameRanges(layers);
  const exactLayerIndex = layerRanges.findIndex(({ startFrame, endFrame }) => {
    return resolvedFrame >= startFrame && resolvedFrame < endFrame;
  });
  if (exactLayerIndex >= 0) {
    return exactLayerIndex;
  }

  for (let index = layers.length - 1; index >= 0; index -= 1) {
    if (resolvedFrame >= layerRanges[index].startFrame) {
      return index;
    }
  }

  return 0;
}

export function resolveLayerSelectionAtDisplayFrame(
  layers,
  displayFrame,
  currentLayerId = null
) {
  const activeLayerIndex = findLayerIndexAtDisplayFrame(layers, displayFrame);
  const activeLayer = activeLayerIndex >= 0 ? layers[activeLayerIndex] : null;
  const activeLayerId = activeLayer?._id?.toString?.()
    || activeLayer?._id
    || activeLayer?.id?.toString?.()
    || activeLayer?.id
    || null;
  const normalizedCurrentLayerId = currentLayerId?.toString?.() || currentLayerId || null;

  return {
    activeLayer,
    activeLayerId,
    activeLayerIndex,
    shouldUpdate: Boolean(activeLayer && activeLayerId !== normalizedCurrentLayerId),
  };
}

export function resolveTimelineDuration(layers, sessionDetails = {}) {
  const explicitDuration = Number(sessionDetails?.totalDuration ?? sessionDetails?.duration);
  if (Number.isFinite(explicitDuration) && explicitDuration > 0) {
    return explicitDuration;
  }

  const sessionLayers = Array.isArray(layers) ? layers : [];
  let previousEndTime = 0;

  sessionLayers.forEach((layer) => {
    const rawOffset = layer?.durationOffset;
    const hasExplicitOffset = rawOffset !== undefined
      && rawOffset !== null
      && rawOffset !== ''
      && Number.isFinite(Number(rawOffset));
    const configuredStartTime = hasExplicitOffset
      ? Math.max(0, Number(rawOffset))
      : previousEndTime;
    const startTime = Math.max(previousEndTime, configuredStartTime);
    previousEndTime = startTime + Math.max(0, Number(layer?.duration) || 0);
  });

  return previousEndTime;
}
