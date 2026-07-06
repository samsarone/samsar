
import axios from 'axios';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

import { getCurrentEnvironment } from './Environment.js';


export async function saveRemoteFile(remoteImageUrl) {

  try {
    // Use axios to download the image as a stream
    const response = await axios({
      method: 'get',
      url: remoteImageUrl,
      responseType: 'arraybuffer'  // This ensures we get the data as a buffer
    });

    const buffer = Buffer.from(response.data);  // Convert the response data to a buffer

    // Check if the image is all black pixels
    const isBlackImage = await checkIfBlackImage(buffer);
    if (isBlackImage) {
      console.error("The generated image is completely black. Marking as failed.");
      throw new Error("Generated image is completely black.");
    }

    const randStr = Math.random().toString(36).substring(7);
    const imageName = `generation_${Date.now()}_${randStr}.png`;


    let baseAssetsPath;

    const currentEnv = getCurrentEnvironment();

    if (currentEnv === 'docker') {
      baseAssetsPath = '/assets/generations';  // Docker staging volume mount path
    } else {
      const pwd = process.cwd();
      baseAssetsPath = path.join(pwd, '..', 'samsar_processor', 'assets', 'generations');
    }

    const savePath = path.join(baseAssetsPath, imageName);
    
    // Ensure the directory exists
    await mkdir(path.dirname(savePath), { recursive: true });

    // Write the file to the filesystem
    await writeFile(savePath, buffer);

    return imageName;

  } catch (error) {
    console.error(`Error downloading or saving image: ${error.message}`);
    throw error;
  }
}


// Function to check if the image is all black
async function checkIfBlackImage(buffer) {
  try {
    const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });

    // Check if all pixels are black (i.e., RGB all zero)
    for (let i = 0; i < data.length; i += 3) {
      if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0) {
        return false; // At least one non-black pixel found
      }
    }

    return true; // All pixels are black
  } catch (error) {
    console.error(`Error checking image for black pixels: ${error.message}`);
    throw error;
  }
}




export async function resizeAndSaveRemoteFile(remoteImageUrl, newDimensions) {
  try {
    // Use axios to download the image as a stream
    const response = await axios({
      method: 'get',
      url: remoteImageUrl,
      responseType: 'arraybuffer'  // This ensures we get the data as a buffer
    });

    const buffer = Buffer.from(response.data);  // Convert the response data to a buffer

    // Use sharp to get metadata for image dimensions
    const imageMetadata = await sharp(buffer).metadata();

    const randStr = Math.random().toString(36).substring(7);
    const imageName = `generation_${Date.now()}_${randStr}.png`;

    const pwd = process.cwd();
    let savePath = path.join(pwd, '..', 'samsar_processor', 'assets', 'generations', imageName);

    if (process.env.CURRENT_ENV === 'staging' || process.env.CURRENT_ENV === 'docker') {
      savePath = path.join(process.env.SAMSAR_ASSETS_ROOT || '/assets', 'generations', imageName);
    }
    
    // Ensure the directory exists
    await mkdir(path.dirname(savePath), { recursive: true });

    // Resize the image using Sharp with high-quality algorithm
    const resizedBuffer = await sharp(buffer)
      .resize({
        width: newDimensions.width,
        height: newDimensions.height,
        fit: sharp.fit.cover,
        kernel: sharp.kernel.lanczos3, // High-quality resizing algorithm
      })
      .toFormat('png') // Ensure the output is in PNG format
      .toBuffer();

    // Write the resized image to the filesystem
    await writeFile(savePath, resizedBuffer);

    return imageName;

  } catch (error) {
    console.error(`Error downloading or saving image: ${error.message}`);
    throw error;
  }
}
