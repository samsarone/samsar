import axios from 'axios';
import sharp from 'sharp';
import path from 'path';
import {
  access,
  copyFile,
  mkdir,
  readFile,
  writeFile,
} from 'fs/promises';
import { getCurrentEnvironment } from '../utils/Environment.js';
import { getCanvasDimensionsForAspectRatio } from './CanvasUtils.js';

const DOCKER_GENERATIONS_PATH = path.join(process.env.SAMSAR_ASSETS_ROOT || '/assets', 'generations');
const LOCAL_GENERATIONS_PATH = path.join(process.cwd(), '..', 'samsar_processor', 'assets', 'generations');
const DOCKER_ASSETS_V2_PATH = process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2';
const LOCAL_ASSETS_V2_PATH = path.join(process.cwd(), '..', 'samsar_processor', 'assets_v2');

function resolveLocalImageBasePath() {
  const currentEnv = getCurrentEnvironment();
  return currentEnv === 'docker' || currentEnv === 'staging'
    ? DOCKER_GENERATIONS_PATH
    : LOCAL_GENERATIONS_PATH;
}

function getAssetsV2Root() {
  const currentEnv = getCurrentEnvironment();
  return currentEnv === 'docker' || currentEnv === 'staging'
    ? DOCKER_ASSETS_V2_PATH
    : LOCAL_ASSETS_V2_PATH;
}

function normalizeReference(imageRef) {
  if (!imageRef) {
    return null;
  }
  if (typeof imageRef !== 'string') {
    return null;
  }
  return imageRef.trim();
}

export function getImageNameFromReference(imageRef) {
  const normalized = normalizeReference(imageRef);
  if (!normalized) {
    return null;
  }
  const withoutQuery = normalized.split('?')[0];
  return path.basename(withoutQuery);
}

export function getRemoteImageUrlFromReference(imageRef) {
  const normalized = normalizeReference(imageRef);
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
    return normalized;
  }
  if (normalized.startsWith('/generations/')) {
    return normalized;
  }
  if (normalized.startsWith('/assets_v2/') || normalized.startsWith('assets_v2/')) {
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
  }
  const imageName = getImageNameFromReference(normalized);
  if (!imageName) {
    return null;
  }
  return `/generations/${imageName}`;
}

function getCandidateImageReferences(payload) {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const refs = [];

  const scalarKeys = ['image', 'image_url', 'imageUrl', 'imageRef', 'inputImage'];
  for (const key of scalarKeys) {
    if (payload[key]) {
      refs.push(payload[key]);
    }
  }

  if (Array.isArray(payload.image_urls) && payload.image_urls.length > 0) {
    refs.push(payload.image_urls[0]);
  }
  if (Array.isArray(payload.imageUrls) && payload.imageUrls.length > 0) {
    refs.push(payload.imageUrls[0]);
  }

  return refs.map((ref) => normalizeReference(ref)).filter(Boolean);
}

export function getImageReferenceFromRequest(payload) {
  const references = getCandidateImageReferences(payload);
  return references.length ? references[0] : null;
}

