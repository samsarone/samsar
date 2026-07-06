import axios from 'axios';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import sharp from 'sharp';

import { getCanvasDimensionsForAspectRatio } from '../../utils/CanvasUtils.js';
import { normalizeOutroCtaImagePayload } from '../../utils/OutroCtaImagePayload.js';

const MEDIA_DOWNLOAD_TIMEOUT_MS = Number.isFinite(Number(process.env.API_MEDIA_DOWNLOAD_TIMEOUT_MS))
  ? Math.max(1000, Math.floor(Number(process.env.API_MEDIA_DOWNLOAD_TIMEOUT_MS)))
  : 180000;

const OUTRO_CANVAS_PADDING_RATIO = 28 / 1024;
const OUTRO_CENTER_SIZE_RATIO = 0.68;
const OUTRO_CENTER_MAX_WIDTH_RATIO = 0.68;
const OUTRO_CENTER_MAX_HEIGHT_RATIO = 0.8;
const OUTRO_CENTER_MIN_SIZE_RATIO = 0.52;
const OUTRO_CENTER_INSET_RATIO = 0.055;
const OUTRO_CENTER_INSET_MIN_RATIO = 22 / 1024;
const OUTRO_TILE_GAP_RATIO = 18 / 1024;
const MAX_OUTRO_TILES = 8;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function roundRect(rect) {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

function svgBuffer(svg) {
  return Buffer.from(svg);
}

function getFirstStringValue(...values) {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }
  return null;
}

function normalizeOptionalText(value, maxLength = 220) {
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
  if (output.length < value.length) {
    return `${output.replace(/\s+$/g, '')}...`;
  }
  return output;
}

function wrapTextLines(value, maxWidth, fontSize, maxLines) {
  const text = normalizeOptionalText(value);
  if (!text) {
    return [];
  }

  const maxUnits = Math.max(4, maxWidth / Math.max(1, fontSize));
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }

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

    if (estimateTextUnits(word) > maxUnits) {
      lines.push(truncateByUnits(word, maxUnits));
      current = '';
    } else {
      current = word;
    }
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

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function decodeImageDataUrl(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const match = value.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  if (!match) {
    return null;
  }
  return Buffer.from(match[1], 'base64');
}

async function loadImageBuffer(source) {
  const trimmed = typeof source === 'string' ? source.trim() : '';
  if (!trimmed) {
    throw new Error('Image source must be a non-empty string.');
  }

  const dataUrlBuffer = decodeImageDataUrl(trimmed);
  if (dataUrlBuffer) {
    return dataUrlBuffer;
  }

  if (!isHttpUrl(trimmed)) {
    throw new Error(`Image source must be an http(s) URL or data URL: ${trimmed}`);
  }

  const response = await axios.get(trimmed, {
    responseType: 'arraybuffer',
    timeout: MEDIA_DOWNLOAD_TIMEOUT_MS,
  });
  return Buffer.from(response.data);
}

function createRoundedMask(width, height, radius) {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const safeRadius = Math.max(0, Math.round(Math.min(radius, safeWidth / 2, safeHeight / 2)));
  return svgBuffer(`
    <svg width="${safeWidth}" height="${safeHeight}" viewBox="0 0 ${safeWidth} ${safeHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${safeWidth}" height="${safeHeight}" rx="${safeRadius}" ry="${safeRadius}" fill="#fff"/>
    </svg>
  `);
}

function computeCenterQrLayout(size, inset) {
  const safeSize = Math.max(128, Math.round(size));
  const safeInset = Math.max(10, Math.round(inset));
  const scanPadding = Math.max(16, Math.round(Math.min(safeInset * 0.72, safeSize * 0.04)));
  const qrFrameSize = Math.max(1, safeSize - scanPadding * 2);

  return {
    qrFrameX: scanPadding,
    qrFrameY: scanPadding,
    qrFrameSize,
  };
}

