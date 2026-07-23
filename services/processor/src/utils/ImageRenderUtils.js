import fs from 'fs';
import path from 'path';
import { createCanvas, loadImage } from 'canvas';
import { getCanvasDimensionsForAspectRatio } from './CanvasUtils.js';
import { isContainerRuntime } from './EnvironmentUtils.js';

function isRemoteUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

function getAssetRoot(folderName = 'assets_v2') {
  const configuredRoot = folderName === 'assets_v2'
    ? process.env.SAMSAR_ASSETS_V2_ROOT
    : process.env.SAMSAR_ASSETS_ROOT;
  if (typeof configuredRoot === 'string' && configuredRoot.trim()) {
    return path.resolve(configuredRoot.trim());
  }
  return isContainerRuntime()
    ? `/${folderName}`
    : path.join(process.cwd(), '../', 'samsar_processor', folderName);
}

const SESSION_GATED_ASSET_FOLDERS = new Set([
  'generations',
  'intermediates',
  'temp',
  'twitter',
]);

function getItemImageReference(item = {}) {
  return (
    (typeof item.src === 'string' && item.src.trim()) ||
    (typeof item.image === 'string' && item.image.trim()) ||
    (typeof item.image_url === 'string' && item.image_url.trim()) ||
    (typeof item.imageUrl === 'string' && item.imageUrl.trim()) ||
    (typeof item.url === 'string' && item.url.trim()) ||
    (typeof item.remoteURL === 'string' && item.remoteURL.trim()) ||
    (typeof item.remoteUrl === 'string' && item.remoteUrl.trim()) ||
    (typeof item.remote_url === 'string' && item.remote_url.trim()) ||
    ''
  );
}

function normalizeLocalAssetReference(ref) {
  if (typeof ref !== 'string') {
    return '';
  }
  const withoutQuery = ref.trim().split('?')[0];
  if (!withoutQuery) {
    return '';
  }
  if (isRemoteUrl(withoutQuery)) {
    try {
      return decodeURIComponent(new URL(withoutQuery).pathname)
        .replace(/^\/+/, '')
        .replace(/^assets_v2\/+/, '')
        .replace(/^assets\/+/, '');
    } catch {
      return '';
    }
  }
  return withoutQuery
    .replace(/^\/+/, '')
    .replace(/^assets_v2\/+/, '')
    .replace(/^assets\/+/, '');
}

