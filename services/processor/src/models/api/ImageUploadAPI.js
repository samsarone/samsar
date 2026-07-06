import crypto from 'crypto';
import { uploadImageDataUrlToCDN } from '../AWS.js';

const IMAGE_DATA_URL_PATTERN = /^data:image\/[a-zA-Z0-9.+-]+;base64,/;
const DEFAULT_EXTENSION = 'png';
const MIME_EXTENSION_MAP = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/heic': 'jpg',
  'image/heif': 'jpg',
  'image/heic-sequence': 'jpg',
  'image/heif-sequence': 'jpg',
};

const resolveExtension = (imageDataUrl) => {
  if (typeof imageDataUrl !== 'string') {
    return DEFAULT_EXTENSION;
  }
  const match = imageDataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
  if (!match) {
    return DEFAULT_EXTENSION;
  }
  const mimeType = match[1].toLowerCase();
  return MIME_EXTENSION_MAP[mimeType] || mimeType.split('/')[1] || DEFAULT_EXTENSION;
};

const buildImageName = (userId, index, imageDataUrl) => {
  const safeUserId = typeof userId === 'string' && userId.trim().length > 0
    ? userId.trim().replace(/[^a-zA-Z0-9_-]/g, '')
    : 'anon';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const randomSuffix = crypto.randomBytes(6).toString('hex');
  const extension = resolveExtension(imageDataUrl);
  return `${safeUserId}_${timestamp}_${index + 1}_${randomSuffix}.${extension}`;
};

export async function uploadImageDataList(userId, imageDataList) {
  if (!Array.isArray(imageDataList) || imageDataList.length === 0) {
    const error = new Error('image_data must be a non-empty array of strings.');
    error.status = 400;
    throw error;
  }

  const normalized = imageDataList.map((imageData) =>
    typeof imageData === 'string' ? imageData.trim() : ''
  );

  const invalidIndex = normalized.findIndex((imageData) => !IMAGE_DATA_URL_PATTERN.test(imageData));
  if (invalidIndex !== -1) {
    const error = new Error('image_data must contain valid image data URLs.');
    error.status = 400;
    throw error;
  }

  const uploads = normalized.map((imageData, index) => {
    const imageName = buildImageName(userId, index, imageData);
    return uploadImageDataUrlToCDN(imageData, imageName);
  });

  return Promise.all(uploads);
}
