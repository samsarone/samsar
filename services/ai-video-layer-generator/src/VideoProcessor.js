import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import { promisify } from 'util';
import stream from 'stream';

import { resolveCpuCeiling } from './utils/CpuResources.js';
import { getFramesPerSecondFromValue } from './utils/FpsUtils.js';
import { usesLocalAssetStorage } from './utils/Environment.js';

// utils/FFmpegUtils.js  (new file)
import { spawn } from 'child_process';



const pipeline = promisify(stream.pipeline);

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

function resolveAiVideoFfmpegThreads() {
  return resolveCpuCeiling({
    defaultCeiling: 2,
    envNames: [
      'SAMSAR_AI_VIDEO_MAX_FFMPEG_THREADS',
      'SAMSAR_MAX_FFMPEG_THREADS',
    ],
  });
}

function getAssetsV2Root() {
  if (process.env.SAMSAR_ASSETS_V2_ROOT) {
    return process.env.SAMSAR_ASSETS_V2_ROOT;
  }

  return '/assets_v2';
}

function getFrameSafeDurationSeconds(frameCount, framesPerSecond) {
  const safeFrameCount = Number(frameCount);
  const safeFramesPerSecond = getFramesPerSecondFromValue(framesPerSecond);
  if (!Number.isFinite(safeFrameCount) || safeFrameCount <= 0 || safeFramesPerSecond <= 0) {
    return 0;
  }
  return Math.ceil((safeFrameCount / safeFramesPerSecond) * 1e6) / 1e6;
}

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



// A helper function to sleep for a given number of milliseconds.
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * A helper to determine if an error is "retryable" — i.e., 
 * network-related errors such as ECONNRESET, ECONNREFUSED, ETIMEDOUT, etc.
 */
function isRetryableError(error) {
  if (!error || !error.code) return false;

  const retryableCodes = [
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'EPIPE',
    'ENETUNREACH',
    'EAI_AGAIN',
  ];

  return retryableCodes.includes(error.code);
}

/**
 * Downloads a file from a URL to a specified path, with retry logic for network errors.
 *
 * @param {string} url - The URL of the file to download.
 * @param {string} dest - The destination file path.
 * @param {number} [maxRetries=3] - The maximum number of retry attempts.
 */
async function downloadVideo(url, dest, maxRetries = 3) {
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      attempt++;
      
      const response = await axios({
        method: 'GET',
        url,
        responseType: 'stream',
      });

      await fs.ensureDir(path.dirname(dest));
      await pipeline(response.data, fs.createWriteStream(dest));


      // If it succeeds, return immediately
      return;
    } catch (error) {
      console.error(`[downloadVideo] Error on attempt ${attempt}:`, error.code || error.message);

      // Check if it's a known network-related error that we can retry
      if (!isRetryableError(error) || attempt >= maxRetries) {
        console.error('[downloadVideo] Non-retryable error or max attempts reached.');
        throw error;  // rethrow the error
      }

      // Otherwise, sleep a bit before retrying
      const backoff = 500 + Math.floor(Math.random() * 1000); // 0.5 - 1.5s

      await sleep(backoff);
    }
  }
}

/**
 * Downloads the remote video and returns the local video path.
 *
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
    'assets_v2',
    'ai_video',
    'generations',
    sessionId,
    layerId
  );

  if (usesLocalAssetStorage()) {
   outputFolder = path.join(getAssetsV2Root(), 'ai_video', 'generations', sessionId, layerId);
  }
  
  if (!fs.existsSync(outputFolder)) {
    fs.mkdirSync(outputFolder, { recursive: true });
  }

  const videoFilePath = path.join(outputFolder, `video_${Date.now()}.mp4`);

  try {
    // Download the video with retry logic
    await downloadVideo(videoUrl, videoFilePath, 3);
    return videoFilePath;
  } catch (error) {
    console.error('Error downloading video:', error);
    throw error;
  }
}


/**
 * Saves a video "blob" (Response/Blob, ArrayBuffer/Uint8Array, Buffer, or Readable stream)
 * to disk using the same folder logic as downloadVideoFromRemote().
 *
 * @param {Response|Blob|ArrayBuffer|Uint8Array|Buffer|stream.Readable} remoteBlob
 * @param {string} sessionId
 * @param {string} layerId
 * @returns {Promise<string>} absolute path of the saved video
 */