function computeOutroLayout(aspectRatio = '16:9') {
  const { width, height } = getCanvasDimensionsForAspectRatio(aspectRatio);
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
  const minCenterSize = Math.min(maxCenterSize, Math.max(320, Math.round(referenceSide * OUTRO_CENTER_MIN_SIZE_RATIO)));
  const centerSize = clamp(
    Math.round(referenceSide * OUTRO_CENTER_SIZE_RATIO),
    minCenterSize,
    maxCenterSize,
  );
  const centerX = padding + Math.round((availableWidth - centerSize) / 2);
  const centerY = padding + Math.round((availableHeight - centerSize) / 2);
  const tileGap = Math.max(12, Math.round(referenceSide * OUTRO_TILE_GAP_RATIO));
  const tileInset = Math.round(tileGap / 2);
  const centerInset = Math.max(
    Math.round(referenceSide * OUTRO_CENTER_INSET_MIN_RATIO),
    Math.round(centerSize * OUTRO_CENTER_INSET_RATIO),
  );
  const centerQrLayout = computeCenterQrLayout(centerSize, centerInset);

  return {
    width,
    height,
    padding,
    availableWidth,
    availableHeight,
    centerX,
    centerY,
    centerSize,
    centerInset,
    tileGap,
    tileInset,
    outerRect: roundRect({
      x: padding,
      y: padding,
      width: availableWidth,
      height: availableHeight,
    }),
    focusArea: {
      x: Math.round(centerX + centerQrLayout.qrFrameX),
      y: Math.round(centerY + centerQrLayout.qrFrameY),
      width: centerQrLayout.qrFrameSize,
      height: centerQrLayout.qrFrameSize,
    },
  };
}

function createImageListOutroBackgroundBuffer(layout) {
  return svgBuffer(`
    <svg width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="outroBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#1e40af"/>
          <stop offset="1" stop-color="#059669"/>
        </linearGradient>
      </defs>
      <rect width="${layout.width}" height="${layout.height}" fill="url(#outroBg)"/>
      <rect x="0" y="${Math.round(layout.height * 0.13)}" width="${layout.width}" height="${Math.round(layout.height * 0.14)}" fill="#ffffff" opacity="0.05"/>
      <rect x="0" y="${Math.round(layout.height * 0.58)}" width="${layout.width}" height="${Math.round(layout.height * 0.12)}" fill="#ffffff" opacity="0.035"/>
    </svg>
  `);
}

function gridRects(rect, columns, rows) {
  const safeColumns = Math.max(1, Math.round(columns));
  const safeRows = Math.max(1, Math.round(rows));
  const widths = Array.from({ length: safeColumns }, (_, index) => {
    const left = Math.round((rect.width * index) / safeColumns);
    const right = Math.round((rect.width * (index + 1)) / safeColumns);
    return right - left;
  });
  const heights = Array.from({ length: safeRows }, (_, index) => {
    const top = Math.round((rect.height * index) / safeRows);
    const bottom = Math.round((rect.height * (index + 1)) / safeRows);
    return bottom - top;
  });

  const cells = [];
  let y = rect.y;
  for (let row = 0; row < safeRows; row += 1) {
    let x = rect.x;
    for (let column = 0; column < safeColumns; column += 1) {
      cells.push(roundRect({
        x,
        y,
        width: widths[column],
        height: heights[row],
      }));
      x += widths[column];
    }
    y += heights[row];
  }
  return cells;
}

