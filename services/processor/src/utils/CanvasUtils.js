

export function getCanvasDimensionsForAspectRatio(aspectRatio) {
  const defaultSide = 1024;
  const multiple = 64;

  if (!aspectRatio || typeof aspectRatio !== 'string') {
    return { width: defaultSide, height: defaultSide };
  }

  const match = aspectRatio.trim().match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) {
    return { width: defaultSide, height: defaultSide };
  }

  const widthRatio = parseFloat(match[1]);
  const heightRatio = parseFloat(match[2]);
  if (!Number.isFinite(widthRatio) || !Number.isFinite(heightRatio) || widthRatio <= 0 || heightRatio <= 0) {
    return { width: defaultSide, height: defaultSide };
  }

  if (Math.abs(widthRatio - heightRatio) < 0.0001) {
    return { width: defaultSide, height: defaultSide };
  }

  const roundToMultiple = (value) => Math.round(value / multiple) * multiple;
  const ratio = widthRatio / heightRatio;
  if (ratio > 1) {
    return { width: roundToMultiple(defaultSide * ratio), height: defaultSide };
  }
  return { width: defaultSide, height: roundToMultiple(defaultSide / ratio) };
}