export async function downloadVideoFromRemoteBlob(remoteBlob, sessionId, layerId) {
  const currentDir = process.cwd();
  let outputFolder = path.join(
    currentDir,
    '..',
    'samsar_processor',
    'assets_v2',
    'ai_video',
    'generations',
    sessionId,
    layerId
  );

  if (usesLocalAssetStorage()) {
    outputFolder = path.join(getAssetsV2Root(), 'ai_video', 'generations', sessionId, layerId);
  }

  await fs.ensureDir(outputFolder);

  // Try to infer extension from content-type when available, default to mp4
  let ext = 'mp4';
  try {
    const contentType =
      (remoteBlob && typeof remoteBlob === 'object' && 'type' in remoteBlob && remoteBlob.type) ||
      (remoteBlob && remoteBlob.headers && typeof remoteBlob.headers.get === 'function'
        ? remoteBlob.headers.get('content-type')
        : null);

    if (typeof contentType === 'string') {
      if (contentType.includes('webm')) ext = 'webm';
      else if (contentType.includes('quicktime') || contentType.includes('mov')) ext = 'mov';
      else if (contentType.includes('mp4')) ext = 'mp4';
    }
  } catch {
    // ignore content-type probing errors; keep mp4
  }

  const videoFilePath = path.join(outputFolder, `video_${Date.now()}.${ext}`);

  // Normalize to something we can persist
  const saveFromBuffer = async (buf) => {
    await fs.writeFile(videoFilePath, buf);
    return videoFilePath;
  };

  // 1) Node Buffer
  if (Buffer.isBuffer(remoteBlob)) {
    return await saveFromBuffer(remoteBlob);
  }

  // 2) ArrayBuffer / Uint8Array
  if (remoteBlob instanceof ArrayBuffer) {
    return await saveFromBuffer(Buffer.from(remoteBlob));
  }
  if (remoteBlob && typeof remoteBlob === 'object' && remoteBlob.buffer instanceof ArrayBuffer && typeof remoteBlob.byteLength === 'number') {
    // Likely a Uint8Array (or similar typed array)
    return await saveFromBuffer(Buffer.from(remoteBlob.buffer, remoteBlob.byteOffset || 0, remoteBlob.byteLength));
  }

  // 3) WHATWG Blob / Response with .arrayBuffer()
  if (remoteBlob && typeof remoteBlob.arrayBuffer === 'function') {
    const ab = await remoteBlob.arrayBuffer();
    return await saveFromBuffer(Buffer.from(ab));
  }

  // 4) Node Readable stream
  if (remoteBlob && typeof remoteBlob.pipe === 'function') {
    await pipeline(remoteBlob, fs.createWriteStream(videoFilePath));
    return videoFilePath;
  }

  throw new Error('downloadVideoFromRemoteBlob: Unsupported blob type provided.');
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
    'assets_v2',
    'ai_video',
    'frames',
    sessionId,
    layerId
  );

  if (usesLocalAssetStorage()) {
    outputFolder = path.join(getAssetsV2Root(), 'ai_video', 'frames', sessionId, layerId);
  } 

  await fs.ensureDir(path.dirname(outputFolder));
  const tempOutputFolder = await fs.mkdtemp(`${outputFolder}.tmp-`);

  try {
    await extractFrames(videoPath, tempOutputFolder, newFrameWidth, newFrameHeight, effectiveFramesPerSecond);

    // Read the number of frame files in the output directory
    const files = await fs.readdir(tempOutputFolder);
    const pngFiles = files.filter(file => path.extname(file).toLowerCase() === '.png');
    const numFiles = pngFiles.length;

    if (numFiles === 0) {
      throw new Error('No frames were extracted from the video.');
    }

    // Determine the start and last frame's filename
    const lastFrameNumber = numFiles - 1;
    const firstFrameNumber = 0;
    const tempFirstFramePath = path.join(tempOutputFolder, `${firstFrameNumber}.png`);
    const tempLastFramePath = path.join(tempOutputFolder, `${lastFrameNumber}.png`);

    // Verify that both frames exist
    if (!fs.existsSync(tempFirstFramePath)) {
      throw new Error(`First frame not found at path: ${tempFirstFramePath}`);
    }

    if (!fs.existsSync(tempLastFramePath)) {
      throw new Error(`Last frame not found at path: ${tempLastFramePath}`);
    }

    // Calculate the duration in seconds based on the session FPS
    const durationInSeconds = getFrameSafeDurationSeconds(numFiles, effectiveFramesPerSecond);

    await fs.remove(outputFolder);
    await fs.move(tempOutputFolder, outputFolder, { overwrite: true });

    const firstFramePath = path.join(outputFolder, `${firstFrameNumber}.png`);
    const lastFramePath = path.join(outputFolder, `${lastFrameNumber}.png`);

    // Return the result including both start and end frames
    return {
      firstFrame: firstFramePath,
      lastFrame: lastFramePath,
      duration: durationInSeconds,
      frameCount: numFiles,
      frameDuration: durationInSeconds,
    };
  } catch (error) {
    await fs.remove(tempOutputFolder).catch(() => {});
    console.error('Error processing video:', error);
    throw error;
  }
}

