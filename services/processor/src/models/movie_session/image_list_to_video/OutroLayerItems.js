function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

const OUTRO_CANVAS_PADDING_RATIO = 28 / 1024;
const OUTRO_CENTER_SIZE_RATIO = 0.68;
const OUTRO_CENTER_MAX_WIDTH_RATIO = 0.68;
const OUTRO_CENTER_MAX_HEIGHT_RATIO = 0.8;
const OUTRO_CENTER_MIN_SIZE_RATIO = 0.52;
const OUTRO_TEXT_EDGE_PADDING_MULTILINE_RATIO = 0.047;
const OUTRO_TEXT_EDGE_PADDING_SINGLELINE_RATIO = 0.073;
const OUTRO_TEXT_EDGE_PADDING_PORTRAIT_MULTIPLIER = 3.5;

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

function splitTokenByUnits(value, maxUnits) {
  const chars = Array.from(String(value || ''));
  let total = 0;
  let output = '';
  let consumedCount = 0;
  for (const char of chars) {
    const units = char === ' ' ? 0.35 : (char.charCodeAt(0) > 127 ? 1 : 0.58);
    if (total + units > maxUnits) {
      break;
    }
    output += char;
    total += units;
    consumedCount += 1;
  }

  return {
    head: output.replace(/\s+$/g, ''),
    tail: chars.slice(consumedCount).join('').replace(/^\s+/g, ''),
  };
}

function wrapOutroText(value, maxWidth, fontSize, maxLines) {
  const text = normalizeOutroCtaText(value);
  if (!text) {
    return [];
  }

  const maxUnits = Math.max(4, maxWidth / Math.max(1, fontSize));
  const words = text.split(/\s+/).filter(Boolean);
  const safeMaxLines = Math.max(1, Math.floor(Number(maxLines) || 1));
  if (words.length === 0) {
    return [];
  }

  const lines = [];

  while (words.length > 0 && lines.length < safeMaxLines) {
    const isLastLine = lines.length === safeMaxLines - 1;

    if (isLastLine) {
      lines.push(truncateByUnits(words.join(' '), maxUnits));
      break;
    }

    let current = '';
    while (words.length > 0) {
      const candidate = current ? `${current} ${words[0]}` : words[0];
      if (estimateTextUnits(candidate) > maxUnits) {
        break;
      }
      current = candidate;
      words.shift();
    }

    if (current) {
      lines.push(current);
      continue;
    }

    const remainingLineCount = safeMaxLines - lines.length;
    if (remainingLineCount > 1) {
      const { head, tail } = splitTokenByUnits(words[0], maxUnits);
      if (head) {
        lines.push(head);
        if (tail) {
          words[0] = tail;
        } else {
          words.shift();
        }
        continue;
      }
    }

    lines.push(truncateByUnits(words.shift(), maxUnits));
  }

  return lines;
}

function getGeneratedOutroCenterBounds(canvasDimensions) {
  const { width, height } = canvasDimensions;
  const referenceSide = Math.min(width, height);
  const padding = Math.max(20, Math.round(referenceSide * OUTRO_CANVAS_PADDING_RATIO));
  const availableWidth = Math.max(1, width - padding * 2);
  const availableHeight = Math.max(1, height - padding * 2);
  const maxCenterSize = Math.max(
    220,
    Math.min(
      Math.round(availableWidth * OUTRO_CENTER_MAX_WIDTH_RATIO),
      Math.round(availableHeight * OUTRO_CENTER_MAX_HEIGHT_RATIO),
    ),
  );
  const minCenterSize = Math.min(
    maxCenterSize,
    Math.max(320, Math.round(referenceSide * OUTRO_CENTER_MIN_SIZE_RATIO)),
  );
  const centerSize = clampNumber(
    Math.round(referenceSide * OUTRO_CENTER_SIZE_RATIO),
    minCenterSize,
    maxCenterSize,
  );
  const centerY = padding + Math.round((availableHeight - centerSize) / 2);

  return {
    top: centerY,
    bottom: centerY + centerSize,
  };
}

function getDesiredOutroEdgePadding(canvasDimensions, placement, lineCount) {
  const { width, height } = canvasDimensions;
  const referenceSide = Math.min(width, height);
  const isPortrait = height > width;
  const baseRatio = lineCount > 1
    ? OUTRO_TEXT_EDGE_PADDING_MULTILINE_RATIO
    : OUTRO_TEXT_EDGE_PADDING_SINGLELINE_RATIO;
  const portraitMultiplier = isPortrait ? OUTRO_TEXT_EDGE_PADDING_PORTRAIT_MULTIPLIER : 1;
  const maxPadding = placement === 'top'
    ? height * (isPortrait ? 0.16 : 0.11)
    : height * (isPortrait ? 0.16 : 0.1);

  return Math.round(clampNumber(
    referenceSide * baseRatio * portraitMultiplier,
    lineCount > 1 ? 48 : 66,
    maxPadding,
  ));
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
  const desiredEdgePadding = getDesiredOutroEdgePadding(canvasDimensions, placement, lines.length);
  const centerBounds = getGeneratedOutroCenterBounds(canvasDimensions);
  const centerGap = Math.round(clampNumber(referenceSide * 0.009, 8, 14));
  const isPortrait = canvasDimensions.height > canvasDimensions.width;
  const lowerCenterGap = Math.round(clampNumber(referenceSide * 0.052, 44, 70));
  const edgePadding = placement === 'top'
    ? Math.min(desiredEdgePadding, Math.max(0, centerBounds.top - centerGap - textBlockHeight))
    : Math.min(desiredEdgePadding, Math.max(0, canvasDimensions.height - centerBounds.bottom - centerGap - textBlockHeight));
  const y = placement === 'top'
    ? edgePadding + textBlockHeight / 2
    : isPortrait
      ? Math.min(
        canvasDimensions.height - edgePadding - textBlockHeight / 2,
        centerBounds.bottom + lowerCenterGap + textBlockHeight / 2,
      )
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
  const topFontSize = Math.round(clampNumber(referenceSide * 0.05, 44, 57));
  const bottomFontSize = Math.round(clampNumber(referenceSide * 0.045, 38, 52));
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

export function createGeneratedOutroTileItems({
  generatedOutroComposition,
  startIndex = 0,
} = {}) {
  const tiles = Array.isArray(generatedOutroComposition?.tiles)
    ? generatedOutroComposition.tiles
    : [];

  return tiles.map((tile, tileIndex) => ({
    id: `item_${startIndex + tileIndex}`,
    type: 'image',
    image: tile.title || `server_generated_outro_tile_${tileIndex + 1}`,
    x: tile.x,
    y: tile.y,
    width: tile.width,
    height: tile.height,
    src: tile.src,
    is_base_image: false,
    isGeneratedOutroTile: true,
    animations: [],
  }));
}
