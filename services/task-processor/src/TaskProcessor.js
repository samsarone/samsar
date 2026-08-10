import fs from 'fs';
import path from 'path';
import os from 'os';
import axios from 'axios';

import VideoSession from './schema/VideoSession.js';
import User from './schema/User.js';
import PendingUserMusicGeneration from './schema/PendingUserMusicGeneration.js';
import GeneratedMusic from './schema/GeneratedMusic.js';

import { getDBConnectionString } from './DBString.js';


const DEFAULT_STALE_SESSION_FRAME_CLEANUP_HOURS = 4;
const DEFAULT_STALE_SESSION_FRAME_CLEANUP_BATCH_SIZE = 64;
const DEFAULT_INTERMEDIATE_MEDIA_CLEANUP_HOURS = 4;

const MEDIA_FILE_EXTENSIONS = new Set([
  '.aac',
  '.aiff',
  '.avi',
  '.bmp',
  '.flac',
  '.gif',
  '.jpeg',
  '.jpg',
  '.m4a',
  '.m4v',
  '.mkv',
  '.mov',
  '.mp3',
  '.mp4',
  '.ogg',
  '.png',
  '.tif',
  '.tiff',
  '.vtt',
  '.wav',
  '.webm',
  '.webp',
]);

// Utility function to append info to cron log
function logInfo(message) {
  const timestamp = new Date().toISOString();
  const logPath = process.env.TASK_PROCESSOR_CRON_LOG_PATH ||
    path.join(os.homedir(), 'cronTabs.log');
  fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
}

// Utility function to append error to cron error log
function logError(message) {
  const timestamp = new Date().toISOString();
  const errorPath = process.env.TASK_PROCESSOR_CRON_ERROR_PATH ||
    path.join(os.homedir(), 'cronTabs.error');
  fs.appendFileSync(errorPath, `[${timestamp}] ${message}\n`);
}

function readPositiveIntegerEnv(name, fallbackValue) {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === '') {
    return fallbackValue;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsedValue) || parsedValue < 1) {
    logError(`Invalid ${name} value "${rawValue}". Falling back to ${fallbackValue}.`);
    return fallbackValue;
  }

  return parsedValue;
}

function isTaskProcessorFeatureEnabled(
  featureName,
  env = process.env,
  dockerMarkerPresent = fs.existsSync('/.dockerenv'),
  dockerDefault = false,
) {
  const configuredValue = env[featureName];
  if (configuredValue !== undefined && configuredValue !== '') {
    return String(configuredValue).trim().toLowerCase() === 'true';
  }

  const samsarRuntime = String(env.SAMSAR_RUNTIME || '').trim().toLowerCase();
  const currentEnv = String(env.CURRENT_ENV || '').trim().toLowerCase();
  const isDockerRuntime =
    dockerMarkerPresent ||
    samsarRuntime === 'docker' ||
    currentEnv === 'docker';

  // Preserve legacy behavior for non-Docker cron execution. Safe maintenance
  // can opt in by default in Docker, while generation mutations remain off.
  return isDockerRuntime ? dockerDefault : true;
}

export function isTaskProcessorGenerationSideEffectsEnabled(
  env = process.env,
  dockerMarkerPresent = fs.existsSync('/.dockerenv'),
) {
  return isTaskProcessorFeatureEnabled(
    'TASK_PROCESSOR_ENABLE_GENERATION_SIDE_EFFECTS',
    env,
    dockerMarkerPresent,
  );
}

export function isTaskProcessorFileCleanupEnabled(
  env = process.env,
  dockerMarkerPresent = fs.existsSync('/.dockerenv'),
) {
  return isTaskProcessorFeatureEnabled(
    'TASK_PROCESSOR_ENABLE_FILE_CLEANUP',
    env,
    dockerMarkerPresent,
    true,
  );
}

function getProcessorAssetsRoot(folderName) {
  if (folderName === 'assets_v2' && process.env.SAMSAR_ASSETS_V2_ROOT) {
    return process.env.SAMSAR_ASSETS_V2_ROOT;
  }

  if (folderName === 'assets' && process.env.SAMSAR_ASSETS_ROOT) {
    return process.env.SAMSAR_ASSETS_ROOT;
  }

  return path.join(process.cwd(), '..', 'samsar_processor', folderName);
}

