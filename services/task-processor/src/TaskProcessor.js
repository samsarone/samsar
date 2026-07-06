import fs from 'fs';
import path from 'path';
import os from 'os';
import axios from 'axios';

import VideoSession from './schema/VideoSession.js';
import User from './schema/User.js';
import PendingUserMusicGeneration from './schema/PendingUserMusicGeneration.js';
import GeneratedMusic from './schema/GeneratedMusic.js';

import { getDBConnectionString } from './DBString.js';


// Resolve ~ to the user's home directory
const HOME_DIR = os.homedir();
const CRON_LOG_PATH = path.join(HOME_DIR, 'cronTabs.log');
const CRON_ERROR_PATH = path.join(HOME_DIR, 'cronTabs.error');
const DEFAULT_STALE_SESSION_FRAME_CLEANUP_HOURS = 7 * 24;
const DEFAULT_ASSETS_V2_MEDIA_CLEANUP_DAYS = 7;

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
  fs.appendFileSync(CRON_LOG_PATH, `[${timestamp}] ${message}\n`);
}

// Utility function to append error to cron error log
function logError(message) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(CRON_ERROR_PATH, `[${timestamp}] ${message}\n`);
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

export async function deleteFramesForStaleSessions() {
  await getDBConnectionString();

  const staleSessionFrameCleanupHours = readPositiveIntegerEnv(
    'STALE_SESSION_FRAME_CLEANUP_HOURS',
    DEFAULT_STALE_SESSION_FRAME_CLEANUP_HOURS,
  );

  const videoSessions = await VideoSession.find({
    updatedAt: { $lt: new Date(Date.now() - staleSessionFrameCleanupHours * 60 * 60 * 1000) },
    isGuestSession: false,
    isIntroSession: false,
  });

  const legacyAssetsRoot = getProcessorAssetsRoot('assets');
  const assetsV2Root = getProcessorAssetsRoot('assets_v2');
  let deletedFrameFolderCount = 0;

  for (const videoSession of videoSessions) {
    try {
      const sessionId = videoSession._id.toString();
      const framePaths = [
        path.join(legacyAssetsRoot, 'video', 'frames', sessionId),
        path.join(assetsV2Root, 'video', 'frames', sessionId),
      ];
      const aiVideoFramePaths = [
        path.join(legacyAssetsRoot, 'ai_video', 'frames', sessionId),
        path.join(assetsV2Root, 'ai_video', 'frames', sessionId),
      ];

      // Delete real camera frames
      let deletedRealCameraFrames = false;
      for (const folderPath of framePaths) {
        const deleted = removeDirectoryIfExists(folderPath);
        if (deleted) {
          deletedFrameFolderCount += 1;
          deletedRealCameraFrames = true;
        }
      }

      if (deletedRealCameraFrames) {
        let sessionLayers = videoSession.layers;
        for (let i = 0; i < sessionLayers.length; i++) {
          sessionLayers[i].frameGenerationPending = true;
        }

        await VideoSession.findByIdAndUpdate(videoSession._id, {
          $set: {
            frameGenerationPending: true,
            layers: sessionLayers,
          },
        });
      }

      // Delete AI frames
      for (const aiVideoFramePath of aiVideoFramePaths) {
        if (removeDirectoryIfExists(aiVideoFramePath)) {
          deletedFrameFolderCount += 1;
        }
      }

    } catch (error) {
      // Here you might also want to log errors on a per-session basis:
      logError(`Error while deleting folder for session ${videoSession._id}: ${error.message}`);
    }
  }

  logInfo(`Stale session frame cleanup checked ${videoSessions.length} session(s); deleted ${deletedFrameFolderCount} frame folder(s).`);
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

  const cleanupDays = readPositiveIntegerEnv(
    'ASSETS_V2_MEDIA_CLEANUP_DAYS',
    DEFAULT_ASSETS_V2_MEDIA_CLEANUP_DAYS,
  );
  const cutoffTimeMs = Date.now() - cleanupDays * 24 * 60 * 60 * 1000;
  const counters = { deletedFiles: 0, deletedBytes: 0 };

  await deleteOldMediaFiles(resolvedAssetsV2Root, resolvedAssetsV2Root, cutoffTimeMs, counters);

  logInfo(
    `assets_v2 media cleanup deleted ${counters.deletedFiles} file(s), ${counters.deletedBytes} byte(s), older than ${cleanupDays} day(s) from ${resolvedAssetsV2Root}.`,
  );

  return counters;
}

export async function downloadMusicForCompletedGenerations() {
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

export async function runScheduledTasks() {
  try {
    await cleanupOldLocalAssetsV2Media();
    await deleteFramesForStaleSessions();

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