function selectTileRects(layout, count) {
  const safeCount = Math.max(0, Math.min(count, MAX_OUTRO_TILES));
  const rect = layout.outerRect;
  let sourceRects;

  if (safeCount <= 1) {
    sourceRects = [rect];
  } else if (safeCount === 2) {
    sourceRects = gridRects(rect, 2, 1);
  } else if (safeCount === 3) {
    const leftWidth = Math.round(rect.width * 0.52);
    sourceRects = [
      { x: rect.x, y: rect.y, width: leftWidth, height: rect.height },
      { x: rect.x + leftWidth, y: rect.y, width: rect.width - leftWidth, height: Math.round(rect.height / 2) },
      {
        x: rect.x + leftWidth,
        y: rect.y + Math.round(rect.height / 2),
        width: rect.width - leftWidth,
        height: rect.height - Math.round(rect.height / 2),
      },
    ];
  } else if (safeCount === 4) {
    sourceRects = gridRects(rect, 2, 2);
  } else if (safeCount <= 6) {
    const cells = gridRects(rect, 3, 2);
    sourceRects = [cells[0], cells[2], cells[3], cells[5], cells[1], cells[4]];
  } else {
    const cells = gridRects(rect, 4, 2);
    sourceRects = [cells[0], cells[3], cells[4], cells[7], cells[1], cells[2], cells[5], cells[6]];
  }

  return sourceRects
    .map(roundRect)
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .slice(0, safeCount);
}

function insetRect(rect, inset) {
  const maxInset = Math.max(0, Math.min(inset, Math.floor((rect.width - 1) / 2), Math.floor((rect.height - 1) / 2)));
  return roundRect({
    x: rect.x + maxInset,
    y: rect.y + maxInset,
    width: rect.width - maxInset * 2,
    height: rect.height - maxInset * 2,
  });
}

function normalizeTileCandidates(imageListPayload = [], imageUrls = []) {
  const candidates = [];
  const addCandidate = (url, title) => {
    const normalizedUrl = typeof url === 'string' ? url.trim() : '';
    if (!normalizedUrl) {
      return;
    }
    candidates.push({
      imageUrl: normalizedUrl,
      title: normalizeOptionalText(title, 120) || '',
    });
  };

  if (Array.isArray(imageListPayload)) {
    for (const item of imageListPayload) {
      if (typeof item === 'string') {
        addCandidate(item, null);
        continue;
      }
      if (!item || typeof item !== 'object') {
        continue;
      }
      addCandidate(
        getFirstStringValue(
          item.effective_url,
          item.effectiveUrl,
          item.enhanced_url,
          item.enhancedUrl,
          item.image_url,
          item.imageUrl,
          item.url,
          item.src,
        ),
        getFirstStringValue(
          item.title,
          item.image_title,
          item.imageTitle,
          item.image_text,
          item.imageText,
          item.activity_title,
          item.activityTitle,
          item.name,
          item.label,
        ),
      );
    }
  }

  if (candidates.length === 0 && Array.isArray(imageUrls)) {
    for (const imageUrl of imageUrls) {
      addCandidate(imageUrl, null);
    }
  }

  return candidates.slice(0, MAX_OUTRO_TILES);
}

async function renderTileBuffer({ imageBuffer, width, height }) {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const radius = Math.max(18, Math.round(Math.min(safeWidth, safeHeight) * 0.075));
  const image = await sharp(imageBuffer, { failOn: 'none' })
    .rotate()
    .resize(safeWidth, safeHeight, { fit: 'cover', position: 'centre' })
    .modulate({ brightness: 0.84, saturation: 1.08 })
    .png()
    .toBuffer();

  const overlay = svgBuffer(`
    <svg width="${safeWidth}" height="${safeHeight}" viewBox="0 0 ${safeWidth} ${safeHeight}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="tileShade" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0.08"/>
          <stop offset="0.56" stop-color="#000000" stop-opacity="0.02"/>
          <stop offset="1" stop-color="#000000" stop-opacity="0.28"/>
        </linearGradient>
      </defs>
      <rect width="${safeWidth}" height="${safeHeight}" fill="url(#tileShade)"/>
      <rect x="1.5" y="1.5" width="${safeWidth - 3}" height="${safeHeight - 3}" rx="${Math.max(1, radius - 2)}" fill="none" stroke="#ffffff" stroke-opacity="0.14" stroke-width="3"/>
    </svg>
  `);

  const tile = await sharp(image)
    .composite([{ input: overlay, left: 0, top: 0 }])
    .png()
    .toBuffer();

  return sharp(tile)
    .composite([{ input: createRoundedMask(safeWidth, safeHeight, radius), blend: 'dest-in' }])
    .png()
    .toBuffer();
}

