import axios from 'axios';

import path from 'path';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import ffmpeg from 'fluent-ffmpeg';
import { getAlignerServerBaseUrl } from '../../utils/AlignerServer.js';
import { getFramesPerSecondFromValue } from '../../utils/FpsUtils.js';
import { isContainerRuntime } from '../../utils/EnvironmentUtils.js';
import { withProcessorFfmpegResources } from '../../utils/FfmpegResources.js';

const AUDIO_UTIL_SERVER = getAlignerServerBaseUrl();
const API_SERVER = process.env.API_SERVER;
const LOOP_MAX_FADE_SECONDS = 0.8;
const LOOP_MIN_FADE_SECONDS = 0.05;
const ASSETS_V2_URL_PREFIX = 'assets_v2';

function getAssetsBasePath() {
  if (isContainerRuntime()) {
    return process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2';
  }

  return path.join(process.cwd(), 'assets_v2');
}

function getLegacyAssetsBasePath() {
  if (isContainerRuntime()) {
    return process.env.SAMSAR_ASSETS_ROOT || '/assets';
  }

  return path.join(process.cwd(), 'assets');
}

function isRemoteAudioUrl(audioLink) {
  return typeof audioLink === 'string' && /^https?:\/\//i.test(audioLink.trim());
}

function normalizeAssetRelativePath(filePath) {
  return filePath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^assets_v2\/+/, '')
    .replace(/^assets\/+/, '');
}

export function resolveAudioLinkToLocalPath(audioLink) {
  if (typeof audioLink !== 'string' || !audioLink.trim()) {
    return null;
  }

  const trimmedAudioLink = audioLink.trim();
  if (isRemoteAudioUrl(trimmedAudioLink)) {
    return null;
  }

  if (path.isAbsolute(trimmedAudioLink)) {
    if (trimmedAudioLink.startsWith('/assets_v2/') || trimmedAudioLink.startsWith('/assets/') || fs.existsSync(trimmedAudioLink)) {
      return trimmedAudioLink;
    }

    return path.join(getAssetsBasePath(), normalizeAssetRelativePath(trimmedAudioLink));
  }

  const normalizedRelativePath = normalizeAssetRelativePath(trimmedAudioLink);
  const preferredPath = path.join(getAssetsBasePath(), normalizedRelativePath);
  if (trimmedAudioLink.replace(/^\/+/, '').startsWith('assets_v2/')) {
    return preferredPath;
  }

  if (fs.existsSync(preferredPath)) {
    return preferredPath;
  }

  return path.join(getLegacyAssetsBasePath(), normalizedRelativePath);
}

export function getSessionAudioFolderPath(sessionId, audioLayerId) {
  return path.join(
    getAssetsBasePath(),
    'video',
    'audio',
    sessionId.toString(),
    audioLayerId.toString()
  );
}

export function toAssetRelativePath(filePath) {
  const normalizedAssetsBasePath = getAssetsBasePath();
  const relativePath = path.relative(normalizedAssetsBasePath, filePath);

  if (!relativePath || relativePath.startsWith('..')) {
    return filePath.replace(/\\/g, '/');
  }

  return path.posix.join(
    ASSETS_V2_URL_PREFIX,
    relativePath.split(path.sep).join('/')
  );
}

async function downloadRemoteAudioToTemp(audioUrl) {
  const urlPathname = (() => {
    try {
      return new URL(audioUrl).pathname;
    } catch {
      return '';
    }
  })();
  const fileExtension = path.extname(urlPathname) || '.mp3';
  const tempAudioPath = path.join(tmpdir(), `audio-source-${randomUUID()}${fileExtension}`);
  const audioResponse = await axios.get(audioUrl, {
    responseType: 'arraybuffer',
    timeout: 60000,
  });

  await fsPromises.writeFile(tempAudioPath, Buffer.from(audioResponse.data));
  return tempAudioPath;
}