function getExistingAbsoluteImagePath(ref) {
  if (typeof ref !== 'string' || isRemoteUrl(ref)) {
    return '';
  }

  const withoutQuery = ref.trim().split('?')[0].split('#')[0];
  if (!withoutQuery || !path.isAbsolute(withoutQuery)) {
    return '';
  }

  try {
    if (!fs.statSync(withoutQuery).isFile()) return '';
    const realCandidate = fs.realpathSync(withoutQuery);
    const isContained = [getAssetRoot('assets_v2'), getAssetRoot('assets')].some((root) => {
      if (!fs.existsSync(root)) return false;
      const realRoot = fs.realpathSync(root);
      const relativePath = path.relative(realRoot, realCandidate);
      return relativePath === '' ||
        (!path.isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`));
    });
    return isContained ? realCandidate : '';
  } catch {
    return '';
  }
}

function getSessionGatedAssetCandidates(root, normalizedRef, sessionId) {
  if (!sessionId || !normalizedRef) {
    return [];
  }

  const pathParts = normalizedRef.split('/').filter(Boolean);
  const [folderName, maybeSessionId, ...restParts] = pathParts;
  if (!SESSION_GATED_ASSET_FOLDERS.has(folderName) || !maybeSessionId || maybeSessionId === sessionId) {
    return [];
  }

  return [
    path.join(root, folderName, sessionId, maybeSessionId, ...restParts),
  ];
}

function getOriginalImagePathFromRef(ref, sessionId = null) {
  const absoluteImagePath = getExistingAbsoluteImagePath(ref);
  if (absoluteImagePath) {
    return absoluteImagePath;
  }

  const normalizedRef = normalizeLocalAssetReference(ref);
  if (!normalizedRef) {
    return '';
  }
  const rawRef = typeof ref === 'string' ? ref.trim().replace(/^\/+/, '') : '';
  const roots = rawRef.startsWith('assets_v2/')
    ? [getAssetRoot('assets_v2')]
    : [getAssetRoot('assets_v2'), getAssetRoot('assets')];
  const candidates = [];

  for (const root of roots) {
    candidates.push(...getSessionGatedAssetCandidates(root, normalizedRef, sessionId));
    candidates.push(path.join(root, normalizedRef));
  }

  for (const candidatePath of candidates) {
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return candidates[0] || path.join(roots[0], normalizedRef);
}

async function loadCanvasImageFromItem(item, sessionId = null) {
  const imageRef = getItemImageReference(item);
  if (!imageRef) {
    return null;
  }

  try {
    const originalImagePath = getOriginalImagePathFromRef(imageRef, sessionId);
    if (originalImagePath && fs.existsSync(originalImagePath)) {
      return await loadImage(originalImagePath);
    }

    if (isRemoteUrl(imageRef)) {
      return await loadImage(imageRef);
    }
  } catch {
    return null;
  }

  return null;
}

function getVisibleImageItems(activeItemList = []) {
  return Array.isArray(activeItemList)
    ? activeItemList.filter((item) => item?.type === 'image' && item?.isHidden !== true && getItemImageReference(item))
    : [];
}

export function getRenderableItemListForLayer(layer = {}) {
  const activeItemList = Array.isArray(layer?.imageSession?.activeItemList)
    ? layer.imageSession.activeItemList
    : [];
  const previousActiveItemList = Array.isArray(layer?.imageSession?.previousActiveItemList)
    ? layer.imageSession.previousActiveItemList
    : [];

  if (getVisibleImageItems(activeItemList).length > 0 || getVisibleImageItems(previousActiveItemList).length === 0) {
    return activeItemList;
  }

  return previousActiveItemList;
}

export function getBaseFrameImageForLayer(activeItemList, aspectRatio, sessionId = null) {


  const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);

  let isCombineLayersNeeded = false;

  let topItem;

  for (let i = activeItemList.length - 1; i >= 0; i--) {
    const item = activeItemList[i];
    if (item.type === 'image') {
      topItem = item;
      break;
    }
  }
 // const topItem = activeItemList[activeItemList.length - 1];

  const topItemImageRef = getItemImageReference(topItem);
  if (topItem && topItem.type === 'image' && topItemImageRef && (
    (topItem.x === 0 && topItem.y === 0 &&
    topItem.width === canvasDimensions.width &&
    topItem.height === canvasDimensions.height) || (
      activeItemList.length === 1
    )
  )) {

    const originalImagePath = getOriginalImagePathFromRef(topItemImageRef, sessionId);


    if (fs.existsSync(originalImagePath)) {
      return originalImagePath;
    }


  } 


}

export function getAiVideoFrameImageForLayer(layer, sessionId = null) {
  const { aiLayerStartFrame } = layer;
  if (aiLayerStartFrame) {
    const aiLayerStartFramePath = getOriginalImagePathFromRef(aiLayerStartFrame, sessionId);
    
    if (fs.existsSync(aiLayerStartFramePath)) {
      return aiLayerStartFramePath;
    }
  }
}

export function getFrameImageForLayer(sessionId, layerId, aspectRatio, activeItemList) {
  return new Promise(async (resolve, reject) => {
    try {
      const pwd = process.cwd();
      const imageName = `${sessionId}_${layerId}.png`;
      let imageBaseFolder = path.join(pwd, '../', 'samsar_processor', 'assets_v2', 'ai_video', 'temp');

      if (process.env.SAMSAR_ASSETS_V2_ROOT || isContainerRuntime()) {
        imageBaseFolder = path.join(process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2', 'ai_video', 'temp');
      }

      // Ensure the base folder exists
      if (!fs.existsSync(imageBaseFolder)) {
        fs.mkdirSync(imageBaseFolder, { recursive: true });
      }

      const imagePath = path.join(imageBaseFolder, imageName);

      const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);

      const CANVAS_WIDTH = canvasDimensions.width;
      const CANVAS_HEIGHT = canvasDimensions.height;
      const renderableItems = Array.isArray(activeItemList)
        ? activeItemList.filter((item) => item && item.isHidden !== true)
        : [];

      if (renderableItems.length === 0) {
        resolve(null);
        return;
      }

      // Create a canvas and get its context
      const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
      const ctx = canvas.getContext('2d');

      // Optional: Fill the background with a color (e.g., white)
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Preload all images in activeItemList
      const images = {};
      const visibleImageItems = getVisibleImageItems(activeItemList);
      let loadedImageCount = 0;
      await Promise.all(activeItemList.map(async (item) => {
        if (item.type === 'image' && item.isHidden !== true) {
          const imageRef = getItemImageReference(item);
          if (!imageRef) {
            return;
          }
          const image = await loadCanvasImageFromItem(item, sessionId);
          if (image) {
            images[imageRef] = image;
            loadedImageCount += 1;
          }
        }
      }));

      if (visibleImageItems.length > 0 && loadedImageCount === 0) {
        throw new Error(`Unable to load any source images for layer ${layerId}; refusing to render a blank AI video boundary frame.`);
      }

      // Render each active item onto the canvas
      for (const item of renderableItems) {
        if (item) {
          await renderActiveItem(ctx, item, images);
        }
      }

      // Convert the canvas to a buffer
      const buffer = canvas.toBuffer('image/png');

      // Save the buffer to the specified path
      fs.writeFileSync(imagePath, buffer);

      // Resolve the promise with the image path
      resolve(imagePath);
    } catch (error) {
      console.error('Error in getFrameImageForLayer:', error);
      reject(error);
    }
  });
}

export async function renderActiveItem(ctx, item, images) {
  const { type } = item;

  switch (type) {
    case 'image':
      await renderImage(ctx, item, images);
      break;
    case 'text':
      renderText(ctx, item);
      break;
    case 'shape':
      renderShape(ctx, item);
      break;
    // Add other cases as needed
    default:
      break;
  }
}

async function renderImage(ctx, item, images) {
  const { x, y, width, height } = item;
  const imageRef = getItemImageReference(item);
  const img = images[imageRef];
  if (img) {
    ctx.drawImage(img, x, y, width, height);
  }
}

function renderText(ctx, item) {
  const { x, y, text, fontSize = 20, fontFamily = 'Montserrat', fillColor = '#000000', textAlign = 'left' } = item;

  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.fillStyle = fillColor;
  ctx.textAlign = textAlign;
  ctx.fillText(text, x, y);
}

function renderShape(ctx, item) {
  const { shape, x, y, width, height, radius = 0, fillColor = '#FF0000', strokeColor, strokeWidth } = item;

  ctx.fillStyle = fillColor;
  ctx.beginPath();

  switch (shape) {
    case 'rectangle':
      ctx.rect(x, y, width, height);
      break;
    case 'circle':
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      break;
    // Add other shapes as needed
    default:
      break;
  }

  ctx.fill();

  if (strokeColor && strokeWidth) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.stroke();
  }
}