async function renderCenterPanelBuffer({
  ctaUrl,
  outroCtaImage = null,
  size,
  inset,
}) {
  const safeSize = Math.max(128, Math.round(size));
  const { qrFrameX, qrFrameY, qrFrameSize } = computeCenterQrLayout(safeSize, inset);

  const baseSvg = svgBuffer(`
    <svg width="${safeSize}" height="${safeSize}" viewBox="0 0 ${safeSize} ${safeSize}" xmlns="http://www.w3.org/2000/svg">
    </svg>
  `);

  const normalizedOutroCtaImage = normalizeOutroCtaImagePayload(outroCtaImage);
  let centerBuffer;
  let centerLeft = qrFrameX;
  let centerTop = qrFrameY;
  let centerType = 'qr';

  if (normalizedOutroCtaImage) {
    const sourceBuffer = await loadImageBuffer(normalizedOutroCtaImage.source);
    centerBuffer = await sharp(sourceBuffer, { failOn: 'none' })
      .rotate()
      .resize(qrFrameSize, qrFrameSize, {
        fit: 'inside',
        withoutEnlargement: false,
      })
      .png()
      .toBuffer();
    const centerMetadata = await sharp(centerBuffer).metadata();
    centerLeft = qrFrameX + Math.max(0, Math.round((qrFrameSize - (centerMetadata.width || qrFrameSize)) / 2));
    centerTop = qrFrameY + Math.max(0, Math.round((qrFrameSize - (centerMetadata.height || qrFrameSize)) / 2));
    centerType = 'cta_image';
  } else {
    centerBuffer = await QRCode.toBuffer(ctaUrl, {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 2,
      width: qrFrameSize,
      color: { dark: '#0f172a', light: '#ffffff' },
    });
  }

  const composites = [{
    input: centerBuffer,
    left: centerLeft,
    top: centerTop,
  }];

  const buffer = await sharp(baseSvg)
    .composite(composites)
    .png()
    .toBuffer();

  return {
    buffer,
    focusArea: {
      x: qrFrameX,
      y: qrFrameY,
      width: qrFrameSize,
      height: qrFrameSize,
    },
    qrFrameSize,
    centerType,
  };
}

export function computeGeneratedOutroFocusArea(aspectRatio = '16:9') {
  return computeOutroLayout(aspectRatio).focusArea;
}

