import fs from 'fs';
import path from 'path';
import axios from 'axios';
import sharp from 'sharp';

import VideoSession from '../schema/VideoSession.js';
import { getCanvasDimensionsForAspectRatio } from './CanvasUtils.js';

const MEDIA_DOWNLOAD_TIMEOUT_MS = Number.isFinite(Number(process.env.API_MEDIA_DOWNLOAD_TIMEOUT_MS))
  ? Math.max(1000, Math.floor(Number(process.env.API_MEDIA_DOWNLOAD_TIMEOUT_MS)))
  : 180000;

const OUTRO_CANVAS_PADDING_RATIO = 28 / 1024;
const OUTRO_CENTER_SIZE_RATIO = 0.68;
const OUTRO_CENTER_MAX_WIDTH_RATIO = 0.68;
const OUTRO_CENTER_MAX_HEIGHT_RATIO = 0.8;
const OUTRO_CENTER_MIN_SIZE_RATIO = 0.52;
const OUTRO_CENTER_INSET_MIN_RATIO = 22 / 1024;
const OUTRO_CENTER_INSET_RATIO = 0.055;
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

function isWritableDirectory(dirPath) {
  try {
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveAssetsRoot() {
  const dockerAssetsRoot = process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2';
  if (
    (
      process.env.CURRENT_ENV === 'staging' ||
      process.env.CURRENT_ENV === 'docker' ||
      process.env.CURRENT_ENV === 'production'
    ) &&
    fs.existsSync(dockerAssetsRoot) &&
    isWritableDirectory(dockerAssetsRoot)
  ) {
    return dockerAssetsRoot;
  }

  const localAssetsRoot = path.join(process.cwd(), '../', 'samsar_processor', 'assets_v2');
  if (!fs.existsSync(localAssetsRoot)) {
    fs.mkdirSync(localAssetsRoot, { recursive: true });
  }
  return localAssetsRoot;
}

function normalizeDirectoryPath(dirPath) {
  return typeof dirPath === 'string' ? dirPath.replace(/\/+$/, '') : '';
}

function uniqStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()))];
}

function resolveReadableAssetsRoots(primaryAssetsRoot = resolveAssetsRoot()) {
  const rootCandidates = [
    primaryAssetsRoot,
    process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2',
    '/assets',
    path.join(process.cwd(), '../', 'samsar_processor', 'assets_v2'),
    path.join(process.cwd(), '../', 'samsar_processor', 'assets'),
    path.join(process.cwd(), 'assets_v2'),
    path.join(process.cwd(), 'assets'),
  ];

  return uniqStrings(rootCandidates)
    .map(normalizeDirectoryPath)
    .filter((rootPath) => rootPath && fs.existsSync(rootPath));
}

function stripLeadingSlash(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/^\/+/, '').split('?')[0].split('#')[0];
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isImageDataUrl(value) {
  return typeof value === 'string' && /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(value.trim());
}

function extractUrlAssetReference(value) {
  if (!isHttpUrl(value)) {
    return '';
  }

  try {
    const parsed = new URL(value);
    return decodeURIComponent(stripLeadingSlash(parsed.pathname));
  } catch {
    return '';
  }
}

function isAssetLikeRelativePath(value) {
  return /^(assets_v2|assets|generations|temp_images|video|ai_video)\//.test(value);
}

function parseAssetReference(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const trimmed = value.trim();
  const fromHttpUrl = isHttpUrl(trimmed);
  const normalized = fromHttpUrl
    ? extractUrlAssetReference(trimmed)
    : stripLeadingSlash(trimmed);
  if (!normalized || normalized.includes('..')) {
    return null;
  }
  if (fromHttpUrl && !isAssetLikeRelativePath(normalized)) {
    return null;
  }

  if (normalized.startsWith('assets_v2/')) {
    return {
      assetPrefix: 'assets_v2',
      relativePath: normalized.slice('assets_v2/'.length),
      publicPath: normalized,
    };
  }
  if (normalized.startsWith('assets/')) {
    return {
      assetPrefix: 'assets',
      relativePath: normalized.slice('assets/'.length),
      publicPath: normalized,
    };
  }

  return {
    assetPrefix: null,
    relativePath: normalized,
    publicPath: normalized,
  };
}

function publicAssetPathForRoot(assetsRoot, filePath) {
  const relativePath = path
    .relative(assetsRoot, filePath)
    .split(path.sep)
    .join('/');
  const normalizedRoot = normalizeDirectoryPath(assetsRoot).replace(/\\/g, '/');
  return normalizedRoot.endsWith('/assets_v2')
    ? path.posix.join('assets_v2', relativePath)
    : relativePath;
}

function isGeneratedOutroLabel(value) {
  return (
    value === 'server_generated_outro_image' ||
    value === 'server_generated_outro_background' ||
    value === 'server_generated_outro_qr' ||
    value === 'server_generated_outro_tile'
  );
}

