import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import ffmpeg from 'fluent-ffmpeg';
import { getFramesPerSecondFromValue } from '../../utils/FpsUtils.js';
import { promisify } from 'util';
import stream from 'stream';
import { fileURLToPath } from 'url';

const pipeline = promisify(stream.pipeline);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUDIO_EDGE_SILENCE_THRESHOLD = '-50dB';
const AUDIO_EDGE_SILENCE_MIN_DURATION_SECONDS = 0.25;
const AUDIO_EDGE_SILENCE_WINDOW_SECONDS = 0.03;
const AUDIO_EDGE_DETECTION_TOLERANCE_SECONDS = 0.1;
const MIN_RETAINED_AUDIO_DURATION_SECONDS = 0.1;

function isWritableDirectory(dirPath) {
  try {
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveAssetRoot() {
  const dockerAssetsRoot = process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2';
  const localAssetsRoot = path.resolve(__dirname, '../../..', 'assets_v2');
  const currentEnv = process.env.CURRENT_ENV;

  // Only docker/staging should write to the mounted assets volume.
  if ((currentEnv === 'staging' || currentEnv === 'docker')
    && fs.existsSync(dockerAssetsRoot)
    && isWritableDirectory(dockerAssetsRoot)) {
    return dockerAssetsRoot;
  }

  return localAssetsRoot;
}

function resolveAssetBasePath(...segments) {
  return path.join(resolveAssetRoot(), ...segments);
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

export async function getVideoMetadata(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err);
      } else {
        resolve(metadata);
      }
    });
  });
}

