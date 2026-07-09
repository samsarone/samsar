import fs from 'fs';
import path from 'path';
import { writeFile } from 'fs/promises';
import axios from 'axios';
import ffmpeg from 'fluent-ffmpeg';

import { getDBConnectionString } from '../DBString.js';
import VideoSession from '../schema/VideoSession.js';
import AudioGeneration from '../schema/AudioGeneration.js';
import GeneratedMusic from '../schema/generations/GeneratedMusic.js';
import { generateS3UrlsFromLocalFile } from '../AWS.js';
import { getProcessorAssetsV2Path, toAssetsV2RelativePath } from '../utils/AssetPaths.js';
import {
  failStandaloneExternalAudioGeneration,
  finalizeStandaloneExternalAudioGeneration,
} from '../external/StandaloneExternalAudio.js';

const LOOP_MAX_FADE_SECONDS = 0.8;
const LOOP_MIN_FADE_SECONDS = 0.05;

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTagList(value) {
  if (Array.isArray(value)) {
    return value
      .filter((tag) => typeof tag === 'string' && tag.trim())
      .map((tag) => tag.trim());
  }

  if (typeof value === 'string' && value.trim()) {
    return value
      .split(/[,\s]+/)
      .filter((tag) => tag && tag.trim())
      .map((tag) => tag.trim());
  }

  return [];
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

async function getAudioDurationSeconds(localAudioPath) {
  const audioMetadata = await new Promise((resolve, reject) => {
    ffmpeg.ffprobe(localAudioPath, (error, metadata) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(metadata);
    });
  });

  const audioDuration = getAudioDurationFromMetadata(audioMetadata);
  if (!Number.isFinite(audioDuration) || audioDuration <= 0) {
    throw new Error(`Unable to determine audio duration for ${localAudioPath}`);
  }

  return audioDuration;
}

function buildLoopBoundaryFadeFilter(loopSec, fadeSec) {
  const fadeOutStart = Number((loopSec - fadeSec).toFixed(6));

  return (
    `volume=if(lt(mod(t\\,${loopSec})\\,${fadeSec})\\,mod(t\\,${loopSec})/${fadeSec}` +
    `\\,if(gt(mod(t\\,${loopSec})\\,${fadeOutStart})\\,(${loopSec}-mod(t\\,${loopSec}))/${fadeSec}\\,1))`
  );
}

export function shouldLoopBackingTrackAudio(audioGeneration = {}) {
  return audioGeneration?.isBackingTrack === true;
}

async function createLoopedAudioTrackForDuration({
  sourceAudioPath,
  outputFilePath,
  wantedDuration,
}) {
  const normalizedWantedDuration = Number(wantedDuration);
  if (!Number.isFinite(normalizedWantedDuration) || normalizedWantedDuration <= 0) {
    throw new Error('Loop target duration must be a positive number.');
  }

  const sourceDuration = await getAudioDurationSeconds(sourceAudioPath);
  if (sourceDuration >= normalizedWantedDuration - 0.25) {
    if (path.resolve(sourceAudioPath) !== path.resolve(outputFilePath)) {
      await fs.promises.copyFile(sourceAudioPath, outputFilePath);
    }

    return {
      outputFilePath,
      sourceDuration,
      duration: normalizedWantedDuration,
    };
  }

  const loopsNeeded = Math.max(1, Math.ceil(normalizedWantedDuration / sourceDuration));
  const maxFadeWindow = (sourceDuration / 2) - 0.01;
  const loopFadeSeconds = Math.min(LOOP_MAX_FADE_SECONDS, maxFadeWindow);
  const useBoundaryFades = loopsNeeded > 1
    && Number.isFinite(loopFadeSeconds)
    && loopFadeSeconds > LOOP_MIN_FADE_SECONDS;

  const outputOptions = ['-t', normalizedWantedDuration.toFixed(6), '-c:a', 'libmp3lame'];
  if (useBoundaryFades) {
    const loopSeconds = Number(sourceDuration.toFixed(6));
    const fadeSeconds = Number(loopFadeSeconds.toFixed(6));
    outputOptions.push('-af', buildLoopBoundaryFadeFilter(loopSeconds, fadeSeconds));
  }

  await new Promise((resolve, reject) => {
    let command = ffmpeg().input(sourceAudioPath);

    if (loopsNeeded > 1) {
      command = command.inputOptions(['-stream_loop', String(loopsNeeded - 1)]);
    }

    command
      .outputOptions(outputOptions)
      .save(outputFilePath)
      .on('end', resolve)
      .on('error', reject);
  });

  return {
    outputFilePath,
    sourceDuration,
    duration: normalizedWantedDuration,
  };
}