/**
 * Processes a video by extracting frames (like `processVideoAsFrames`) 
 * and also extracting the audio track.
 * 
 * @param {string} videoPath - Path to the local video file.
 * @param {string} sessionId - The session ID for organizing output.
 * @param {string} layerId - The layer ID for organizing output.
 * @param {object} canvasDimensions - An object with `width` and `height` properties.
 * @returns {Object} - An object containing the firstFrame path, lastFrame path, duration, and audioPath.
 */
export async function processVideoAsFramesAndAudio(
  videoPath,
  sessionId,
  layerId,
  canvasDimensions,
  framesPerSecond
) {


  const effectiveFramesPerSecond = getFramesPerSecondFromValue(framesPerSecond);

  const newFrameWidth = canvasDimensions.width;
  const newFrameHeight = canvasDimensions.height;

  const currentDir = process.cwd();
  let framesOutputFolder = path.join(
    currentDir,
    '..',
    'samsar_processor',
    'assets_v2',
    'ai_video',
    'frames',
    sessionId,
    layerId,
    'audio_video'
  );

  if (usesLocalAssetStorage()) {
    framesOutputFolder = path.join(getAssetsV2Root(), 'ai_video', 'frames', sessionId, layerId, 'audio_video');
  } 


  // Ensure there are no stale frames from previous generations for this layer.
  await fs.emptyDir(framesOutputFolder);


  

  // Prepare the audio output directory
  let audioOutputFolder = path.join(
    currentDir,
    '..',
    'samsar_processor',
    'assets_v2',
    'ai_video',
    'audio',
    sessionId,
    layerId
  );
  if (usesLocalAssetStorage()) {
    audioOutputFolder = path.join(getAssetsV2Root(), 'ai_video', 'audio', sessionId, layerId);
  }
  
  if (!fs.existsSync(audioOutputFolder)) {
    fs.mkdirSync(audioOutputFolder, { recursive: true });
  }


  const audioPath = path.join(audioOutputFolder, `audio_${Date.now()}.mp3`);




  try {
    // 1) Extract frames
    await extractFrames(
      videoPath,
      framesOutputFolder,
      newFrameWidth,
      newFrameHeight,
      effectiveFramesPerSecond
    );

    // 2) Extract audio
    await extractAudio(videoPath, audioPath);

    // 3) Determine frame count
    const files = await fs.readdir(framesOutputFolder);
    const pngFiles = files.filter(file => path.extname(file).toLowerCase() === '.png');
    const numFiles = pngFiles.length;

    if (numFiles === 0) {
      throw new Error('No frames were extracted from the video.');
    }

    const lastFrameNumber = numFiles - 1;
    const firstFrameNumber = 0;
    const firstFramePath = path.join(framesOutputFolder, `${firstFrameNumber}.png`);
    const lastFramePath = path.join(framesOutputFolder, `${lastFrameNumber}.png`);






    // Verify that both frames exist
    if (!fs.existsSync(firstFramePath)) {
      throw new Error(`First frame not found at path: ${firstFramePath}`);
    }
    if (!fs.existsSync(lastFramePath)) {
      throw new Error(`Last frame not found at path: ${lastFramePath}`);
    }

    // Calculate approximate duration based on frame count & session FPS
    const durationInSeconds = getFrameSafeDurationSeconds(numFiles, effectiveFramesPerSecond);

    return {
      firstFrame: firstFramePath,
      lastFrame: lastFramePath,
      duration: durationInSeconds,
      frameCount: numFiles,
      frameDuration: durationInSeconds,
      audioPath,
    };
  } catch (error) {
    console.error('Error processing video (frames + audio):', error);
    throw error;
  }
}