export async function generateOutroCompositionAssetsFromImageList({
  imageListPayload = [],
  imageUrls = [],
  aspectRatio = '16:9',
  ctaUrl,
  outroCtaImage = null,
  assetsRoot,
  sessionId,
} = {}) {
  const normalizedCtaUrl = getFirstStringValue(ctaUrl);
  const normalizedOutroCtaImage = normalizeOutroCtaImagePayload(outroCtaImage);
  if (!normalizedCtaUrl && !normalizedOutroCtaImage) {
    throw new Error('cta_url or outro_cta_image is required when generate_outro_image is true.');
  }
  if (normalizedCtaUrl && !isHttpUrl(normalizedCtaUrl)) {
    throw new Error('cta_url must be an http or https URL.');
  }
  if (typeof assetsRoot !== 'string' || !assetsRoot.trim()) {
    throw new Error('assetsRoot is required to generate outro composition assets.');
  }
  if (typeof sessionId !== 'string' || !sessionId.trim()) {
    throw new Error('sessionId is required to generate outro composition assets.');
  }

  const tiles = normalizeTileCandidates(imageListPayload, imageUrls);

  const layout = computeOutroLayout(aspectRatio);
  const outroFolderPath = path.join(assetsRoot, 'video', 'outro', sessionId);
  await fs.promises.mkdir(outroFolderPath, { recursive: true });

  const writeAsset = async (fileName, buffer) => {
    const filePath = path.join(outroFolderPath, fileName);
    await fs.promises.writeFile(filePath, buffer);
    const relativePath = path
      .relative(assetsRoot, filePath)
      .split(path.sep)
      .join('/');
    return assetsRoot.replace(/\\/g, '/').endsWith('/assets_v2')
      ? path.posix.join('assets_v2', relativePath)
      : relativePath;
  };

  const backgroundSrc = await writeAsset(
    'outro_background.png',
    await sharp(createImageListOutroBackgroundBuffer(layout)).png().toBuffer(),
  );

  const tileRects = selectTileRects(layout, tiles.length);
  const tileItems = [];
  for (let index = 0; index < tileRects.length; index += 1) {
    const tile = tiles[index];
    const rect = insetRect(tileRects[index], layout.tileInset);
    const imageBuffer = await loadImageBuffer(tile.imageUrl);
    const tileBuffer = await renderTileBuffer({
      imageBuffer,
      width: rect.width,
      height: rect.height,
    });
    const src = await writeAsset(`outro_tile_${index + 1}.png`, tileBuffer);
    tileItems.push({
      src,
      sourceImageUrl: tile.imageUrl,
      title: tile.title,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });
  }

  const centerPanel = await renderCenterPanelBuffer({
    ctaUrl: normalizedCtaUrl,
    outroCtaImage: normalizedOutroCtaImage,
    size: layout.centerSize,
    inset: layout.centerInset,
  });
  const qrSrc = await writeAsset(
    centerPanel.centerType === 'cta_image' ? 'outro_cta_image.png' : 'outro_qr.png',
    centerPanel.buffer,
  );
  const centerAsset = {
    src: qrSrc,
    x: Math.round(layout.centerX),
    y: Math.round(layout.centerY),
    width: layout.centerSize,
    height: layout.centerSize,
    type: centerPanel.centerType,
  };

  return {
    width: layout.width,
    height: layout.height,
    tileCount: tileItems.length,
    qrSize: centerPanel.qrFrameSize,
    centerType: centerPanel.centerType,
    focusArea: {
      x: Math.round(layout.centerX + centerPanel.focusArea.x),
      y: Math.round(layout.centerY + centerPanel.focusArea.y),
      width: centerPanel.focusArea.width,
      height: centerPanel.focusArea.height,
    },
    background: {
      src: backgroundSrc,
      x: 0,
      y: 0,
      width: layout.width,
      height: layout.height,
    },
    tiles: tileItems,
    center: centerAsset,
    qr: centerAsset,
  };
}

export async function generateOutroImageFromImageList({
  imageListPayload = [],
  imageUrls = [],
  aspectRatio = '16:9',
  ctaUrl,
  outroCtaImage = null,
  ctaTextTop = null,
  ctaTextBottom = null,
  ctaLogo = null,
} = {}) {
  const normalizedCtaUrl = getFirstStringValue(ctaUrl);
  const normalizedOutroCtaImage = normalizeOutroCtaImagePayload(outroCtaImage);
  if (!normalizedCtaUrl && !normalizedOutroCtaImage) {
    throw new Error('cta_url or outro_cta_image is required when generate_outro_image is true.');
  }
  if (normalizedCtaUrl && !isHttpUrl(normalizedCtaUrl)) {
    throw new Error('cta_url must be an http or https URL.');
  }

  const tiles = normalizeTileCandidates(imageListPayload, imageUrls);
  if (tiles.length === 0) {
    throw new Error('At least one image_url is required to generate an outro image.');
  }

  const layout = computeOutroLayout(aspectRatio);
  const tileRects = selectTileRects(layout, tiles.length);
  const baseSvg = createImageListOutroBackgroundBuffer(layout);

  const composites = [];
  for (let index = 0; index < tileRects.length; index += 1) {
    const tile = tiles[index];
    const rect = insetRect(tileRects[index], layout.tileInset);
    const imageBuffer = await loadImageBuffer(tile.imageUrl);
    const tileBuffer = await renderTileBuffer({
      imageBuffer,
      width: rect.width,
      height: rect.height,
    });
    composites.push({
      input: tileBuffer,
      left: rect.x,
      top: rect.y,
    });
  }

  const centerPanel = await renderCenterPanelBuffer({
    ctaUrl: normalizedCtaUrl,
    outroCtaImage: normalizedOutroCtaImage,
    size: layout.centerSize,
    inset: layout.centerInset,
  });

  composites.push({
    input: centerPanel.buffer,
    left: Math.round(layout.centerX),
    top: Math.round(layout.centerY),
  });

  const buffer = await sharp(baseSvg)
    .composite(composites)
    .png()
    .toBuffer();

  return {
    buffer,
    mimeType: 'image/png',
    focusArea: {
      x: Math.round(layout.centerX + centerPanel.focusArea.x),
      y: Math.round(layout.centerY + centerPanel.focusArea.y),
      width: centerPanel.focusArea.width,
      height: centerPanel.focusArea.height,
    },
    width: layout.width,
    height: layout.height,
    tileCount: tiles.length,
    qrSize: centerPanel.qrFrameSize,
    centerType: centerPanel.centerType,
  };
}