export async function upsertGeneratedMusicArtifact({
  sessionData,
  currentAudioLayer,
  audioGeneration,
  localAudioPath,
}) {
  const sessionId = normalizeString(sessionData?._id?.toString?.() || sessionData?._id);
  const userId = normalizeString(sessionData?.userId?.toString?.() || sessionData?.userId);
  const normalizedUrl = normalizeString(localAudioPath);

  if (!sessionId || !userId || !normalizedUrl) {
    return;
  }

  const primaryRemoteAudioData = Array.isArray(currentAudioLayer?.remoteAudioData)
    ? currentAudioLayer.remoteAudioData.find((item) => item && typeof item === 'object')
    : null;
  const lyric = normalizeString(primaryRemoteAudioData?.lyric)
    || normalizeString(currentAudioLayer?.lyrics)
    || (audioGeneration?.isInstrumental ? '[Instrumental]' : '');
  const title = normalizeString(primaryRemoteAudioData?.title)
    || normalizeString(currentAudioLayer?.title)
    || '';
  const tags = normalizeTagList(primaryRemoteAudioData?.tags || currentAudioLayer?.tags);
  const prompt = normalizeString(currentAudioLayer?.prompt) || normalizeString(audioGeneration?.prompt);
  const description = normalizeString(currentAudioLayer?.description);
  const durationValue = Number(currentAudioLayer?.duration);
  const duration = Number.isFinite(durationValue) && durationValue > 0 ? durationValue : undefined;
  const layerVolumeValue = Number(currentAudioLayer?.volume);
  const generationVolumeValue = Number(audioGeneration?.volume);
  const volume = Number.isFinite(layerVolumeValue) && layerVolumeValue >= 0
    ? layerVolumeValue
    : Number.isFinite(generationVolumeValue) && generationVolumeValue >= 0
      ? generationVolumeValue
      : undefined;

  await GeneratedMusic.findOneAndUpdate(
    {
      sessionId,
      userId,
      url: normalizedUrl,
    },
    {
      $set: {
        sessionId,
        userId,
        url: normalizedUrl,
        prompt,
        description,
        title,
        tags,
        lyric,
        ...(duration ? { duration } : {}),
        ...(volume !== undefined ? { volume } : {}),
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );
}

/**
 * Returns the folder in which audio for a given session & audio layer should be stored.
 * Example: samsar_processor/assets_v2/video/audio/<sessionId>/<audioLayerId>/
 */
export function getLocalAudioFolderPath(sessionId, audioLayerId) {
  return getProcessorAssetsV2Path(
    'video',
    'audio',
    sessionId.toString(),
    audioLayerId.toString()
  );
}

/**
 * Ensures the local folder path for an audio file exists; if not, creates it recursively.
 */
export function ensureLocalFolderExists(folderPath) {
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
}

/**
 * Downloads an audio file from a remote URL, returning its data as a Buffer.
 */
export async function downloadAudioAsBuffer(audioUrl) {
  const response = await axios.get(audioUrl, {
    responseType: 'arraybuffer',
    timeout: 60000 // or as needed
  });
  return Buffer.from(response.data);
}

/**
 * Writes a Buffer to a local file at the given path.
 */
export async function writeBufferToLocalFile(localFilePath, fileBuffer) {
  await writeFile(localFilePath, fileBuffer);
}

/**
 * Uploads the local file to S3 and returns array of remote URLs.
 */
export async function uploadLocalAudioToS3(sessionId, localFilePath) {
  // Your generateS3UrlsFromLocalFile presumably returns an array of S3 URLs
  const s3Urls = await generateS3UrlsFromLocalFile(sessionId, localFilePath);
  return s3Urls;
}

/**
 * Updates the VideoSession document's audioLayers (the relevant audioLayer),
 * setting generationStatus to COMPLETED, storing remoteAudioLinks, localAudioLinks, etc.
 * Also updates the AudioGeneration document if needed.
 */
export async function attachAudioToSessionAndCleanup({
  sessionId,
  audioLayerId,
  audioGenerationId,
  localAudioFileName,
  s3Urls
}) {
  await getDBConnectionString();

  // Fetch the audioGeneration doc
  const audioGeneration = await AudioGeneration.findById(audioGenerationId);
  if (!audioGeneration) {
    return;
  }

  const localDownloadBase = path.join('video', 'audio', sessionId.toString(), audioLayerId.toString());
  const localFilePath = toAssetsV2RelativePath(localDownloadBase, localAudioFileName);
  if (await finalizeStandaloneExternalAudioGeneration({
    payload: audioGeneration,
    resultUrl: Array.isArray(s3Urls) ? s3Urls[0] : null,
    resultUrls: s3Urls,
    localAudioPath: localFilePath,
    remoteAudioData: [
      {
        audio_url: Array.isArray(s3Urls) ? s3Urls[0] : null,
        title: 'Music',
        _id: audioLayerId,
      },
    ],
    title: 'Music',
  })) {
    return;
  }

  // Now fetch the session
  let sessionData = await VideoSession.findById(sessionId);
  if (!sessionData) {
    // You may opt to delete the AudioGeneration doc anyway
    await AudioGeneration.findByIdAndDelete(audioGenerationId);
    return;
  }

  // Find the audioLayer
  const { audioLayers } = sessionData;
  const currentAudioLayer = audioLayers.find(
    (layer) => layer._id.toString() === audioLayerId
  );

  if (!currentAudioLayer) {
    // You may opt to delete the AudioGeneration doc anyway
    await AudioGeneration.findByIdAndDelete(audioGenerationId);
    return;
  }

  const requestedDuration = Number(audioGeneration.duration);
  const generatedLyrics = typeof audioGeneration?.generationMeta?.lyrics === 'string'
    ? audioGeneration.generationMeta.lyrics.trim()
    : '';
  const lyric = generatedLyrics || (audioGeneration.isInstrumental ? '[Instrumental]' : '');

  const layerUpdateSet = {
    'audioLayers.$.generationStatus': 'COMPLETED',
    'audioLayers.$.generationError': null,
    'audioLayers.$.errorMessage': null,
    'audioLayers.$.error': null,
    'audioLayers.$.remoteAudioLinks': s3Urls,
    'audioLayers.$.remoteAudioData': [
      {
        audio_url: s3Urls[0],
        title: 'Music',
        ...(lyric ? { lyric } : {}),
        _id: audioLayerId,
      },
    ],
    'audioLayers.$.localAudioLinks': [localFilePath],
  };

  if (Number.isFinite(requestedDuration) && requestedDuration > 0) {
    layerUpdateSet['audioLayers.$.duration'] = requestedDuration;
    if (Number.isFinite(Number(currentAudioLayer.startTime))) {
      layerUpdateSet['audioLayers.$.endTime'] = Number(currentAudioLayer.startTime) + requestedDuration;
    }
  }

  if (sessionData.isExpressGeneration) {
    layerUpdateSet['audioLayers.$.selectedLocalAudioLink'] = localFilePath;
    layerUpdateSet['audioLayers.$.fadeOnEdges'] = true;
  }

  const updatedSession = await VideoSession.findOneAndUpdate(
    { _id: sessionId, 'audioLayers._id': audioLayerId },
    { $set: layerUpdateSet },
    { new: true }
  );
  if (!updatedSession) {
    throw new Error(`VideoSession ${sessionId} audioLayerId ${audioLayerId} not found while attaching generated audio.`);
  }
  const updatedAudioLayer = updatedSession.audioLayers.find(
    (layer) => layer._id.toString() === audioLayerId
  );

  await upsertGeneratedMusicArtifact({
    sessionData: updatedSession,
    currentAudioLayer: updatedAudioLayer,
    audioGeneration,
    localAudioPath: localFilePath,
  });

  // Update the AudioGeneration doc or remove if done
  // In your snippet, you often remove the doc after success
  await AudioGeneration.findByIdAndDelete(audioGenerationId);

}

/**
 * Marks an AudioGeneration and its corresponding VideoSession layer as FAILED,
 * with optional handling for retry logic. Reusable for CassetteAI, Audiocraft, etc.
 */
export async function markAudioGenerationAsFailed(audioGenerationId, errorMessage) {
  await getDBConnectionString();

  // Mark AudioGeneration doc
  const audioGeneration = await AudioGeneration.findById(audioGenerationId);
  if (!audioGeneration) {
    return;
  }

  const normalizedGenerationType = typeof audioGeneration.generationType === 'string'
    ? audioGeneration.generationType.trim().toLowerCase()
    : '';
  const failureMessage = errorMessage || 'Audio generation failed.';

  audioGeneration.status = 'FAILED';
  if (normalizedGenerationType === 'music') {
    audioGeneration.musicGenerationStatus = 'FAILED';
  }
  audioGeneration.error = failureMessage;
  await audioGeneration.save();

  if (await failStandaloneExternalAudioGeneration(audioGeneration, failureMessage)) {
    return;
  }

  // Also mark the corresponding VideoSession audioLayer as failed
  const { sessionId, audioLayerId } = audioGeneration;
  if (!sessionId || !audioLayerId) {
    return;
  }

  const sessionData = await VideoSession.findById(sessionId).select('isExpressGeneration expressGenerationStatus');
  if (!sessionData) {
    return;
  }

  const failureUpdateSet = {
    'audioLayers.$.generationStatus': 'FAILED',
    'audioLayers.$.generationError': failureMessage,
    audioGenerationPending: false,
  };

  if (sessionData.isExpressGeneration && sessionData.expressGenerationStatus) {
    failureUpdateSet['expressGenerationStatus.audio_generation'] = 'FAILED';
    if (normalizedGenerationType === 'speech') {
      failureUpdateSet['expressGenerationStatus.speech_generation'] = 'FAILED';
    } else if (normalizedGenerationType === 'music') {
      failureUpdateSet['expressGenerationStatus.music_generation'] = 'FAILED';
    }
    failureUpdateSet.expressGenerationFailed = true;
    failureUpdateSet.expressGenerationError = failureMessage;
  }

  await VideoSession.updateOne(
    { _id: sessionId, 'audioLayers._id': audioLayerId },
    { $set: failureUpdateSet }
  );
}

/**
 * A convenience method that:
 *   1) Downloads a remote audio URL to a local file
 *   2) Uploads it to S3
 *   3) Attaches references to the VideoSession
 *   4) Cleans up the AudioGeneration doc
 *
 * You can reuse this for CassetteAI or any other external audio generator
 * that returns a final URL to the generated audio.
 */
export async function finalizeAudioBufferGeneration({
  sessionId,
  audioLayerId,
  audioGenerationId,
  audioBuffer
}) {
  try {
    await getDBConnectionString();
    const audioGeneration = await AudioGeneration.findById(audioGenerationId).lean();
    const shouldLoopBackingTrack = shouldLoopBackingTrackAudio(audioGeneration);
    const targetDurationSeconds = Number(audioGeneration?.duration);
    const fileBuffer = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);

    // 2) Write locally
    const localFolderPath = getLocalAudioFolderPath(sessionId, audioLayerId);
    ensureLocalFolderExists(localFolderPath);
    const sourceAudioFileName = shouldLoopBackingTrack ? 'source-output.mp3' : 'output.mp3';
    const sourceAudioFilePath = path.join(localFolderPath, sourceAudioFileName);
    const localFilePath = path.join(localFolderPath, 'output.mp3');

    await writeBufferToLocalFile(sourceAudioFilePath, fileBuffer);

    let uploadedLocalFilePath = sourceAudioFilePath;
    let finalLocalAudioFileName = sourceAudioFileName;
    if (shouldLoopBackingTrack && Number.isFinite(targetDurationSeconds) && targetDurationSeconds > 0) {
      const loopedAudio = await createLoopedAudioTrackForDuration({
        sourceAudioPath: sourceAudioFilePath,
        outputFilePath: localFilePath,
        wantedDuration: targetDurationSeconds,
      });
      uploadedLocalFilePath = loopedAudio.outputFilePath;
      finalLocalAudioFileName = path.basename(loopedAudio.outputFilePath);
    }

    // 3) Upload to S3
    const s3Urls = await uploadLocalAudioToS3(sessionId, uploadedLocalFilePath);

    if (
      shouldLoopBackingTrack &&
      path.resolve(sourceAudioFilePath) !== path.resolve(uploadedLocalFilePath)
    ) {
      await fs.promises.unlink(sourceAudioFilePath).catch(() => {});
    }

    // 4) Update session & remove AudioGeneration doc
    await attachAudioToSessionAndCleanup({
      sessionId,
      audioLayerId,
      audioGenerationId,
      localAudioFileName: finalLocalAudioFileName,
      s3Urls
    });
  } catch (err) {
    console.error('Error finalizing audio buffer generation:', err.message);
    await markAudioGenerationAsFailed(audioGenerationId, err.message);
  }
}

export async function finalizeRemoteAudioGeneration({
  sessionId,
  audioLayerId,
  audioGenerationId,
  remoteAudioUrl
}) {
  try {
    const fileBuffer = await downloadAudioAsBuffer(remoteAudioUrl);
    await finalizeAudioBufferGeneration({
      sessionId,
      audioLayerId,
      audioGenerationId,
      audioBuffer: fileBuffer,
    });
  } catch (err) {
    console.error('Error finalizing remote audio generation:', err.message);
    await markAudioGenerationAsFailed(audioGenerationId, err.message);
  }
}