function getAudioDurationFromMetadata(audioMetadata) {
  const metadataDuration = Number(audioMetadata?.format?.duration);
  if (Number.isFinite(metadataDuration) && metadataDuration > 0) {
    return metadataDuration;
  }

  const audioStream = Array.isArray(audioMetadata?.streams)
    ? audioMetadata.streams.find((stream) => stream?.codec_type === 'audio')
    : null;
  const streamDuration = Number(audioStream?.duration);
  if (Number.isFinite(streamDuration) && streamDuration > 0) {
    return streamDuration;
  }

  return null;
}

export async function getAudioDurationSeconds(inputAudioPath) {
  const audioMetadata = await new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputAudioPath, (error, metadata) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(metadata);
    });
  });

  const audioDuration = getAudioDurationFromMetadata(audioMetadata);
  if (!Number.isFinite(audioDuration) || audioDuration <= 0) {
    throw new Error(`Unable to determine audio duration for ${inputAudioPath}`);
  }

  return audioDuration;
}

export async function getAudioDurationSecondsForLink(audioLink) {
  if (typeof audioLink !== 'string' || !audioLink.trim()) {
    return null;
  }

  let localAudioPath = null;
  let cleanupAudioPath = null;

  try {
    if (isRemoteAudioUrl(audioLink)) {
      localAudioPath = await downloadRemoteAudioToTemp(audioLink);
      cleanupAudioPath = localAudioPath;
    } else {
      localAudioPath = resolveAudioLinkToLocalPath(audioLink);
    }

    if (!localAudioPath || !fs.existsSync(localAudioPath)) {
      return null;
    }

    return await getAudioDurationSeconds(localAudioPath);
  } finally {
    if (cleanupAudioPath) {
      await fsPromises.unlink(cleanupAudioPath).catch(() => {});
    }
  }
}

function buildLoopBoundaryFadeFilter(loopSec, fadeSec) {
  const fadeOutStart = Number((loopSec - fadeSec).toFixed(6));

  return (
    `volume=if(lt(mod(t\\,${loopSec})\\,${fadeSec})\\,mod(t\\,${loopSec})/${fadeSec}` +
    `\\,if(gt(mod(t\\,${loopSec})\\,${fadeOutStart})\\,(${loopSec}-mod(t\\,${loopSec}))/${fadeSec}\\,1))`
  );
}

