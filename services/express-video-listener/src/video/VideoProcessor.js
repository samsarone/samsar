import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import ffmpeg from 'fluent-ffmpeg';
import { promisify } from 'util';
import stream from 'stream';

import { resolveExpressVideoFfmpegThreads } from '../utils/FfmpegResources.js';
import { getFramesPerSecondFromValue } from '../utils/FpsUtils.js';
import { usesLocalAssetStorage } from '../utils/EnvironmentUtils.js';

const pipeline = promisify(stream.pipeline);

export async function getVideoDuration(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err);
      } else {
        const duration = metadata.format.duration;
        const durationInSeconds = Math.floor(duration * 100) / 100;

        
        resolve(durationInSeconds);
      }
    });
  });
}

/**
 * Downloads a file from a URL to a specified path.
 * @param {string} url - The URL of the file to download.
 * @param {string} dest - The destination file path.
 */
async function downloadVideo(url, dest) {
  const response = await axios({
    method: 'GET',
    url,
    responseType: 'stream',
  });

  await fs.ensureDir(path.dirname(dest));
  await pipeline(response.data, fs.createWriteStream(dest));
}

/**
 * Processes a video by downloading it and extracting frames.
 * @param {string} videoUrl - The remote URL of the video to process.
 * @param {string} sessionId - The session ID for organizing output.
 * @param {string} layerId - The layer ID for organizing output.
 */
export async function downloadVideoFromRemote(videoUrl, sessionId, layerId) {
  const currentDir = process.cwd();
  let outputFolder = path.join(
    currentDir,
    '..',
    'samsar_processor',
    'assets',
    'ai_video',
    'generations',
    sessionId,
    layerId
  );

  if (usesLocalAssetStorage()) {
    outputFolder = path.join(process.env.SAMSAR_ASSETS_ROOT || '/assets', 'ai_video', 'generations', sessionId, layerId); // Docker staging volume mount path
  }

  if (!fs.existsSync(outputFolder)) {
    fs.mkdirSync(outputFolder, { recursive: true });
  }

  const videoFolderPath = path.join(outputFolder, `video_${Date.now()}.mp4`);

  try {

    await downloadVideo(videoUrl, videoFolderPath);


    return videoFolderPath;
  } catch (error) {
    throw error;
  }
}


export async function processVideoAsFrames(videoPath, sessionId, layerId, canvasDimensions, framesPerSecond) {
  const newFrameWidth = canvasDimensions.width;
  const newFrameHeight = canvasDimensions.height;
  const effectiveFramesPerSecond = getFramesPerSecondFromValue(framesPerSecond);


  const currentDir = process.cwd();
  let outputFolder = path.join(
    currentDir,
    '..',
    'samsar_processor',
    'assets',
    'ai_video',
    'frames',
    sessionId,
    layerId
  );

  if (usesLocalAssetStorage()) {
    outputFolder = path.join(process.env.SAMSAR_ASSETS_ROOT || '/assets', 'ai_video', 'frames', sessionId, layerId); // Docker staging volume mount path
  }
  
  // Ensure the output directory exists
  if (!fs.existsSync(outputFolder)) {
    fs.mkdirSync(outputFolder, { recursive: true });
  }

  try {
    await extractFrames(videoPath, outputFolder, newFrameWidth, newFrameHeight, effectiveFramesPerSecond);


    // Read the number of frame files in the output directory
    const files = await fs.readdir(outputFolder);
    const pngFiles = files.filter(file => path.extname(file).toLowerCase() === '.png');
    const numFiles = pngFiles.length;

    if (numFiles === 0) {
      throw new Error('No frames were extracted from the video.');
    }

    // Calculate the duration in seconds based on session FPS
    const durationInSeconds = Math.floor((numFiles / effectiveFramesPerSecond) * 100) / 100; // Rounded to 2 decimal places


    // Determine the last frame's filename
    const lastFrameNumber = numFiles - 1;
    const lastFramePath = path.join(outputFolder, `${lastFrameNumber}.png`);

    // Verify that the last frame exists
    if (!fs.existsSync(lastFramePath)) {
      throw new Error(`Last frame not found at path: ${lastFramePath}`);
    }

    // Return the result as an object
    return {
      lastFrame: lastFramePath,
      duration: durationInSeconds,
    };
  } catch (error) {
    throw error;
  }
}


function extractFrames(videoPath, outputFolder, newFrameWidth, newFrameHeight, framesPerSecond) {
  const ffmpegThreadValue = `${resolveExpressVideoFfmpegThreads()}`;
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .inputOptions([
        '-threads', ffmpegThreadValue,
      ])
      .outputOptions([
        '-r', `${framesPerSecond}`,
        '-start_number', '0',
        '-filter_threads', ffmpegThreadValue,
        '-threads', ffmpegThreadValue,
        '-vf', `scale=${newFrameWidth}:${newFrameHeight}`,
        '-sws_flags', 'lanczos',
      ])
      .output(path.join(outputFolder, '%d.png'))
      .on('end', () => {
        resolve();
      })
      .on('error', (err) => {
        reject(err);
      })
      .run();
  });
}
