

import 'dotenv/config';
import fs from 'fs';
import sharp from 'sharp';

const decodeBase64Image = (dataString) => {
  const matches = dataString.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    throw new Error('Invalid input string');
  }
  return Buffer.from(matches[2], 'base64');
};

const isDataUrl = (value) => typeof value === 'string' && value.trim().startsWith('data:');

const collectEditImageDataUrls = (payload = {}) => {
  const urls = [];
  const seen = new Set();

  const pushIfData = (value) => {
    if (!isDataUrl(value)) {
      return;
    }
    const trimmed = value.trim();
    if (seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    urls.push(trimmed);
  };

  if (payload.image) {
    pushIfData(payload.image);
  }

  if (Array.isArray(payload.image_urls)) {
    payload.image_urls.forEach((item) => pushIfData(item));
  }

  if (Array.isArray(payload.input_image_urls)) {
    payload.input_image_urls.forEach((item) => pushIfData(item));
  }

  if (Array.isArray(payload.imageUrls)) {
    payload.imageUrls.forEach((item) => pushIfData(item));
  }

  if (Array.isArray(payload.inputImageUrls)) {
    payload.inputImageUrls.forEach((item) => pushIfData(item));
  }

  return urls;
};

const getAssetsV2Root = () => {
  if (process.env.CURRENT_ENV === 'staging' || process.env.CURRENT_ENV === 'docker') {
    return process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2';
  }

  return './assets_v2';
};

const getSessionScopedFolder = (baseFolder, sessionRef) => {
  const normalizedSessionRef = String(sessionRef || 'unknown')
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${getAssetsV2Root().replace(/\/+$/, '')}/${baseFolder}/${normalizedSessionRef}/`;
};

export async function generateTwitterOgImage(payload) {
  const RESIZE_WIDTH = 675;  // Set new resize dimensions
  const RESIZE_HEIGHT = 675;

  const CANVAS_WIDTH = 1200;  // Set canvas dimensions
  const CANVAS_HEIGHT = 675;

  const imageData = decodeBase64Image(payload.image);
  const publicationId = payload.publicationId;
  const sessionRef = payload.sessionId || payload.videoSessionId || payload._id || publicationId || 'twitter';
  const imageBaseDirectory = getSessionScopedFolder('twitter', sessionRef);
  if (!fs.existsSync(imageBaseDirectory)) {
    fs.mkdirSync(imageBaseDirectory, { recursive: true });
  }
  const imageName = `${publicationId}.png`;

  // Resize the image to the new dimensions
  const resizedBuffer = await sharp(imageData)
    .resize(RESIZE_WIDTH, RESIZE_HEIGHT)
    .toBuffer();

  // Extend the canvas and center the image
  const extendedBuffer = await sharp(resizedBuffer)
    .extend({
      top: 0,
      bottom: 0,
      left: Math.round((CANVAS_WIDTH - RESIZE_WIDTH) / 2),  // Calculate and round left offset to center the image
      right: Math.round((CANVAS_WIDTH - RESIZE_WIDTH) / 2),
      background: { r: 31, g: 41, b: 55, alpha: 1 }  // Use a transparent background
    })
    .toBuffer();

  const imageFileName = `${imageBaseDirectory}${imageName}`;
  fs.writeFileSync(imageFileName, extendedBuffer);
  return imageFileName;
}

export async function uploadImageToFileSystem(imageFile, imageName, sessionId = 'unknown') {

  const imageData = decodeBase64Image(imageFile);
  const imageBaseDirectory = getSessionScopedFolder('intermediates', sessionId);
  if (!fs.existsSync(imageBaseDirectory)) {
    fs.mkdirSync(imageBaseDirectory, { recursive: true });
  }
  const imageFileName = `${imageBaseDirectory}${imageName}`;
  fs.writeFileSync(imageFileName, imageData);
  return imageFileName;

}

export async function uploadTempEditImageToFileSystem(payload) {
  const imageDataList = collectEditImageDataUrls(payload);
  const hasPrimaryImage = isDataUrl(payload?.image);

  let maskImageData;
  let maskImageName;

  if (payload.maskImage) {
    maskImageData = decodeBase64Image(payload.maskImage);
  }

  const sessionRef = payload.sessionId || payload.videoSessionId || payload._id || 'edit';
  const imageBaseDirectory = getSessionScopedFolder('temp', sessionRef);
  if (!fs.existsSync(imageBaseDirectory)) {
    fs.mkdirSync(imageBaseDirectory, { recursive: true });
  }
  const dateNowString = Date.now().toString();

  const imageNames = imageDataList.map((imageData, index) => {
    const suffix = index === 0 ? '' : `_${index}`;
    const imageName = `${sessionRef}_edit_${dateNowString}${suffix}.png`;
    const imageFileName = `${imageBaseDirectory}${imageName}`;
    fs.writeFileSync(imageFileName, decodeBase64Image(imageData));
    return imageName;
  });

  if (maskImageData) {
    maskImageName = `${sessionRef}_mask_${dateNowString}.png`;
    const maskImageFileName = `${imageBaseDirectory}${maskImageName}`;
    fs.writeFileSync(maskImageFileName, maskImageData);
  }

  return {
    image: hasPrimaryImage ? imageNames[0] : undefined,
    images: imageNames,
    imageDataList,
    maskImage: maskImageName,
  };
}
