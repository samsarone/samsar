function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeOutroCtaText(value, maxLength = 180) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function estimateTextUnits(value) {
  return Array.from(String(value || '')).reduce((total, char) => {
    if (char === ' ') {
      return total + 0.35;
    }
    return total + (char.charCodeAt(0) > 127 ? 1 : 0.58);
  }, 0);
}

function truncateByUnits(value, maxUnits) {
  const chars = Array.from(String(value || ''));
  let total = 0;
  let output = '';
  for (const char of chars) {
    const units = char === ' ' ? 0.35 : (char.charCodeAt(0) > 127 ? 1 : 0.58);
    if (total + units > maxUnits) {
      break;
    }
    output += char;
    total += units;
  }
  return output.length < value.length ? `${output.replace(/\s+$/g, '')}...` : output;
}

function wrapOutroText(value, maxWidth, fontSize, maxLines) {
  const text = normalizeOutroCtaText(value);
  if (!text) {
    return [];
  }

  const maxUnits = Math.max(4, maxWidth / Math.max(1, fontSize));
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (estimateTextUnits(candidate) <= maxUnits) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
    }
    current = estimateTextUnits(word) > maxUnits ? truncateByUnits(word, maxUnits) : word;
  }

  if (current) {
    lines.push(current);
  }

  if (lines.length <= maxLines) {
    return lines;
  }

  const trimmed = lines.slice(0, maxLines);
  trimmed[maxLines - 1] = truncateByUnits(trimmed[maxLines - 1], Math.max(4, maxUnits - 1));
  return trimmed;
}

function getOutroEdgePadding(referenceSide, lineCount) {
  if (lineCount > 1) {
    return Math.round(clampNumber(referenceSide * 0.041, 38, 56));
  }
  return Math.round(clampNumber(referenceSide * 0.062, 56, 76));
}

export function createOutroFadeOverlayItem({ id, canvasDimensions }) {
  return {
    id,
    type: 'shape',
    shape: 'rectangle',
    isOutroFadeOverlay: true,
    x: 0,
    y: 0,
    width: canvasDimensions.width,
    height: canvasDimensions.height,
    animations: [
      {
        type: 'fade',
        params: {
          startFade: 0,
          endFade: 100,
        },
      },
    ],
    config: {
      x: 0,
      y: 0,
      width: canvasDimensions.width,
      height: canvasDimensions.height,
      fillColor: '#000000',
    },
  };
}

function createTextItem({
  id,
  text,
  canvasDimensions,
  placement,
  fontSize,
  maxLines,
  fontEmphasis,
  maxWidthRatio,
}) {
  const referenceSide = Math.min(canvasDimensions.width, canvasDimensions.height);
  const maxWidth = Math.round(canvasDimensions.width * maxWidthRatio);
  const lines = wrapOutroText(text, maxWidth, fontSize, maxLines);
  if (lines.length === 0) {
    return null;
  }

  const lineHeight = placement === 'top' ? 1.08 : 1.12;
  const textBlockHeight = Math.round(lines.length * fontSize * lineHeight);
  const edgePadding = getOutroEdgePadding(referenceSide, lines.length);
  const y = placement === 'top'
    ? edgePadding + textBlockHeight / 2
    : canvasDimensions.height - edgePadding - textBlockHeight / 2;

  return {
    id,
    type: 'text',
    isOutroCtaText: true,
    outroCtaPlacement: placement,
    text: lines.join('\n'),
    x: 0,
    y: 0,
    width: canvasDimensions.width,
    height: canvasDimensions.height,
    animations: [],
    config: {
      x: canvasDimensions.width / 2,
      y,
      width: maxWidth,
      height: textBlockHeight,
      fontSize,
      fontFamily: 'Poppins, Montserrat, Arial, sans-serif',
      fillColor: '#f8fafc',
      strokeColor: 'rgba(2, 6, 23, 0.86)',
      strokeWidth: Math.max(4, Math.round(fontSize * 0.11)),
      textAlign: 'center',
      fontEmphasis,
      lineHeight,
      textShadow: {
        color: 'rgba(0, 0, 0, 0.62)',
        blur: Math.round(referenceSide * 0.014),
        offsetX: 0,
        offsetY: Math.max(2, Math.round(referenceSide * 0.006)),
      },
    },
  };
}

export function createOutroCtaTextItems({
  canvasDimensions,
  ctaTextTop = null,
  ctaTextBottom = null,
  startIndex = 0,
} = {}) {
  const referenceSide = Math.min(canvasDimensions.width, canvasDimensions.height);
  const isLandscape = canvasDimensions.width > canvasDimensions.height;
  const textMaxWidthRatio = isLandscape ? 0.82 : 0.78;
  const topFontSize = Math.round(clampNumber(referenceSide * 0.053, 46, 62)) + 1;
  const bottomFontSize = Math.round(clampNumber(referenceSide * 0.049, 42, 56));
  const items = [];

  const topItem = createTextItem({
    id: `item_${startIndex + items.length}`,
    text: ctaTextTop,
    canvasDimensions,
    placement: 'top',
    fontSize: topFontSize,
    maxLines: 2,
    fontEmphasis: 'bold',
    maxWidthRatio: textMaxWidthRatio,
  });
  if (topItem) {
    items.push(topItem);
  }

  const bottomItem = createTextItem({
    id: `item_${startIndex + items.length}`,
    text: ctaTextBottom,
    canvasDimensions,
    placement: 'bottom',
    fontSize: bottomFontSize,
    maxLines: 2,
    fontEmphasis: 'bold',
    maxWidthRatio: textMaxWidthRatio,
  });
  if (bottomItem) {
    items.push(bottomItem);
  }

  return items;
}