function shouldSkipTileSource(value) {
  if (typeof value !== 'string') {
    return true;
  }
  const trimmed = value.trim();
  if (!trimmed || isGeneratedOutroLabel(trimmed)) {
    return true;
  }
  const normalized = trimmed.split('?')[0].split('#')[0].toLowerCase();
  return (
    normalized.includes('outro_focus') ||
    normalized.includes('video/outro/') ||
    /\.(mp4|mov|webm|m4v|avi|mkv)$/.test(normalized)
  );
}

function resolveLocalAssetPath(value, assetsRoots) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const trimmed = value.trim();
  if (isImageDataUrl(trimmed)) {
    return null;
  }

  if (path.isAbsolute(trimmed) && fs.existsSync(trimmed)) {
    return trimmed;
  }

  const assetReference = parseAssetReference(trimmed);
  if (!assetReference?.relativePath) {
    return null;
  }

  const candidateRoots = Array.isArray(assetsRoots) ? assetsRoots : [assetsRoots];
  for (const assetsRoot of candidateRoots) {
    const normalizedRoot = normalizeDirectoryPath(assetsRoot);
    if (!normalizedRoot) {
      continue;
    }
    const rootName = path.basename(normalizedRoot);
    if (assetReference.assetPrefix && rootName !== assetReference.assetPrefix) {
      continue;
    }
    const candidatePath = path.join(normalizedRoot, assetReference.relativePath);
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

async function resolveTileSourceValue(value, assetsRoots) {
  const source = typeof value === 'string' ? value.trim() : '';
  if (shouldSkipTileSource(source)) {
    return null;
  }
  if (isImageDataUrl(source)) {
    return source;
  }

  const localAssetPath = resolveLocalAssetPath(source, assetsRoots);
  if (localAssetPath) {
    const assetReference = parseAssetReference(source);
    return assetReference?.publicPath || localAssetPath;
  }
  if (isHttpUrl(source)) {
    return source;
  }

  return null;
}

async function resolveTileImageSource(item, assetsRoots) {
  if (!item || typeof item !== 'object' || item.type !== 'image') {
    return null;
  }

  const sourceCandidates = [
    item.src,
    item.effective_url,
    item.effectiveUrl,
    item.enhanced_url,
    item.enhancedUrl,
    item.image_url,
    item.imageUrl,
    item.url,
    item.image,
  ];

  for (const candidate of sourceCandidates) {
    const imageSource = await resolveTileSourceValue(candidate, assetsRoots);
    if (imageSource) {
      return imageSource;
    }
  }

  return null;
}

async function resolveTopTileImageSource(activeItemList, assetsRoots) {
  if (!Array.isArray(activeItemList)) {
    return null;
  }

  for (let index = activeItemList.length - 1; index >= 0; index -= 1) {
    const imageSource = await resolveTileImageSource(activeItemList[index], assetsRoots);
    if (imageSource) {
      return imageSource;
    }
  }

  return null;
}

function normalizeSourceKey(source, assetsRoots) {
  const localPath = resolveLocalAssetPath(source, assetsRoots);
  if (localPath) {
    return localPath;
  }
  return typeof source === 'string' ? source.trim() : '';
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
  computeCenterQrLayout(centerSize, centerInset);

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
  };
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
    .filter((rectItem) => rectItem.width > 0 && rectItem.height > 0)
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

async function loadTileImageBuffer(source, assetsRoots) {
  if (typeof source !== 'string' || !source.trim()) {
    throw new Error('Tile image source is empty.');
  }

  const trimmed = source.trim();
  const dataUrlBuffer = decodeImageDataUrl(trimmed);
  if (dataUrlBuffer) {
    return dataUrlBuffer;
  }
  const localAssetPath = resolveLocalAssetPath(trimmed, assetsRoots);
  if (localAssetPath) {
    return fs.promises.readFile(localAssetPath);
  }

  if (isHttpUrl(trimmed)) {
    const response = await axios.get(trimmed, {
      responseType: 'arraybuffer',
      timeout: MEDIA_DOWNLOAD_TIMEOUT_MS,
    });
    return Buffer.from(response.data);
  }

  throw new Error(`Unable to resolve tile image asset: ${trimmed}`);
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

async function renderTileBuffer({ source, width, height, assetsRoots }) {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const radius = Math.max(18, Math.round(Math.min(safeWidth, safeHeight) * 0.075));
  const imageBuffer = await loadTileImageBuffer(source, assetsRoots);
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

function getActiveItemList(layer) {
  const activeItemList = layer?.imageSession?.activeItemList;
  return Array.isArray(activeItemList) ? activeItemList : [];
}

function hasGeneratedOutroAssets(layer) {
  const activeItemList = getActiveItemList(layer);
  const hasBackground = activeItemList.some((item) => item?.image === 'server_generated_outro_background');
  const hasQr = activeItemList.some((item) => item?.image === 'server_generated_outro_qr');
  return hasBackground && hasQr;
}

function getLayerImageSourceCandidates(layer) {
  const imageSession = layer?.imageSession || {};
  return [
    imageSession.activeSelectedImage,
    imageSession.activeGeneratedImage,
    imageSession.activeOutpaintedImage,
    imageSession.selectedImage,
    imageSession.generatedImage,
    imageSession.outpaintedImage,
    imageSession.imageUrl,
    imageSession.image_url,
    imageSession.image,
    imageSession.url,
    layer?.activeSelectedImage,
    layer?.activeGeneratedImage,
    layer?.activeOutpaintedImage,
    layer?.selectedImage,
    layer?.generatedImage,
    layer?.outpaintedImage,
    layer?.imageUrl,
    layer?.image_url,
    layer?.image,
    layer?.sourceImageUrl,
    layer?.baseImageUrl,
    layer?.baseImage,
    layer?.initialImageUrl,
    layer?.inputImageUrl,
    layer?.thumbnailUrl,
    layer?.splashImage,
  ];
}

async function resolveLayerTileImageSource(layer, assetsRoots) {
  const imageSession = layer?.imageSession || {};
  const activeItemSource = await resolveTopTileImageSource(
    imageSession.activeItemList,
    assetsRoots,
  );
  if (activeItemSource) {
    return activeItemSource;
  }

  const previousActiveItemSource = await resolveTopTileImageSource(
    imageSession.previousActiveItemList,
    assetsRoots,
  );
  if (previousActiveItemSource) {
    return previousActiveItemSource;
  }

  for (const candidate of getLayerImageSourceCandidates(layer)) {
    const imageSource = await resolveTileSourceValue(candidate, assetsRoots);
    if (imageSource) {
      return imageSource;
    }
  }

  return null;
}

function findGeneratedOutroLayerIndex(sessionData) {
  const layers = Array.isArray(sessionData?.layers) ? sessionData.layers : [];
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const layer = layers[index];
    if (
      layer?.isGeneratedOutroLayer === true ||
      layer?.generatedOutroTilesPending === true ||
      (sessionData?.generatedOutroTilesPending === true && hasGeneratedOutroAssets(layer))
    ) {
      return index;
    }
  }
  return -1;
}

async function collectTileSources({ layers, outroLayerIndex, assetsRoots }) {
  const sources = [];
  const seen = new Set();

  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    if (sources.length >= MAX_OUTRO_TILES) {
      break;
    }
    if (layerIndex === outroLayerIndex) {
      continue;
    }

    const imageSource = await resolveLayerTileImageSource(layers[layerIndex], assetsRoots);
    if (!imageSource) {
      continue;
    }

    const sourceKey = normalizeSourceKey(imageSource, assetsRoots);
    if (!sourceKey || seen.has(sourceKey)) {
      continue;
    }

    seen.add(sourceKey);
    sources.push(imageSource);
  }

  return sources;
}

function isGeneratedOutroTileItem(item) {
  if (!item || typeof item !== 'object') {
    return false;
  }
  if (item.isGeneratedOutroTile === true) {
    return true;
  }
  const itemId = typeof item.id === 'string' ? item.id : '';
  if (itemId.startsWith('generated_outro_tile_')) {
    return true;
  }
  const src = typeof item.src === 'string' ? item.src : '';
  return src.includes('video/outro/') && path.basename(src).startsWith('outro_tile_');
}

function hasGeneratedOutroTileItems(layer) {
  return getActiveItemList(layer).some(isGeneratedOutroTileItem);
}

function removeExistingGeneratedTileItems(activeItemList) {
  return activeItemList.filter((item) => {
    return !isGeneratedOutroTileItem(item);
  });
}

async function buildGeneratedTileItems({
  sources,
  aspectRatio,
  assetsRoot,
  assetsRoots,
  sessionId,
}) {
  const layout = computeOutroLayout(aspectRatio);
  const tileRects = selectTileRects(layout, sources.length);
  const outroFolderPath = path.join(assetsRoot, 'video', 'outro', sessionId);
  await fs.promises.mkdir(outroFolderPath, { recursive: true });

  const tileItems = [];
  for (let index = 0; index < tileRects.length; index += 1) {
    const rect = insetRect(tileRects[index], layout.tileInset);
    let tileBuffer;
    try {
      tileBuffer = await renderTileBuffer({
        source: sources[index],
        width: rect.width,
        height: rect.height,
        assetsRoots,
      });
    } catch (error) {
      console.warn('[express_listener][generated_outro_tiles] failed to render tile source; skipping', {
        source: sources[index],
        error: error?.message || error,
      });
      continue;
    }
    const filePath = path.join(outroFolderPath, `outro_tile_${index + 1}.png`);
    await fs.promises.writeFile(filePath, tileBuffer);
    const src = publicAssetPathForRoot(assetsRoot, filePath);

    tileItems.push({
      id: `generated_outro_tile_${index + 1}`,
      type: 'image',
      image: 'server_generated_outro_tile',
      sourceImageUrl: sources[index],
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      src,
      is_base_image: false,
      isGeneratedOutroTile: true,
      animations: [],
    });
  }

  return tileItems;
}

function insertTileItemsIntoOutroLayer(outroLayer, tileItems) {
  if (!outroLayer.imageSession || typeof outroLayer.imageSession !== 'object') {
    outroLayer.imageSession = {};
  }

  const activeItemList = removeExistingGeneratedTileItems(
    Array.isArray(outroLayer.imageSession.activeItemList)
      ? outroLayer.imageSession.activeItemList
      : [],
  );
  const backgroundIndex = activeItemList.findIndex((item) => (
    item?.type === 'image' &&
    (item?.image === 'server_generated_outro_background' || item?.is_base_image === true)
  ));
  const insertIndex = backgroundIndex >= 0 ? backgroundIndex + 1 : 0;

  outroLayer.imageSession.activeItemList = [
    ...activeItemList.slice(0, insertIndex),
    ...tileItems,
    ...activeItemList.slice(insertIndex),
  ];
  return outroLayer;
}

export async function ensureGeneratedOutroTilesForSession(sessionDoc) {
  const sessionData = sessionDoc?.toObject
    ? sessionDoc.toObject({ depopulate: true })
    : sessionDoc;
  const sessionId = sessionData?._id?.toString?.() || sessionData?._id;
  if (!sessionId) {
    return { updated: false };
  }

  const layers = Array.isArray(sessionData?.layers) ? sessionData.layers : [];
  const outroLayerIndex = findGeneratedOutroLayerIndex(sessionData);
  if (outroLayerIndex < 0) {
    return { updated: false };
  }

  const outroLayer = layers[outroLayerIndex];
  const hasPendingTilePopulation =
    sessionData?.generatedOutroTilesPending === true ||
    outroLayer?.generatedOutroTilesPending === true;
  const generatedOutroTileCount = Number(
    sessionData?.generatedOutroTileCount ?? outroLayer?.generatedOutroTileCount ?? 0,
  );
  const shouldRepairCompletedEmptyTiles =
    !hasPendingTilePopulation &&
    generatedOutroTileCount === 0 &&
    !hasGeneratedOutroTileItems(outroLayer) &&
    (
      sessionData?.generatedOutroTilesCompleted === true ||
      outroLayer?.generatedOutroTilesCompleted === true
    ) &&
    (
      sessionData?.generatedOutroImage === true ||
      outroLayer?.generatedOutroImage === true ||
      outroLayer?.isGeneratedOutroLayer === true
    );
  const shouldPopulateTiles = hasPendingTilePopulation || shouldRepairCompletedEmptyTiles;
  if (!shouldPopulateTiles) {
    return { updated: false };
  }

  const assetsRoot = resolveAssetsRoot();
  const assetsRoots = resolveReadableAssetsRoots(assetsRoot);
  const sources = await collectTileSources({
    layers,
    outroLayerIndex,
    assetsRoots,
  });
  if (shouldRepairCompletedEmptyTiles && sources.length === 0) {
    return { updated: false };
  }

  const tileItems = await buildGeneratedTileItems({
    sources,
    aspectRatio: sessionData?.aspectRatio || '16:9',
    assetsRoot,
    assetsRoots,
    sessionId,
  });

  const updatedOutroLayer = insertTileItemsIntoOutroLayer(outroLayer, tileItems);
  updatedOutroLayer.generatedOutroTilesPending = false;
  updatedOutroLayer.generatedOutroTilesCompleted = true;
  updatedOutroLayer.generatedOutroTileCount = tileItems.length;
  updatedOutroLayer.frameGenerationPending = true;
  layers[outroLayerIndex] = updatedOutroLayer;

  await VideoSession.updateOne(
    { _id: sessionId },
    {
      $set: {
        layers,
        generatedOutroTilesPending: false,
        generatedOutroTilesCompleted: true,
        generatedOutroTileCount: tileItems.length,
        generatedOutroTilesCompletedAt: new Date(),
        frameGenerationPending: true,
        'expressGenerationStatus.outro_tile_generation': 'COMPLETED',
      },
    },
  );

  console.log('[express_listener][generated_outro_tiles] populated generated outro tiles', {
    sessionId,
    outroLayerIndex,
    tileCount: tileItems.length,
  });

  return { updated: true, tileCount: tileItems.length };
}
