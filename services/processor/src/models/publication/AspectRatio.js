const formatAspectRatioComponent = (value) => {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  const rounded = Math.round(value * 10000) / 10000;
  return Number.isInteger(rounded)
    ? `${rounded}`
    : `${rounded}`.replace(/\.?0+$/, '');
};

export function normalizePublicationAspectRatio(aspectRatio) {
  if (typeof aspectRatio !== 'string') {
    return null;
  }

  const trimmed = aspectRatio.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  switch (trimmed) {
    case 'square':
      return '1:1';
    case 'landscape':
    case 'horizontal':
    case 'wide':
      return '16:9';
    case 'portrait':
    case 'vertical':
      return '9:16';
    default:
      break;
  }

  const normalized = trimmed.replace(/[x/×]/g, ':').replace(/\s+/g, '');
  const match = normalized.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) {
    return null;
  }

  const left = Number.parseFloat(match[1]);
  const right = Number.parseFloat(match[2]);
  const formattedLeft = formatAspectRatioComponent(left);
  const formattedRight = formatAspectRatioComponent(right);

  if (!formattedLeft || !formattedRight) {
    return null;
  }

  return `${formattedLeft}:${formattedRight}`;
}

export function resolvePublicationAspectRatio({
  sessionAspectRatio,
  requestedAspectRatio,
  publishedAspectRatio,
  fallback = '1:1',
} = {}) {
  return (
    normalizePublicationAspectRatio(sessionAspectRatio) ||
    normalizePublicationAspectRatio(requestedAspectRatio) ||
    normalizePublicationAspectRatio(publishedAspectRatio) ||
    normalizePublicationAspectRatio(fallback) ||
    '1:1'
  );
}