function extractFrames(videoPath, outputFolder, newFrameWidth, newFrameHeight, framesPerSecond) {
  const ffmpegThreadValue = `${resolveAiVideoFfmpegThreads()}`;
  return new Promise((resolve, reject) => {
    const frameFilter = `fps=${framesPerSecond}:round=down,scale=${newFrameWidth}:${newFrameHeight}`;

    ffmpeg(videoPath)
      .inputOptions([
        '-threads', ffmpegThreadValue,
      ])
      .outputOptions([
        '-start_number', '0',
        '-filter_threads', ffmpegThreadValue,
        '-threads', ffmpegThreadValue,
        '-vf', frameFilter,
        '-sws_flags', 'lanczos',
      ])
      .output(path.join(outputFolder, '%d.png'))
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

function extractAudio(videoPath, outputPath) {
  const ffmpegThreadValue = `${resolveAiVideoFfmpegThreads()}`;
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .inputOptions([
        '-threads', ffmpegThreadValue,
      ])
      .noVideo()
      .audioCodec('libmp3lame')  // re-encode the audio to MP3
      .audioBitrate('192k')      // optional: adjust as needed
      .outputOptions([
        '-threads', ffmpegThreadValue,
      ])
      .on('end', resolve)
      .on('error', reject)
      .save(outputPath);
  });
}




/**
 * Trim video in-place (fast, stream-copy) so its duration == targetDuration (sec).
 * Returns the absolute path of the NEW file that replaces the original one.
 */
export async function clipVideoToDuration(inputPath, targetDuration) {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`clipVideoToDuration: ${inputPath} does not exist`);
  }

  // Work in the same folder; add _trim suffix
  const { dir, name, ext } = path.parse(inputPath);
  const outputPath = path.join(dir, `${name}_trim${ext}`);

  // Fast-copy (-c copy) so re-encode ≈ instant
  await new Promise((res, rej) => {
    const ff = spawn('ffmpeg', [
      '-y',                      // overwrite
      '-i', inputPath,
      '-t', targetDuration,      // set new length
      '-c', 'copy',
      outputPath,
    ]);

    let stderr = '';

    ff.stderr.on('data', chunk => {
      stderr += chunk.toString();
      if (stderr.length > 8000) {
        stderr = stderr.slice(-8000);
      }
    });

    ff.on('error', rej);
    ff.on('close', code => {
      if (code === 0) {
        res();
        return;
      }

      const stderrSummary = stderr.trim();
      rej(new Error(
        stderrSummary
          ? `ffmpeg trim exited with ${code}: ${stderrSummary}`
          : `ffmpeg trim exited with ${code}`
      ));
    });
  });

  // Replace original atomically
  await fs.move(outputPath, inputPath, { overwrite: true });
  return inputPath;
}

export async function createThumbnailVideoPreview(inputPath, options = {}) {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`createThumbnailVideoPreview: ${inputPath} does not exist`);
  }

  const {
    maxWidth = 480,
    fps = 12,
    crf = 33,
    outputPath: requestedOutputPath,
    fallbackFramePath = null,
    sourceFramesPerSecond = null,
  } = options;

  const encoderOptions = getThumbnailEncoderOptions({ maxWidth, fps, crf });

  const { dir, name } = path.parse(inputPath);
  const outputPath = requestedOutputPath || path.join(dir, `${name}_preview.mp4`);
  await fs.ensureDir(path.dirname(outputPath));

  try {
    await encodeThumbnailPreviewFromVideo(inputPath, outputPath, encoderOptions);
  } catch (videoError) {
    if (!fallbackFramePath) {
      throw videoError;
    }

    try {
      await createThumbnailVideoPreviewFromFrames(fallbackFramePath, {
        ...encoderOptions,
        outputPath,
        sourceFramesPerSecond,
      });
    } catch (frameError) {
      throw new Error(
        `Unable to build thumbnail preview from source video or extracted frames. ` +
        `Source video error: ${getErrorMessage(videoError)}. ` +
        `Frame fallback error: ${getErrorMessage(frameError)}`
      );
    }
  }

  return outputPath;
}

