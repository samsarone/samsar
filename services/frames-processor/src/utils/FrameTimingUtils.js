function getFiniteItemFrameRange(item = {}) {
  const startFrame = Number(item?.config?.frameOffset);
  const frameDuration = Number(item?.config?.frameDuration);
  if (
    !Number.isFinite(startFrame) ||
    !Number.isFinite(frameDuration) ||
    frameDuration < 0
  ) {
    return null;
  }

  return {
    startFrame,
    configuredEndFrame: startFrame + frameDuration,
  };
}

function getCompatibleTimedSubtitleEndFrame(
  item,
  range,
  { durationOffsetFrames } = {},
) {
  if (!Array.isArray(item?.words) || item.words.length === 0) {
    return null;
  }

  const timedWords = item.words.map((wordInfo) => {
    const frameOffset = Number(wordInfo?.frameOffset);
    const frameDuration = Number(wordInfo?.frameDuration);
    if (
      !Number.isFinite(frameOffset) ||
      !Number.isFinite(frameDuration) ||
      frameDuration <= 0
    ) {
      return null;
    }
    return {
      startFrame: frameOffset,
      endFrame: frameOffset + frameDuration,
    };
  }).filter(Boolean);

  if (timedWords.length === 0) {
    return null;
  }

  const firstTimedFrame = Math.min(...timedWords.map((word) => word.startFrame));
  const lastTimedFrame = Math.max(...timedWords.map((word) => word.endFrame));
  const isCompatibleLocalSpan = (firstFrame, lastFrame) => (
    firstFrame >= range.startFrame - 1 &&
    firstFrame <= range.configuredEndFrame + 1 &&
    Math.abs(lastFrame - range.configuredEndFrame) <= 1
  );

  const candidateLocalSpans = [
    // Layer-local timings already use the same base as config.frameOffset.
    { firstFrame: firstTimedFrame, lastFrame: lastTimedFrame },
    // Item-relative timings begin at zero and need the item's local offset.
    {
      firstFrame: range.startFrame + firstTimedFrame,
      lastFrame: range.startFrame + lastTimedFrame,
    },
  ];

  const parsedDurationOffsetFrames = Number(durationOffsetFrames);
  if (Number.isFinite(parsedDurationOffsetFrames)) {
    // Listener-generated word timings are session-global while item visibility
    // is evaluated in the current layer's local frame base.
    candidateLocalSpans.push({
      firstFrame: firstTimedFrame - parsedDurationOffsetFrames,
      lastFrame: lastTimedFrame - parsedDurationOffsetFrames,
    });
  }

  const compatibleSpan = candidateLocalSpans.find(({ firstFrame, lastFrame }) => (
    isCompatibleLocalSpan(firstFrame, lastFrame)
  ));
  return compatibleSpan?.lastFrame ?? null;
}

export function getSubtitleEndFrameExclusive(item = {}, options = {}) {
  const range = getFiniteItemFrameRange(item);
  if (!range) {
    return null;
  }

  const timedEndFrame = getCompatibleTimedSubtitleEndFrame(item, range, options);
  const conventionalEndFrame = Math.max(range.startFrame + 1, range.configuredEndFrame);
  return timedEndFrame == null
    ? conventionalEndFrame
    : Math.max(conventionalEndFrame, timedEndFrame);
}

/**
 * Subtitle ranges are half-open so adjacent captions never share a frame.
 * Non-subtitle items retain the historical inclusive end boundary.
 */
export function isItemActiveAtFrame(item = {}, frame, options = {}) {
  const currentFrame = Number(frame);
  const range = getFiniteItemFrameRange(item);
  if (!Number.isFinite(currentFrame) || !range) {
    return false;
  }

  if (item?.type === 'text' && item?.subType === 'subtitle') {
    const endFrameExclusive = getSubtitleEndFrameExclusive(item, options);
    return currentFrame >= range.startFrame && currentFrame < endFrameExclusive;
  }

  return (
    currentFrame >= range.startFrame &&
    currentFrame <= range.configuredEndFrame
  );
}