export async function createLoopedAudioTrackForDuration({
  sessionId,
  audioLayerId,
  sourceAudioLink,
  wantedDuration,
  filePrefix = 'looped-audio',
}) {
  const normalizedWantedDuration = Number(wantedDuration);
  if (!Number.isFinite(normalizedWantedDuration) || normalizedWantedDuration <= 0) {
    throw new Error('Loop target duration must be a positive number.');
  }

  if (typeof sourceAudioLink !== 'string' || !sourceAudioLink.trim()) {
    throw new Error('A valid source audio link is required.');
  }

  let inputAudioPath = null;
  let cleanupInputAudioPath = null;

  try {
    if (isRemoteAudioUrl(sourceAudioLink)) {
      inputAudioPath = await downloadRemoteAudioToTemp(sourceAudioLink);
      cleanupInputAudioPath = inputAudioPath;
    } else {
      inputAudioPath = resolveAudioLinkToLocalPath(sourceAudioLink);
    }

    if (!inputAudioPath || !fs.existsSync(inputAudioPath)) {
      throw new Error(`Audio source not found: ${sourceAudioLink}`);
    }

    const sourceDuration = await getAudioDurationSeconds(inputAudioPath);
    const loopsNeeded = Math.max(1, Math.ceil(normalizedWantedDuration / sourceDuration));
    const maxFadeWindow = (sourceDuration / 2) - 0.01;
    const loopFadeSeconds = Math.min(LOOP_MAX_FADE_SECONDS, maxFadeWindow);
    const useBoundaryFades = loopsNeeded > 1
      && Number.isFinite(loopFadeSeconds)
      && loopFadeSeconds > LOOP_MIN_FADE_SECONDS;

    const outputFolderPath = getSessionAudioFolderPath(sessionId, audioLayerId);
    await fsPromises.mkdir(outputFolderPath, { recursive: true });

    const safeFilePrefix = typeof filePrefix === 'string' && filePrefix.trim()
      ? filePrefix.trim().replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'looped-audio'
      : 'looped-audio';
    const outputFilePath = path.join(outputFolderPath, `${safeFilePrefix}-${randomUUID()}.mp3`);
    const outputOptions = ['-t', normalizedWantedDuration.toFixed(6), '-c:a', 'libmp3lame'];

    if (useBoundaryFades) {
      const loopSeconds = Number(sourceDuration.toFixed(6));
      const fadeSeconds = Number(loopFadeSeconds.toFixed(6));
      outputOptions.push('-af', buildLoopBoundaryFadeFilter(loopSeconds, fadeSeconds));
    }

    await withProcessorFfmpegResources((threadOptions) => (
      new Promise((resolve, reject) => {
        const inputOptions = [...threadOptions.inputOptions];
        if (loopsNeeded > 1) {
          inputOptions.push('-stream_loop', String(loopsNeeded - 1));
        }

        ffmpeg()
          .input(inputAudioPath)
          .inputOptions(inputOptions)
          .outputOptions([
            ...threadOptions.outputOptions,
            ...outputOptions,
          ])
          .save(outputFilePath)
          .on('end', resolve)
          .on('error', reject);
      })
    ));

    return {
      outputFilePath,
      outputRelativePath: toAssetRelativePath(outputFilePath),
      sourceDuration,
      duration: normalizedWantedDuration,
    };
  } finally {
    if (cleanupInputAudioPath) {
      await fsPromises.unlink(cleanupInputAudioPath).catch(() => {});
    }
  }
}




export async function getBeatsFromMusic(musicFilePath, framesPerSecond) {

  const musicFileUrl = `${API_SERVER}/${musicFilePath}`;

  try {


    const AUDIO_UTIL_URL = `${AUDIO_UTIL_SERVER}/beats`;

    const response = await axios.post(AUDIO_UTIL_URL, { musicUrl: musicFileUrl });

    if (response.data && response.data.beat_times) {
      const musicBeats = response.data.beat_times;

      const frameRate = getFramesPerSecondFromValue(framesPerSecond);
      const distribution = [];

      // Assuming musicBeats is an array of beat times in seconds
      for (let i = 0; i < musicBeats.length - 1; i++) {
        const startTime = musicBeats[i];
        const endTime = musicBeats[i + 1];

        const frameOffset = Math.floor(startTime * frameRate);
        const frameDuration = Math.floor((endTime - startTime) * frameRate);

        distribution.push({
          startFrame: frameOffset,
          endFrame: frameOffset + frameDuration,
          frameDuration: frameDuration,
          frameOffset: frameOffset,
        });
      }


      return distribution;


    }


  } catch (e) {

  }




}




export async function getAudioVisualizerSpectralFrequency(musicFilePath) {
  const musicFileUrl = `${API_SERVER}/${musicFilePath}`;


  try {
    const response = await axios.post(`${AUDIO_UTIL_SERVER}/generate_audio_visual_frequency`, {
      musicUrl: musicFileUrl,
    });
    return response.data;
  } catch (error) {
    console.error('Error getting audio visualizer spectral frequency:', error);
    throw error;
  }

}



export async function downloadRemoteLinks(localDownloadFolderPath, audioRemoteLinks) {
  let localAudioLinks = [];
  for (const audioLink of audioRemoteLinks) {
    const fileName = audioLink.split('/').pop();
    const audioData = await axios.get(audioLink, { responseType: 'arraybuffer' });
    const audioBuffer = Buffer.from(audioData.data, 'binary');
    const savePath = path.join(localDownloadFolderPath, fileName);
    fs.writeFileSync(savePath, audioBuffer);
    localAudioLinks.push(fileName);
  }
  return localAudioLinks;
}
