const VISUAL_TRACK_FRAMES_PER_SECOND = 30;

function toFiniteNumber(value) {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : null;
}

function getLayerBoundImageTiming(layer = {}) {
  const startTime = Math.max(0, toFiniteNumber(layer?.durationOffset) ?? 0);
  const durationSeconds = Math.max(
    1 / VISUAL_TRACK_FRAMES_PER_SECOND,
    toFiniteNumber(layer?.duration) ?? 0
  );
  const startFrame = Math.max(0, Math.round(startTime * VISUAL_TRACK_FRAMES_PER_SECOND));
  const durationFrames = Math.max(
    1,
    Math.round(durationSeconds * VISUAL_TRACK_FRAMES_PER_SECOND)
  );
  const endFrame = startFrame + durationFrames;

  return {
    startFrame,
    endFrame,
    startTime,
    endTime: startTime + durationSeconds,
    durationFrames,
  };
}

export function createLayerBoundImageItem({
  layer,
  config,
  startFrame,
  endFrame,
  startTime,
  endTime,
  ...item
}) {
  const layerTiming = getLayerBoundImageTiming(layer);
  const resolvedStartFrame = Math.max(
    0,
    Math.round(toFiniteNumber(startFrame) ?? layerTiming.startFrame)
  );
  const resolvedEndFrame = Math.max(
    resolvedStartFrame + 1,
    Math.round(toFiniteNumber(endFrame) ?? layerTiming.endFrame)
  );
  const resolvedStartTime =
    toFiniteNumber(startTime) ?? resolvedStartFrame / VISUAL_TRACK_FRAMES_PER_SECOND;
  const resolvedEndTime = Math.max(
    resolvedStartTime + (1 / VISUAL_TRACK_FRAMES_PER_SECOND),
    toFiniteNumber(endTime) ?? resolvedEndFrame / VISUAL_TRACK_FRAMES_PER_SECOND
  );
  const existingConfig = config && typeof config === 'object' ? config : {};

  return {
    ...item,
    type: 'image',
    startFrame: resolvedStartFrame,
    endFrame: resolvedEndFrame,
    startTime: resolvedStartTime,
    endTime: resolvedEndTime,
    config: {
      ...existingConfig,
      frameOffset: Math.max(
        0,
        Math.round(
          toFiniteNumber(existingConfig.frameOffset) ??
            (resolvedStartFrame - layerTiming.startFrame)
        )
      ),
      frameDuration: Math.max(
        1,
        Math.round(
          toFiniteNumber(existingConfig.frameDuration) ??
            (resolvedEndFrame - resolvedStartFrame)
        )
      ),
    },
  };
}
