export const aspectRatioOptions = [

  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '1:1', label: '1:1' },
]

const DEFAULT_SHORT_SIDE = 1024;
const DIMENSION_MULTIPLE = 64;
export const MIN_CANVAS_DIMENSION = 128;
export const MAX_CANVAS_DIMENSION = 8192;

const roundToMultiple = (value, multiple = DIMENSION_MULTIPLE) => {
  if (!Number.isFinite(value)) return DEFAULT_SHORT_SIDE;
  return Math.round(value / multiple) * multiple;
};

const parseAspectRatio = (aspectRatio) => {
  if (!aspectRatio || typeof aspectRatio !== 'string') return null;
  const match = aspectRatio.trim().match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const width = parseFloat(match[1]);
  const height = parseFloat(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
};

const getGreatestCommonDivisor = (left, right) => {
  let a = Math.abs(Math.round(left));
  let b = Math.abs(Math.round(right));

  while (b) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }

  return a || 1;
};

export function getCanvasDimensionsForAspectRatio(aspectRatio) {
  const ratio = parseAspectRatio(aspectRatio);
  if (!ratio) {
    return { width: DEFAULT_SHORT_SIDE, height: DEFAULT_SHORT_SIDE };
  }
  if (Math.abs(ratio.width - ratio.height) < 0.0001) {
    return { width: DEFAULT_SHORT_SIDE, height: DEFAULT_SHORT_SIDE };
  }

  const value = ratio.width / ratio.height;
  if (value > 1) {
    const width = roundToMultiple(DEFAULT_SHORT_SIDE * value);
    return { width, height: DEFAULT_SHORT_SIDE };
  }
  const height = roundToMultiple(DEFAULT_SHORT_SIDE / value);
  return { width: DEFAULT_SHORT_SIDE, height };
}

export function normalizeCanvasDimensions(canvasDimensions, fallbackAspectRatio = '1:1') {
  const fallbackDimensions = getCanvasDimensionsForAspectRatio(fallbackAspectRatio);
  const rawWidth = Number(canvasDimensions?.width);
  const rawHeight = Number(canvasDimensions?.height);

  return {
    width: Number.isFinite(rawWidth) && rawWidth > 0 ? Math.round(rawWidth) : fallbackDimensions.width,
    height: Number.isFinite(rawHeight) && rawHeight > 0 ? Math.round(rawHeight) : fallbackDimensions.height,
  };
}

export function isSupportedAspectRatioOptionValue(aspectRatio, options = aspectRatioOptions) {
  return Array.isArray(options) && options.some((option) => option?.value === aspectRatio);
}

export function findAspectRatioOptionForCanvasDimensions(
  canvasDimensions,
  options = aspectRatioOptions
) {
  const normalizedCanvasDimensions = normalizeCanvasDimensions(canvasDimensions);

  return (
    options.find((option) => {
      const optionDimensions = getCanvasDimensionsForAspectRatio(option.value);
      return (
        optionDimensions.width === normalizedCanvasDimensions.width &&
        optionDimensions.height === normalizedCanvasDimensions.height
      );
    }) || null
  );
}

export function findClosestAspectRatioOption(canvasDimensions, options = aspectRatioOptions) {
  if (!Array.isArray(options) || options.length === 0) {
    return null;
  }

  const normalizedCanvasDimensions = normalizeCanvasDimensions(canvasDimensions);
  const canvasRatio = normalizedCanvasDimensions.width / normalizedCanvasDimensions.height;

  return options.reduce((closestOption, option) => {
    const parsedRatio = parseAspectRatio(option?.value);
    if (!parsedRatio) {
      return closestOption;
    }

    const optionRatio = parsedRatio.width / parsedRatio.height;
    const optionDelta = Math.abs(Math.log(canvasRatio / optionRatio));

    if (!closestOption || optionDelta < closestOption.delta) {
      return {
        option,
        delta: optionDelta,
      };
    }

    return closestOption;
  }, null)?.option || null;
}

export function getSimplifiedAspectRatioLabel(canvasDimensions) {
  const normalizedCanvasDimensions = normalizeCanvasDimensions(canvasDimensions);
  const divisor = getGreatestCommonDivisor(
    normalizedCanvasDimensions.width,
    normalizedCanvasDimensions.height
  );

  return `${normalizedCanvasDimensions.width / divisor}:${normalizedCanvasDimensions.height / divisor}`;
}

export function fitDimensionsToCanvas(
  sourceDimensions,
  canvasDimensions,
  { allowUpscale = false } = {}
) {
  const normalizedSourceDimensions = normalizeCanvasDimensions(sourceDimensions);
  const normalizedCanvasDimensions = normalizeCanvasDimensions(canvasDimensions);

  let scale = Math.min(
    normalizedCanvasDimensions.width / normalizedSourceDimensions.width,
    normalizedCanvasDimensions.height / normalizedSourceDimensions.height
  );

  if (!allowUpscale) {
    scale = Math.min(scale, 1);
  }

  if (!Number.isFinite(scale) || scale <= 0) {
    scale = 1;
  }

  const width = Math.max(1, Math.round(normalizedSourceDimensions.width * scale));
  const height = Math.max(1, Math.round(normalizedSourceDimensions.height * scale));

  return {
    width,
    height,
    x: Math.round((normalizedCanvasDimensions.width - width) / 2),
    y: Math.round((normalizedCanvasDimensions.height - height) / 2),
    scale,
  };
}