export async function generateOutroImageFromTextToVideo({
  aspectRatio = '16:9',
  ctaUrl,
  outroCtaImage = null,
  ctaTextTop = null,
  ctaTextBottom = null,
  ctaLogo = null,
} = {}) {
  const normalizedCtaUrl = getFirstStringValue(ctaUrl);
  const normalizedOutroCtaImage = normalizeOutroCtaImagePayload(outroCtaImage);
  if (!normalizedCtaUrl && !normalizedOutroCtaImage) {
    throw new Error('cta_url or outro_cta_image is required when generate_outro_image is true.');
  }
  if (normalizedCtaUrl && !isHttpUrl(normalizedCtaUrl)) {
    throw new Error('cta_url must be an http or https URL.');
  }

  const layout = computeOutroLayout(aspectRatio);
  const baseSvg = svgBuffer(`
    <svg width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="outroBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#1e40af"/>
          <stop offset="1" stop-color="#059669"/>
        </linearGradient>
        <radialGradient id="ambientGlow" cx="50%" cy="45%" r="72%">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0.18"/>
          <stop offset="0.46" stop-color="#10b981" stop-opacity="0.1"/>
          <stop offset="1" stop-color="#000000" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="${layout.width}" height="${layout.height}" fill="url(#outroBg)"/>
      <rect width="${layout.width}" height="${layout.height}" fill="url(#ambientGlow)"/>
      <rect x="0" y="${Math.round(layout.height * 0.13)}" width="${layout.width}" height="${Math.round(layout.height * 0.14)}" fill="#ffffff" opacity="0.05"/>
      <rect x="0" y="${Math.round(layout.height * 0.58)}" width="${layout.width}" height="${Math.round(layout.height * 0.12)}" fill="#ffffff" opacity="0.035"/>
    </svg>
  `);

  const centerPanel = await renderCenterPanelBuffer({
    ctaUrl: normalizedCtaUrl,
    outroCtaImage: normalizedOutroCtaImage,
    size: layout.centerSize,
    inset: layout.centerInset,
  });

  const buffer = await sharp(baseSvg)
    .composite([
      {
        input: centerPanel.buffer,
        left: Math.round(layout.centerX),
        top: Math.round(layout.centerY),
      },
    ])
    .png()
    .toBuffer();

  return {
    buffer,
    mimeType: 'image/png',
    focusArea: {
      x: Math.round(layout.centerX + centerPanel.focusArea.x),
      y: Math.round(layout.centerY + centerPanel.focusArea.y),
      width: centerPanel.focusArea.width,
      height: centerPanel.focusArea.height,
    },
    width: layout.width,
    height: layout.height,
    tileCount: 0,
    qrSize: centerPanel.qrFrameSize,
    centerType: centerPanel.centerType,
  };
}
