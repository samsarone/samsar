function clampNumber(value, minimumValue, maximumValue) {
  return Math.max(minimumValue, Math.min(maximumValue, Number(value) || 0));
}

function getGeometrySegments(geometry) {
  return Array.isArray(geometry?.segments) ? geometry.segments : [];
}

export function getViewportGeometryFrameRange(geometry) {
  const segments = getGeometrySegments(geometry);

  if (segments.length === 0) {
    const fallbackStartFrame = Math.round(Number(geometry?.frameStart) || 0);
    const fallbackEndFrame = Math.max(
      fallbackStartFrame + 1,
      Math.round(Number(geometry?.frameEnd) || fallbackStartFrame + 1),
    );

    return [fallbackStartFrame, fallbackEndFrame];
  }

  return [
    Math.round(Number(segments[0]?.frameStart) || 0),
    Math.max(
      Math.round(Number(segments[0]?.frameStart) || 0) + 1,
      Math.round(Number(segments[segments.length - 1]?.frameEnd) || 0),
    ),
  ];
}

export function frameToViewportValue(frame, geometry) {
  const segments = getGeometrySegments(geometry);
  const [geometryStartFrame, geometryEndFrame] = getViewportGeometryFrameRange(geometry);
  const safeFrame = clampNumber(frame, geometryStartFrame, geometryEndFrame);

  if (segments.length === 0) {
    return safeFrame - geometryStartFrame;
  }

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const frameStart = Math.round(Number(segment?.frameStart) || 0);
    const frameEnd = Math.max(frameStart + 1, Math.round(Number(segment?.frameEnd) || frameStart + 1));
    const pixelStart = Number(segment?.pixelStart) || 0;
    const pixelEnd = Math.max(pixelStart, Number(segment?.pixelEnd) || pixelStart);

    if (safeFrame <= frameStart) {
      return pixelStart;
    }

    if (safeFrame < frameEnd) {
      const frameProgress = (safeFrame - frameStart) / Math.max(1, frameEnd - frameStart);
      return pixelStart + (frameProgress * (pixelEnd - pixelStart));
    }
  }

  const lastSegment = segments[segments.length - 1];
  return Math.max(0, Number(lastSegment?.pixelEnd) || 0);
}

export function viewportValueToFrame(viewportValue, geometry) {
  const segments = getGeometrySegments(geometry);
  const totalPixels = Math.max(1, Number(geometry?.totalPixels) || 1);
  const safeViewportValue = clampNumber(viewportValue, 0, totalPixels);

  if (segments.length === 0) {
    const [geometryStartFrame, geometryEndFrame] = getViewportGeometryFrameRange(geometry);
    const progress = safeViewportValue / totalPixels;
    return geometryStartFrame + (progress * Math.max(1, geometryEndFrame - geometryStartFrame));
  }

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const pixelStart = Number(segment?.pixelStart) || 0;
    const pixelEnd = Math.max(pixelStart, Number(segment?.pixelEnd) || pixelStart);
    const frameStart = Math.round(Number(segment?.frameStart) || 0);
    const frameEnd = Math.max(frameStart + 1, Math.round(Number(segment?.frameEnd) || frameStart + 1));

    if (safeViewportValue <= pixelStart) {
      return frameStart;
    }

    if (safeViewportValue < pixelEnd) {
      const pixelProgress = (safeViewportValue - pixelStart) / Math.max(1, pixelEnd - pixelStart);
      return frameStart + (pixelProgress * (frameEnd - frameStart));
    }
  }

  const lastSegment = segments[segments.length - 1];
  return Math.max(0, Number(lastSegment?.frameEnd) || 0);
}