function resolveLocalImagePath(imageRef) {
  const normalized = normalizeReference(imageRef);
  const imageName = getImageNameFromReference(normalized);
  if (!normalized || !imageName) {
    return null;
  }
  const normalizedRelative = normalized.replace(/^\/+/, '');
  if (normalizedRelative.startsWith('assets_v2/')) {
    return path.join(getAssetsV2Root(), normalizedRelative.replace(/^assets_v2\//, ''));
  }
  return path.join(resolveLocalImageBasePath(), imageName);
}

function getLocalAssetsRoot() {
  return path.dirname(resolveLocalImageBasePath());
}

function isRemoteUrl(url) {
  return typeof url === 'string' && /^(https?:)\/\//.test(url);
}

function createGenerationImageName(extension = 'png') {
  const randStr = Math.random().toString(36).substring(7);
  const safeExt = extension ? extension.replace(/^\./, '') : 'png';
  return `generation_${Date.now()}_${randStr}.${safeExt}`;
}

export async function persistImageToLocalAssets(imageRef, options = {}) {
  const normalized = normalizeReference(imageRef);
  if (!normalized) {
    return null;
  }

  const {
    forceNewName = false,
    preferredExtension = null,
    convertToPng = false,
  } = options;

  const preferredExt = preferredExtension ? preferredExtension.replace(/^\./, '') : null;

  let imageName = getImageNameFromReference(normalized);
  const currentExt = path.extname(imageName || '');
  const targetExt = preferredExt || (currentExt ? currentExt.replace('.', '') : 'png');
  const needsGeneratedName = forceNewName || !imageName || (!currentExt && !!preferredExt);

  if (needsGeneratedName) {
    imageName = createGenerationImageName(targetExt);
  } else if (!currentExt && targetExt) {
    imageName = `${imageName}.${targetExt}`;
  }

  const generationDir = resolveLocalImageBasePath();
  const targetPath = path.join(generationDir, imageName);

  try {
    await access(targetPath);
    if (!forceNewName) {
      const relativePath = path
        .relative(getLocalAssetsRoot(), targetPath)
        .replace(/\\/g, '/');
      const normalizedRelative = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
      return normalizedRelative;
    }
  } catch {
    // Continue and attempt to write the file below
  }

  try {
    await mkdir(generationDir, { recursive: true });
  } catch (e) {
    console.error('Unable to create generations directory', e);
  }

  let buffer = null;
  let localSourcePath = null;

  try {
    if (isRemoteUrl(normalized)) {
      buffer = await loadRemoteImageBuffer(normalized);
    } else {
      const normalizedRelative = normalized.replace(/^\/+/, '');
      const candidatePath = normalizedRelative.startsWith('assets_v2/')
        ? path.join(getAssetsV2Root(), normalizedRelative.replace(/^assets_v2\//, ''))
        : path.join(getLocalAssetsRoot(), normalizedRelative);
      try {
        await access(candidatePath);
        localSourcePath = candidatePath;
        buffer = await readFile(candidatePath);
      } catch {
        const remoteUrl = getRemoteImageUrlFromReference(normalized);
        if (isRemoteUrl(remoteUrl)) {
          buffer = await loadRemoteImageBuffer(remoteUrl);
        }
      }
    }
  } catch (error) {
    console.error('Failed to load image buffer for persistence', error);
  }

  const shouldConvertToPng = convertToPng || targetExt === 'png';

  if (!buffer && localSourcePath && !shouldConvertToPng) {
    try {
      await copyFile(localSourcePath, targetPath);
    } catch (error) {
      console.error('Failed to copy local image for persistence', error);
    }
  } else if (buffer) {
    try {
      const outputBuffer = shouldConvertToPng ? await sharp(buffer).png().toBuffer() : buffer;
      await writeFile(targetPath, outputBuffer);
    } catch (error) {
      console.error('Failed to persist upscale image', error);
    }
  }

  try {
    await access(targetPath);
  } catch {
    return null;
  }

  const relativePath = path
    .relative(getLocalAssetsRoot(), targetPath)
    .replace(/\\/g, '/');
  const normalizedRelative = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
  return normalizedRelative;
}

async function loadLocalImageBuffer(imageRef) {
  const localPath = resolveLocalImagePath(imageRef);
  if (!localPath) {
    return null;
  }
  try {
    return await readFile(localPath);
  } catch {
    return null;
  }
}

async function loadRemoteImageBuffer(imageRef) {
  try {
    const response = await axios.get(imageRef, { responseType: 'arraybuffer' });
    return Buffer.from(response.data);
  } catch {
    return null;
  }
}

async function loadImageBufferFromReference(imageRef) {
  const normalized = normalizeReference(imageRef);
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
    return await loadRemoteImageBuffer(normalized);
  }
  const localBuffer = await loadLocalImageBuffer(normalized);
  if (localBuffer) {
    return localBuffer;
  }
  return await loadRemoteImageBuffer(normalized);
}

export async function getImageDimensionsFromReference(imageRef) {
  const buffer = await loadImageBufferFromReference(imageRef);
  if (!buffer) {
    return null;
  }
  try {
    const metadata = await sharp(buffer).metadata();
    if (!metadata || !metadata.width || !metadata.height) {
      return null;
    }
    return {
      width: metadata.width,
      height: metadata.height,
    };
  } catch {
    return null;
  }
}

export async function needsImageEnhancement(imageRef, aspectRatio = '1:1') {
  const dimensions = await getImageDimensionsFromReference(imageRef);
  if (!dimensions) {
    return true; // unable to inspect, default to enhancing
  }
  const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio || '1:1');
  return dimensions.width < canvasDimensions.width || dimensions.height < canvasDimensions.height;
}
