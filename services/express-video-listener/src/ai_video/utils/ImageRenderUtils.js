import fs from 'fs';
import path from 'path';
import { createCanvas, loadImage } from 'canvas';

import { getCanvasDimensionsForAspectRatio } from '../../utils/CanvasUtils.js';

function isRemoteUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

function getAssetRoot(folderName = 'assets_v2') {
  return process.env.CURRENT_ENV === 'staging' || process.env.CURRENT_ENV === 'docker'
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
    return fs.statSync(withoutQuery).isFile() ? withoutQuery : '';
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
  if (!SESSION_GATED_ASSET_FOLDERS.has(folderName)) {
    return [];
  }

  if (!maybeSessionId || maybeSessionId === sessionId) {
    return [];
  }

  return [
    path.join(root, folderName, sessionId, maybeSessionId, ...restParts),
  ];
}

function getOriginalImagePathFromSrc(src, sessionId = null) {
  const absoluteImagePath = getExistingAbsoluteImagePath(src);
  if (absoluteImagePath) {
    return absoluteImagePath;
  }

  const normalizedRef = normalizeLocalAssetReference(src);
  if (!normalizedRef) {
    return '';
  }

  const rawRef = typeof src === 'string' ? src.trim().replace(/^\/+/, '') : '';
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
    const originalImagePath = getOriginalImagePathFromSrc(imageRef, sessionId);
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

export function getBaseFrameImageForLayer(activeItemList, aspectRatio, sessionId = null) {


  const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);

  if (!Array.isArray(activeItemList) || activeItemList.length === 0) {
    return;
  }

  const topItem = activeItemList[activeItemList.length - 1];

  const isFullCanvasImage =
    topItem?.type === 'image' &&
    topItem.src &&
    topItem.x === 0 &&
    topItem.y === 0 &&
    topItem.width === canvasDimensions.width &&
    topItem.height === canvasDimensions.height;

  const shouldUseOriginalForAiVideo =
    topItem?.type === 'image' &&
    topItem.src &&
    activeItemList.length === 1 &&
    topItem.aiVideoSourceOriginal === true;

  if (isFullCanvasImage || shouldUseOriginalForAiVideo) {
    const originalImagePath = getOriginalImagePathFromSrc(getItemImageReference(topItem), sessionId);

    if (fs.existsSync(originalImagePath)) {
      return originalImagePath;
    }
  }

}

export function getInfiniteZoomFrameImageForImageSession(imageSession) {
  const originalImagePath = getOriginalImagePathFromSrc(imageSession.activeSelectedImage);
  
  if (fs.existsSync(originalImagePath)) {
    return originalImagePath;
  }
}

export function getSelectedFrameImageForImageSession(imageSession = {}, sessionId = null) {
  const imageReferences = [
    imageSession.activeGeneratedImage,
    imageSession.activeEditedImage,
    imageSession.activeImageRemoteLink,
    imageSession.activeSelectedImage,
  ].filter((value) => typeof value === 'string' && value.trim());

  for (const imageReference of imageReferences) {
    const originalImagePath = getOriginalImagePathFromSrc(imageReference, sessionId);
    if (fs.existsSync(originalImagePath)) {
      return originalImagePath;
    }
  }
}

export function getFrameImageForLayer(sessionId, layerId, aspectRatio, activeItemList) {
  return new Promise(async (resolve, reject) => {
    try {
      const pwd = process.cwd();
      const imageName = `${sessionId}_${layerId}.png`;
      let imageBaseFolder = path.join(pwd, '../', 'samsar_processor', 'assets', 'ai_video', 'temp');

      if (process.env.CURRENT_ENV === 'staging' || process.env.CURRENT_ENV === 'docker') {
        imageBaseFolder = '/assets/ai_video/temp';  // Docker staging volume mount path
      }
      

      // Ensure the base folder exists
      if (!fs.existsSync(imageBaseFolder)) {
        fs.mkdirSync(imageBaseFolder, { recursive: true });
      }

      const imagePath = path.join(imageBaseFolder, imageName);

      const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);

      const CANVAS_WIDTH = canvasDimensions.width;
      const CANVAS_HEIGHT = canvasDimensions.height;

      // Create a canvas and get its context
      const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
      const ctx = canvas.getContext('2d');

      // Optional: Fill the background with a color (e.g., white)
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      const normalizedActiveItemList = Array.isArray(activeItemList) ? activeItemList : [];
      if (normalizedActiveItemList.length === 0) {
        throw new Error(`Layer ${layerId} has no active items for AI video boundary frame rendering.`);
      }

      // Preload all images in activeItemList
      const images = {};
      const visibleImageItems = getVisibleImageItems(normalizedActiveItemList);
      let loadedImageCount = 0;
      await Promise.all(normalizedActiveItemList.map(async (item) => {
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
      for (const item of normalizedActiveItemList) {
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