function removeDirectoryIfExists(folderPath) {
  if (!fs.existsSync(folderPath)) {
    return false;
  }

  fs.rmSync(folderPath, { recursive: true, force: true });
  return true;
}

function isMediaFile(filePath) {
  return MEDIA_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function removeEmptyDirectories(directoryPath, rootPath) {
  if (directoryPath === rootPath) {
    return;
  }

  let entries;
  try {
    entries = await fs.promises.readdir(directoryPath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    return;
  }

  if (entries.length > 0) {
    return;
  }

  await fs.promises.rmdir(directoryPath);
}

async function deleteOldMediaFiles(directoryPath, rootPath, cutoffTimeMs, counters) {
  let entries;
  try {
    entries = await fs.promises.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      await deleteOldMediaFiles(entryPath, rootPath, cutoffTimeMs, counters);
      await removeEmptyDirectories(entryPath, rootPath);
      continue;
    }

    if (!entry.isFile() || !isMediaFile(entryPath)) {
      continue;
    }

    let stats;
    try {
      stats = await fs.promises.stat(entryPath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      continue;
    }

    if (stats.mtimeMs > cutoffTimeMs) {
      continue;
    }

    await fs.promises.unlink(entryPath);
    counters.deletedFiles += 1;
    counters.deletedBytes += stats.size;
  }
}

function createStaleVideoSessionCursor(
  VideoSessionModel,
  staleBefore,
  batchSize,
) {
  return VideoSessionModel.find({
    updatedAt: { $lt: staleBefore },
    isGuestSession: false,
    isIntroSession: false,
  })
    .select({ _id: 1 })
    .lean()
    .batchSize(batchSize)
    .cursor();
}

async function markSessionFramesForRegeneration(
  sessionId,
  VideoSessionModel = VideoSession,
) {
  await VideoSessionModel.updateOne(
    { _id: sessionId },
    { $set: { frameGenerationPending: true } },
  );

  // Updating every layer in place avoids loading or replacing the potentially
  // very large layers array and does not overwrite concurrent layer changes.
  await VideoSessionModel.updateOne(
    { _id: sessionId, 'layers.0': { $exists: true } },
    { $set: { 'layers.$[].frameGenerationPending': true } },
  );
}

export async function deleteFramesForStaleSessions() {
  await getDBConnectionString();

  const staleSessionFrameCleanupHours = readPositiveIntegerEnv(
    'STALE_SESSION_FRAME_CLEANUP_HOURS',
    DEFAULT_STALE_SESSION_FRAME_CLEANUP_HOURS,
  );
  const staleSessionFrameCleanupBatchSize = readPositiveIntegerEnv(
    'STALE_SESSION_FRAME_CLEANUP_BATCH_SIZE',
    DEFAULT_STALE_SESSION_FRAME_CLEANUP_BATCH_SIZE,
  );
  const staleBefore = new Date(
    Date.now() - staleSessionFrameCleanupHours * 60 * 60 * 1000,
  );
  const videoSessionCursor = createStaleVideoSessionCursor(
    VideoSession,
    staleBefore,
    staleSessionFrameCleanupBatchSize,
  );
  const generationSideEffectsEnabled =
    isTaskProcessorGenerationSideEffectsEnabled();

  const legacyAssetsRoot = getProcessorAssetsRoot('assets');
  const assetsV2Root = getProcessorAssetsRoot('assets_v2');
  let checkedSessionCount = 0;
  let deletedFrameFolderCount = 0;

  try {
    for await (const videoSession of videoSessionCursor) {
      checkedSessionCount += 1;

      try {
        const sessionId = videoSession._id.toString();
        const framePaths = [
          path.join(legacyAssetsRoot, 'video', 'frames', sessionId),
          path.join(assetsV2Root, 'video', 'frames', sessionId),
          path.join(assetsV2Root, 'video', 'narrator_avatar', 'frames', sessionId),
          path.join(assetsV2Root, 'video', 'narrator_avatar', 'joined_frames', sessionId),
        ];
        const aiVideoFramePaths = [
          path.join(legacyAssetsRoot, 'ai_video', 'frames', sessionId),
          path.join(assetsV2Root, 'ai_video', 'frames', sessionId),
        ];
        const existingFramePaths = framePaths.filter((folderPath) => fs.existsSync(folderPath));

        if (existingFramePaths.length > 0 && generationSideEffectsEnabled) {
          // Persist regeneration intent before deleting files. If the process
          // exits between these operations, the next run can safely retry the
          // still-present directory without losing the database signal.
          await markSessionFramesForRegeneration(videoSession._id);
        }

        for (const folderPath of existingFramePaths) {
          if (removeDirectoryIfExists(folderPath)) {
            deletedFrameFolderCount += 1;
          }
        }

        // Delete AI frames
        for (const aiVideoFramePath of aiVideoFramePaths) {
          if (removeDirectoryIfExists(aiVideoFramePath)) {
            deletedFrameFolderCount += 1;
          }
        }

      } catch (error) {
        logError(`Error while deleting folder for session ${videoSession._id}: ${error.message}`);
      }
    }
  } finally {
    await videoSessionCursor.close();
  }

  logInfo(`Stale session frame cleanup checked ${checkedSessionCount} session(s); deleted ${deletedFrameFolderCount} frame folder(s).`);
}

export async function cleanupOldLocalAssetsV2Media() {
  const assetsV2Root = getProcessorAssetsRoot('assets_v2');
  const resolvedAssetsV2Root = path.resolve(assetsV2Root);
  if (path.basename(resolvedAssetsV2Root) !== 'assets_v2') {
    throw new Error(`Refusing assets_v2 cleanup for unexpected root: ${assetsV2Root}`);
  }

  if (!fs.existsSync(assetsV2Root)) {
    logInfo(`assets_v2 cleanup skipped; root does not exist: ${assetsV2Root}`);
    return { deletedFiles: 0, deletedBytes: 0 };
  }

  const cleanupHours = readPositiveIntegerEnv(
    'INTERMEDIATE_MEDIA_CLEANUP_HOURS',
    DEFAULT_INTERMEDIATE_MEDIA_CLEANUP_HOURS,
  );
  const cutoffTimeMs = Date.now() - cleanupHours * 60 * 60 * 1000;
  const counters = { deletedFiles: 0, deletedBytes: 0 };
  const temporaryRenderRoot = path.join(resolvedAssetsV2Root, 'ai_video', 'temp');

  // Never sweep assets_v2 itself. That tree contains final renders and user
  // resources. Only the known temporary render path is eligible here; session
  // frame directories are handled separately by deleteFramesForStaleSessions.
  await deleteOldMediaFiles(
    temporaryRenderRoot,
    temporaryRenderRoot,
    cutoffTimeMs,
    counters,
  );

  logInfo(
    `Intermediate media cleanup deleted ${counters.deletedFiles} file(s), ${counters.deletedBytes} byte(s), older than ${cleanupHours} hour(s) from ${temporaryRenderRoot}.`,
  );

  return counters;
}

export async function downloadMusicForCompletedGenerations() {
  if (!isTaskProcessorGenerationSideEffectsEnabled()) {
    logInfo('Pending music generation processing skipped because generation side effects are disabled.');
    return;
  }

  await getDBConnectionString();

  const fiveMinAgo = new Date(Date.now() - 60 * 5 * 1000);
  const pendingRecords = await PendingUserMusicGeneration.find({
    createdAt: { $lt: fiveMinAgo },
    rowLocked: false
  });

  for (const record of pendingRecords) {
    await PendingUserMusicGeneration.updateOne({ _id: record._id }, { rowLocked: true });

    try {
      const musicGenerationIds = record.musicGenerationIds;

      if (musicGenerationIds.length === 0) {
        // Skip this record; no tasks to check
        await PendingUserMusicGeneration.deleteOne({ _id: record._id });
        continue;
      }


      // Check if all tasks are complete
      let allTasksComplete = true;
      for (const task of audioGenerationTaskData) {
        if (task.status !== 'complete') {
          allTasksComplete = false;
          break;
        }
      }

      if (!allTasksComplete) {
        // Skip this record; tasks are not complete yet
        continue;
      }

      // Get audio URLs
      const audioRemoteLinks = audioGenerationTaskData.map(task => task.audio_url);

      // Define local paths
      const userId = record.userId;
      const sessionId = record.sessionId;
      const recordId = record._id.toString();

      const localDownloadBase = path.join('generated_music', userId, recordId);
      const localDownloadFolderPath = path.join(getProcessorAssetsRoot('assets_v2'), localDownloadBase);

      if (!fs.existsSync(localDownloadFolderPath)) {
        fs.mkdirSync(localDownloadFolderPath, { recursive: true });
      }

      // Download audio files
      const localAudioFileNames = await downloadRemoteLinks(localDownloadFolderPath, audioRemoteLinks);
      const localAudioPaths = localAudioFileNames.map(fileName => path.join(localDownloadBase, fileName));

      // Create GeneratedMusic records
      for (let i = 0; i < localAudioPaths.length; i++) {
        const localAudioPath = localAudioPaths[i];
        const remoteItem = audioGenerationTaskData[i];
        const remoteLyric = remoteItem.lyric ? remoteItem.lyric.toString() : '';
        const remoteItemTags = remoteItem.tags ? remoteItem.tags.split(' ') : [];

        const generatedMusic = new GeneratedMusic({
          url: localAudioPath,
          prompt: record.prompt,
          sessionId: sessionId,
          userId: userId,
          title: remoteItem.title,
          tags: remoteItemTags,
          lyric: remoteLyric
        });
        await generatedMusic.save();
      }

      // increment User totalAudioInLibrary by 2
      await User.updateOne({ _id: userId }, { $inc: { totalAudioInLibrary: 2 } });

      // Delete the PendingUserMusicGeneration record
      await PendingUserMusicGeneration.deleteOne({ _id: record._id });

    } catch (e) {
      // If download fails, delete the record
      logError(`Error processing record ${record._id}: ${e.message}`);
      await PendingUserMusicGeneration.deleteOne({ _id: record._id });
    }
  }
}

async function downloadRemoteLinks(localDownloadFolderPath, audioRemoteLinks) {
  let localAudioLinks = [];
  for (const audioLink of audioRemoteLinks) {
    try {
      const fileName = audioLink.split('/').pop().split('?')[0]; // Clean file name
      const response = await axios.get(audioLink, { responseType: 'arraybuffer' });
      const savePath = path.join(localDownloadFolderPath, fileName);
      fs.writeFileSync(savePath, response.data);
      localAudioLinks.push(fileName);
    } catch (error) {
      logError(`Failed to download ${audioLink}: ${error.message}`);
      throw error; // Throw to trigger deletion of PendingUserMusicGeneration record
    }
  }
  return localAudioLinks;
}

async function runFileCleanupTasksIfEnabled(
  enabled,
  cleanupOldLocalAssetsV2MediaTask = cleanupOldLocalAssetsV2Media,
  deleteFramesForStaleSessionsTask = deleteFramesForStaleSessions,
) {
  if (!enabled) {
    return false;
  }

  await cleanupOldLocalAssetsV2MediaTask();
  await deleteFramesForStaleSessionsTask();
  return true;
}

export async function runScheduledTasks() {
  try {
    const fileCleanupRan = await runFileCleanupTasksIfEnabled(
      isTaskProcessorFileCleanupEnabled(),
    );
    if (!fileCleanupRan) {
      logInfo('Local media and stale-session frame cleanup skipped because file cleanup is disabled.');
    }

    try {
      await downloadMusicForCompletedGenerations();
    } catch (error) {
      logError(`downloadMusicForCompletedGenerations failed: ${error.message}`);
    }

    logInfo('Cron job completed successfully.');
  } catch (error) {
    logError(`Cron job failed: ${error.message}`);
    throw error;
  }
}

export const __testOnly__ = {
  createStaleVideoSessionCursor,
  markSessionFramesForRegeneration,
  runFileCleanupTasksIfEnabled,
};
