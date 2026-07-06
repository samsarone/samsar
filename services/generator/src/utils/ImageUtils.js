
import * as fs from 'fs';
import path from "path";
import { mkdir, writeFile } from "fs/promises";
import sharp from "sharp";



export function getTargetDimensions(aspectRatio) {
  let targetWidth = 1024;
  let targetHeight = 1024;

  if (aspectRatio === '16:9') {
    targetWidth = 1792;
    targetHeight = 1024;
  } else if (aspectRatio === '9:16') {
    targetWidth = 1024;
    targetHeight = 1792;
  }

  return { width: targetWidth, height: targetHeight };
}


export function getImageSizeForAspectRation(aspectRatio) {
  if (aspectRatio === '1:1') {
    return 'square';
  } else if (aspectRatio === '16:9') {
    return 'landscape_16_9';
  } else if (aspectRatio === '9:16') {
    return 'portrait_16_9';
  }
}


// ⬅️ add or overwrite this helper so it receives the buffer too
export async function resizeImageToTargetDimensions(imageBuffer, targets) {
  return await sharp(imageBuffer)
    .resize(targets.width, targets.height, {
      fit: 'cover',        // fill & crop if necessary
      position: 'center',
    })
    .toFormat('png')
    .toBuffer();
}