async function getMediaDurationSeconds(mediaPath) {
  const metadata = await getVideoMetadata(mediaPath);
  const duration = Number(metadata?.format?.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function roundTrimSeconds(value) {
  const normalizedValue = Number(value);
  if (!Number.isFinite(normalizedValue) || normalizedValue <= 0) {
    return 0;
  }

  return Math.round(normalizedValue * 1000) / 1000;
}

async function createTemporaryFrameOutputFolder(outputFolder) {
  await fs.ensureDir(path.dirname(outputFolder));
  return fs.mkdtemp(`${outputFolder}.tmp-`);
}

async function publishTemporaryFrameOutputFolder(tempOutputFolder, outputFolder) {
  await fs.ensureDir(path.dirname(outputFolder));
  await fs.remove(outputFolder);
  await fs.move(tempOutputFolder, outputFolder, { overwrite: true });
}

function getFrameFileNumber(fileName) {
  const frameNumber = Number.parseInt(path.basename(fileName, path.extname(fileName)), 10);
  return Number.isFinite(frameNumber) ? frameNumber : Number.MAX_SAFE_INTEGER;
}

async function getExtractedFrameSummary(outputFolder, framesPerSecond) {
  const files = await fs.readdir(outputFolder);
  const pngFiles = files
    .filter((file) => path.extname(file).toLowerCase() === '.png')
    .sort((leftFile, rightFile) => {
      const leftFrameNumber = getFrameFileNumber(leftFile);
      const rightFrameNumber = getFrameFileNumber(rightFile);
      if (leftFrameNumber !== rightFrameNumber) {
        return leftFrameNumber - rightFrameNumber;
      }
      return leftFile.localeCompare(rightFile);
    });
  const numFiles = pngFiles.length;

  if (numFiles === 0) {
    throw new Error('No frames were extracted from the video.');
  }

  const firstFramePath = path.join(outputFolder, pngFiles[0]);
  const lastFramePath = path.join(outputFolder, pngFiles[numFiles - 1]);

  if (!fs.existsSync(firstFramePath)) {
    throw new Error(`First frame not found at path: ${firstFramePath}`);
  }
  if (!fs.existsSync(lastFramePath)) {
    throw new Error(`Last frame not found at path: ${lastFramePath}`);
  }

  return {
    firstFramePath,
    lastFramePath,
    numFiles,
    frameDuration: getFrameSafeDurationSeconds(numFiles, framesPerSecond),
    duration: Math.floor((numFiles / framesPerSecond) * 100) / 100,
  };
}

function getFrameSafeDurationSeconds(frameCount, framesPerSecond) {
  const safeFrameCount = Number(frameCount);
  const safeFramesPerSecond = Number(framesPerSecond);
  if (!Number.isFinite(safeFrameCount) || safeFrameCount <= 0 || !Number.isFinite(safeFramesPerSecond) || safeFramesPerSecond <= 0) {
    return 0;
  }

  return Math.ceil((safeFrameCount / safeFramesPerSecond) * 1000000) / 1000000;
}

function parseAudioEdgeSilence(stderrOutput, mediaDurationSeconds, minDurationSeconds) {
  const lines = String(stderrOutput || '').split(/\r?\n/);
  let currentSilenceStart = null;
  let leadingSilenceTrimSeconds = 0;
  let trailingSilenceTrimSeconds = 0;

  for (const line of lines) {
    const silenceStartMatch = line.match(/silence_start:\s*([0-9.]+)/);
    if (silenceStartMatch) {
      currentSilenceStart = Number(silenceStartMatch[1]);
      continue;
    }

    const silenceEndMatch = line.match(/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/);
    if (!silenceEndMatch) {
      continue;
    }

    const silenceEnd = Number(silenceEndMatch[1]);
    const silenceDuration = Number(silenceEndMatch[2]);
    const silenceStart = Number.isFinite(currentSilenceStart)
      ? currentSilenceStart
      : Math.max(0, silenceEnd - (Number.isFinite(silenceDuration) ? silenceDuration : 0));

    if (
      leadingSilenceTrimSeconds === 0
      && silenceStart <= AUDIO_EDGE_DETECTION_TOLERANCE_SECONDS
      && silenceEnd >= minDurationSeconds
    ) {
      leadingSilenceTrimSeconds = silenceEnd;
    }

    if (
      Number.isFinite(mediaDurationSeconds)
      && mediaDurationSeconds > 0
      && silenceEnd >= mediaDurationSeconds - AUDIO_EDGE_DETECTION_TOLERANCE_SECONDS
      && silenceStart < mediaDurationSeconds
    ) {
      trailingSilenceTrimSeconds = Math.max(0, mediaDurationSeconds - silenceStart);
    }

    currentSilenceStart = null;
  }

  if (
    Number.isFinite(currentSilenceStart)
    && Number.isFinite(mediaDurationSeconds)
    && mediaDurationSeconds > 0
    && currentSilenceStart < mediaDurationSeconds
  ) {
    trailingSilenceTrimSeconds = Math.max(0, mediaDurationSeconds - currentSilenceStart);
  }

  return {
    leadingSilenceTrimSeconds: roundTrimSeconds(leadingSilenceTrimSeconds),
    trailingSilenceTrimSeconds: roundTrimSeconds(trailingSilenceTrimSeconds),
  };
}

async function detectAudioEdgeSilence(audioPath) {
  const durationSeconds = await getMediaDurationSeconds(audioPath);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return {
      durationSeconds: 0,
      leadingSilenceTrimSeconds: 0,
      trailingSilenceTrimSeconds: 0,
    };
  }

  const silenceDetectFilter = [
    `silencedetect=noise=${AUDIO_EDGE_SILENCE_THRESHOLD}`,
    `d=${AUDIO_EDGE_SILENCE_MIN_DURATION_SECONDS}`,
  ].join(':');

  let stderrOutput = '';

  await new Promise((resolve, reject) => {
    ffmpeg(audioPath)
      .noVideo()
      .audioFilters([silenceDetectFilter])
      .format('null')
      .output('-')
      .on('stderr', (line) => {
        stderrOutput += `${line}\n`;
      })
      .on('end', resolve)
      .on('error', reject)
      .run();
  });

  return {
    durationSeconds,
    ...parseAudioEdgeSilence(
      stderrOutput,
      durationSeconds,
      AUDIO_EDGE_SILENCE_MIN_DURATION_SECONDS
    ),
  };
}

async function trimTrailingSilenceFromAudioFile(audioPath) {
  const parsedPath = path.parse(audioPath);
  const trimmedOutputPath = path.join(
    parsedPath.dir,
    `${parsedPath.name}_tail_trimmed${parsedPath.ext || '.mp3'}`
  );

  const trailingTrimFilter = [
    'areverse',
    `silenceremove=start_periods=1:start_duration=${AUDIO_EDGE_SILENCE_MIN_DURATION_SECONDS}:start_threshold=${AUDIO_EDGE_SILENCE_THRESHOLD}:start_silence=0:start_mode=all:detection=rms:window=${AUDIO_EDGE_SILENCE_WINDOW_SECONDS}`,
    'areverse',
  ].join(',');

  await new Promise((resolve, reject) => {
    ffmpeg(audioPath)
      .noVideo()
      .audioCodec('libmp3lame')
      .audioBitrate('192k')
      .audioFilters([trailingTrimFilter])
      .on('end', resolve)
      .on('error', reject)
      .save(trimmedOutputPath);
  });

  await fs.move(trimmedOutputPath, audioPath, { overwrite: true });
}

export async function saveUploadedVideoBuffer(
  buffer,
  {
    sessionId,
    layerId,
    extension = 'mp4',
    prefix = 'uploaded_video',
    namespace = 'ai_video',
  } = {}
) {
  if (!buffer || buffer.length === 0) {
    throw new Error('Missing uploaded video buffer.');
  }

  const outputFolder = resolveAssetBasePath(namespace, 'generations', sessionId, layerId);
  await fs.ensureDir(outputFolder);

  const safeExtension = String(extension || 'mp4').replace(/^\.+/, '') || 'mp4';
  const outputPath = path.join(outputFolder, `${prefix}_${Date.now()}.${safeExtension}`);
  await fs.writeFile(outputPath, buffer);
  return outputPath;
}

export async function appendUploadedVideoChunk(
  buffer,
  {
    sessionId,
    layerId,
    uploadId,
    extension = 'mp4',
    prefix = 'uploaded_video',
    namespace = 'ai_video',
    reset = false,
  } = {}
) {
  if (!buffer || buffer.length === 0) {
    throw new Error('Missing uploaded video chunk.');
  }
  if (!uploadId) {
    throw new Error('Missing uploadId for uploaded video chunk.');
  }

  const outputFolder = resolveAssetBasePath(namespace, 'generations', sessionId, layerId);
  await fs.ensureDir(outputFolder);

  const safeExtension = String(extension || 'mp4').replace(/^\.+/, '') || 'mp4';
  const safeUploadId = String(uploadId).replace(/[^a-zA-Z0-9_-]/g, '') || 'upload';
  const outputPath = path.join(outputFolder, `${prefix}_${safeUploadId}.${safeExtension}`);

  if (reset) {
    await fs.remove(outputPath);
  }

  await fs.appendFile(outputPath, buffer);
  return outputPath;
}

export async function normalizeVideoAssetToMp4WithoutAudio(
  inputVideoPath,
  {
    sessionId,
    layerId,
    prefix = 'normalized_video',
    namespace = 'ai_video',
  } = {}
) {
  const outputFolder = resolveAssetBasePath(namespace, 'generations', sessionId, layerId);
  await fs.ensureDir(outputFolder);

  const outputPath = path.join(outputFolder, `${prefix}_${Date.now()}.mp4`);

  await new Promise((resolve, reject) => {
    ffmpeg(inputVideoPath)
      .noAudio()
      .videoCodec('libx264')
      .outputOptions([
        '-preset', 'veryfast',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
      ])
      .on('end', resolve)
      .on('error', reject)
      .save(outputPath);
  });

  return outputPath;
}

export async function extractAudioFromVideoIfPresent(
  videoPath,
  {
    sessionId,
    layerId,
    prefix = 'audio',
    namespace = 'ai_video',
    trimUploadedAudioEdgeSilence = false,
  } = {}
) {
  const metadata = await getVideoMetadata(videoPath);
  const hasAudioStream = Array.isArray(metadata?.streams)
    && metadata.streams.some((streamMeta) => streamMeta?.codec_type === 'audio');

  if (!hasAudioStream) {
    return {
      audioPath: null,
      leadingSilenceTrimSeconds: 0,
      trailingSilenceTrimSeconds: 0,
    };
  }

  const outputFolder = resolveAssetBasePath(namespace, 'audio', sessionId, layerId);
  await fs.ensureDir(outputFolder);

  const outputPath = path.join(outputFolder, `${prefix}_${Date.now()}.mp3`);
  await extractAudio(videoPath, outputPath);

  let leadingSilenceTrimSeconds = 0;
  let trailingSilenceTrimSeconds = 0;

  if (trimUploadedAudioEdgeSilence) {
    try {
      const silenceInfo = await detectAudioEdgeSilence(outputPath);
      const remainingDurationSeconds = silenceInfo.durationSeconds
        - silenceInfo.leadingSilenceTrimSeconds
        - silenceInfo.trailingSilenceTrimSeconds;

      if (remainingDurationSeconds > MIN_RETAINED_AUDIO_DURATION_SECONDS) {
        leadingSilenceTrimSeconds = silenceInfo.leadingSilenceTrimSeconds;
        trailingSilenceTrimSeconds = silenceInfo.trailingSilenceTrimSeconds;

        if (
          trailingSilenceTrimSeconds >= AUDIO_EDGE_SILENCE_MIN_DURATION_SECONDS
          && (silenceInfo.durationSeconds - trailingSilenceTrimSeconds) > MIN_RETAINED_AUDIO_DURATION_SECONDS
        ) {
          await trimTrailingSilenceFromAudioFile(outputPath);
        }
      }
    } catch (error) {
      console.error('Failed to trim uploaded audio edge silence:', error);
    }
  }

  return {
    audioPath: outputPath,
    leadingSilenceTrimSeconds,
    trailingSilenceTrimSeconds,
  };
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
  const outputFolder = resolveAssetBasePath('ai_video', 'generations', sessionId, layerId);
  await fs.ensureDir(outputFolder);

  const videoFolderPath = path.join(outputFolder, `video_${Date.now()}.mp4`);

  try {

    await downloadVideo(videoUrl, videoFolderPath);


    return videoFolderPath;
  } catch (error) {
    console.error('Error downloading video:', error);
    throw error;
  }
}

export async function processVideoAsFramesAndAudio(
  videoPath,
  sessionId,
  layerId,
  canvasDimensions,
  framesPerSecond,
  options = {}
) {
  const newFrameWidth = canvasDimensions.width;
  const newFrameHeight = canvasDimensions.height;
  const forcedFramesPerSecond = Number(options?.forceFramesPerSecond);
  const effectiveFramesPerSecond =
    Number.isFinite(forcedFramesPerSecond) && forcedFramesPerSecond > 0
      ? forcedFramesPerSecond
      : getFramesPerSecondFromValue(framesPerSecond);

  const framesSubDir = typeof options?.framesSubDir === 'string' && options.framesSubDir.trim().length > 0
    ? options.framesSubDir.trim()
    : null;

  const framesOutputFolder = resolveAssetBasePath(
    'ai_video',
    'frames',
    sessionId,
    layerId,
    ...(framesSubDir ? [framesSubDir] : [])
  );

  const tempFramesOutputFolder = await createTemporaryFrameOutputFolder(framesOutputFolder);

  // Prepare the audio output directory
  const audioOutputFolder = resolveAssetBasePath('ai_video', 'audio', sessionId, layerId);
  await fs.ensureDir(audioOutputFolder);


  const audioPath = path.join(audioOutputFolder, `audio_${Date.now()}.mp3`);




  try {
    // 1) Extract frames
    await extractFrames(
      videoPath,
      tempFramesOutputFolder,
      newFrameWidth,
      newFrameHeight,
      effectiveFramesPerSecond
    );


    await extractAudio(videoPath, audioPath);

    const frameSummary = await getExtractedFrameSummary(tempFramesOutputFolder, effectiveFramesPerSecond);
    await publishTemporaryFrameOutputFolder(tempFramesOutputFolder, framesOutputFolder);
    const firstFramePath = path.join(framesOutputFolder, path.basename(frameSummary.firstFramePath));
    const lastFramePath = path.join(framesOutputFolder, path.basename(frameSummary.lastFramePath));

    // Calculate approximate duration based on frame count & session FPS
    const durationInSeconds = frameSummary.duration;

    return {
      firstFrame: firstFramePath,
      lastFrame: lastFramePath,
      duration: durationInSeconds,
      frameDuration: frameSummary.frameDuration,
      frameCount: frameSummary.numFiles,
      audioPath,
    };

  } catch (error) {
    await fs.remove(tempFramesOutputFolder).catch(() => {});
    console.error('Error processing video (frames + audio):', error);
    throw error;
  }
}


export async function processVideoAsFrames(
  videoPath,
  sessionId,
  layerId,
  canvasDimensions,
  framesPerSecond,
  options = {}
) {
  const newFrameWidth = canvasDimensions.width;
  const newFrameHeight = canvasDimensions.height;
  const forcedFramesPerSecond = Number(options?.forceFramesPerSecond);
  const effectiveFramesPerSecond =
    Number.isFinite(forcedFramesPerSecond) && forcedFramesPerSecond > 0
      ? forcedFramesPerSecond
      : getFramesPerSecondFromValue(framesPerSecond);



  const framesSubDir = typeof options?.framesSubDir === 'string' && options.framesSubDir.trim().length > 0
    ? options.framesSubDir.trim()
    : null;
  const framesNamespace = typeof options?.framesNamespace === 'string' && options.framesNamespace.trim().length > 0
    ? options.framesNamespace.trim()
    : 'ai_video';


  const outputFolder = resolveAssetBasePath(
    framesNamespace,
    'frames',
    sessionId,
    layerId,
    ...(framesSubDir ? [framesSubDir] : [])
  );



  const tempOutputFolder = await createTemporaryFrameOutputFolder(outputFolder);

  try {
    await extractFrames(
      videoPath,
      tempOutputFolder,
      newFrameWidth,
      newFrameHeight,
      effectiveFramesPerSecond,
      {
        preserveAspectRatio: Boolean(options?.preserveAspectRatio),
      }
    );

    const frameSummary = await getExtractedFrameSummary(tempOutputFolder, effectiveFramesPerSecond);
    await publishTemporaryFrameOutputFolder(tempOutputFolder, outputFolder);
    const firstFramePath = path.join(outputFolder, path.basename(frameSummary.firstFramePath));
    const lastFramePath = path.join(outputFolder, path.basename(frameSummary.lastFramePath));

    // Calculate the duration in seconds based on session FPS
    const durationInSeconds = frameSummary.duration;

    // Return the result including both start and end frames
    return {
      firstFrame: firstFramePath,
      lastFrame: lastFramePath,
      duration: durationInSeconds,
      frameDuration: frameSummary.frameDuration,
      frameCount: frameSummary.numFiles,
    };
  } catch (error) {
    await fs.remove(tempOutputFolder).catch(() => {});
    console.error('Error processing video:', error);
    throw error;
  }
}

export async function extractVideoBoundaryFrames(
  videoPath,
  sessionId,
  layerId,
  canvasDimensions,
  options = {}
) {
  const outputFolder = resolveAssetBasePath('ai_video', 'previews', sessionId, layerId);
  await fs.ensureDir(outputFolder);
  await fs.emptyDir(outputFolder);

  const durationSeconds = Number(options?.durationSeconds);
  const endSeekSeconds = Number.isFinite(durationSeconds) && durationSeconds > 0
    ? Math.max(0, durationSeconds - 0.1)
    : 0;
  const preserveAspectRatio = Boolean(options?.preserveAspectRatio);

  const firstFramePath = path.join(outputFolder, 'start.png');
  const lastFramePath = path.join(outputFolder, 'end.png');

  await extractSingleFrame(
    videoPath,
    firstFramePath,
    canvasDimensions.width,
    canvasDimensions.height,
    0,
    { preserveAspectRatio }
  );

  try {
    await extractSingleFrame(
      videoPath,
      lastFramePath,
      canvasDimensions.width,
      canvasDimensions.height,
      endSeekSeconds,
      { preserveAspectRatio }
    );
  } catch (error) {
    await fs.copy(firstFramePath, lastFramePath, { overwrite: true });
  }

  return {
    firstFrame: firstFramePath,
    lastFrame: lastFramePath,
  };
}

function buildFrameFilter(newFrameWidth, newFrameHeight, preserveAspectRatio) {
  return preserveAspectRatio
    ? `scale=${newFrameWidth}:${newFrameHeight}:force_original_aspect_ratio=decrease,pad=${newFrameWidth}:${newFrameHeight}:(ow-iw)/2:(oh-ih)/2:color=black@0`
    : `scale=${newFrameWidth}:${newFrameHeight}`;
}

function extractFrames(
  videoPath,
  outputFolder,
  newFrameWidth,
  newFrameHeight,
  framesPerSecond,
  options = {}
) {
  return new Promise((resolve, reject) => {
    const preserveAspectRatio = Boolean(options?.preserveAspectRatio);
    const fpsFilter = `fps=${framesPerSecond}:round=down,${buildFrameFilter(
      newFrameWidth,
      newFrameHeight,
      preserveAspectRatio
    )}`;

    const outputOptions = [
      '-start_number', '0',
      '-threads', '2',
      '-vf', fpsFilter,
      '-sws_flags', 'lanczos',
    ];

    if (preserveAspectRatio) {
      outputOptions.push('-pix_fmt', 'rgba');
    }

    ffmpeg(videoPath)
      .outputOptions(outputOptions)
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

function extractSingleFrame(
  videoPath,
  outputPath,
  newFrameWidth,
  newFrameHeight,
  seekSeconds = 0,
  options = {}
) {
  return new Promise((resolve, reject) => {
    const preserveAspectRatio = Boolean(options?.preserveAspectRatio);
    const command = ffmpeg(videoPath);

    if (Number.isFinite(seekSeconds) && seekSeconds > 0) {
      command.seekInput(seekSeconds);
    }

    const outputOptions = [
      '-frames:v', '1',
      '-threads', '2',
      '-vf', buildFrameFilter(newFrameWidth, newFrameHeight, preserveAspectRatio),
      '-sws_flags', 'lanczos',
    ];

    if (preserveAspectRatio) {
      outputOptions.push('-pix_fmt', 'rgba');
    }

    command
      .outputOptions(outputOptions)
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

function extractAudio(videoPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .noVideo()
      .audioCodec('libmp3lame')  // re-encode the audio to MP3
      .audioBitrate('192k')      // optional: adjust as needed
      .on('end', resolve)
      .on('error', reject)
      .save(outputPath);
  });
}