export async function createThumbnailVideoPreviewFromFrames(firstFramePath, options = {}) {
  if (!fs.existsSync(firstFramePath)) {
    throw new Error(`createThumbnailVideoPreviewFromFrames: ${firstFramePath} does not exist`);
  }

  const {
    outputPath: requestedOutputPath,
    sourceFramesPerSecond,
  } = options;
  const encoderOptions = getThumbnailEncoderOptions(options);
  const sourceFps = getFramesPerSecondFromValue(sourceFramesPerSecond);
  const { dir, name } = path.parse(firstFramePath);
  const firstFrameNumber = Number.isFinite(Number(name)) ? Number(name) : 0;
  const outputPath = requestedOutputPath || path.join(dir, 'thumbnail_preview.mp4');

  await fs.ensureDir(path.dirname(outputPath));

  await encodeThumbnailPreviewFromFrameSequence(
    path.join(dir, '%d.png'),
    firstFrameNumber,
    sourceFps,
    outputPath,
    encoderOptions
  );

  return outputPath;
}

function getThumbnailEncoderOptions(options = {}) {
  const {
    maxWidth = 480,
    fps = 12,
    crf = 33,
  } = options;

  return {
    maxWidth: Number.isFinite(Number(maxWidth)) && Number(maxWidth) > 0
      ? Math.round(Number(maxWidth))
      : 480,
    fps: Number.isFinite(Number(fps)) && Number(fps) > 0
      ? Math.round(Number(fps))
      : 12,
    crf: Number.isFinite(Number(crf))
      ? Math.min(40, Math.max(18, Math.round(Number(crf))))
      : 33,
  };
}

async function encodeThumbnailPreviewFromVideo(inputPath, outputPath, encoderOptions) {
  await runThumbnailEncode(
    ffmpeg(inputPath)
      .noAudio()
      .videoCodec('libx264')
      .outputOptions(['-map', '0:v:0']),
    outputPath,
    encoderOptions,
    'thumbnail source video encode'
  );
}

async function encodeThumbnailPreviewFromFrameSequence(inputPattern, startNumber, sourceFps, outputPath, encoderOptions) {
  await runThumbnailEncode(
    ffmpeg(inputPattern)
      .inputOptions([
        '-framerate', `${sourceFps}`,
        '-start_number', `${startNumber}`,
      ])
      .noAudio()
      .videoCodec('libx264'),
    outputPath,
    encoderOptions,
    'thumbnail frame sequence encode'
  );
}

async function runThumbnailEncode(command, outputPath, encoderOptions, context) {
  const { maxWidth, fps, crf } = encoderOptions;
  const ffmpegThreadValue = `${resolveAiVideoFfmpegThreads()}`;
  let stderr = '';

  await fs.remove(outputPath);

  await new Promise((resolve, reject) => {
    command
      .inputOptions([
        '-threads', ffmpegThreadValue,
      ])
      .outputOptions(getThumbnailOutputOptions({
        maxWidth,
        fps,
        crf,
        ffmpegThreadValue,
      }))
      .on('stderr', (line) => {
        stderr += `${line}\n`;
        if (stderr.length > 8000) {
          stderr = stderr.slice(-8000);
        }
      })
      .on('end', resolve)
      .on('error', (error) => reject(buildFfmpegError(context, error, stderr)))
      .save(outputPath);
  });
}

function getThumbnailOutputOptions({ maxWidth, fps, crf, ffmpegThreadValue }) {
  return [
    '-y',
    '-pix_fmt', 'yuv420p',
    '-preset', 'veryfast',
    '-movflags', '+faststart',
    '-crf', `${crf}`,
    '-profile:v', 'baseline',
    '-level', '3.0',
    '-filter_threads', ffmpegThreadValue,
    '-threads', ffmpegThreadValue,
    '-vf',
    `fps=${fps},scale=w='if(gt(iw,${maxWidth}),${maxWidth},trunc(iw/2)*2)':h=-2:force_original_aspect_ratio=decrease,setsar=1`,
  ];
}

function buildFfmpegError(context, error, stderr) {
  const stderrSummary = stderr.trim();
  const baseMessage = getErrorMessage(error);
  if (!stderrSummary) {
    return new Error(`${context} failed: ${baseMessage}`);
  }

  return new Error(`${context} failed: ${baseMessage}\n${stderrSummary}`);
}

function getErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}
