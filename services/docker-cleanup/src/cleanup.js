import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ASSETS_V2_ROOT = '/assets_v2';
const DEFAULT_MIN_AGE_HOURS = 24;

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

export const CLEANUP_TARGETS = Object.freeze([
  {
    id: 'final-session-frames',
    relativePath: 'video/frames',
    mode: 'session-directories',
  },
  {
    id: 'ai-video-frames',
    relativePath: 'ai_video/frames',
    mode: 'session-directories',
  },
  {
    id: 'narrator-avatar-frames',
    relativePath: 'video/narrator_avatar/frames',
    mode: 'session-directories',
  },
  {
    id: 'joined-narrator-avatar-frames',
    relativePath: 'video/narrator_avatar/joined_frames',
    mode: 'session-directories',
  },
  {
    id: 'ai-video-temp-renders',
    relativePath: 'ai_video/temp',
    mode: 'old-media-files',
  },
]);

const PROTECTED_PREFIXES = Object.freeze([
  'ai_video/audio',
  'ai_video/generations',
  'generated_music',
  'generations',
  'temp',
  'user_resources',
  'video/audio',
  'video/output',
  'video/outro',
  'video/narrator_avatar/video',
]);

function log(message, details = undefined) {
  const timestamp = new Date().toISOString();
  if (details === undefined) {
    console.log(`[${timestamp}] ${message}`);
    return;
  }
  console.log(`[${timestamp}] ${message}`, details);
}

function parsePositiveNumber(value, fallbackValue, name) {
  if (value === undefined || value === null || value === '') {
    return fallbackValue;
  }

  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    throw new Error(`${name} must be a positive number; received "${value}"`);
  }

  return parsedValue;
}

function parseBoolean(value, fallbackValue = false) {
  if (value === undefined || value === null || value === '') {
    return fallbackValue;
  }

  return /^(1|true|yes|on)$/i.test(String(value));
}

function normalizeRelativePath(value) {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '/');
}

function isProtectedPath(relativePath) {
  const normalizedPath = normalizeRelativePath(relativePath);
  return PROTECTED_PREFIXES.some((protectedPrefix) => (
    normalizedPath === protectedPrefix ||
    normalizedPath.startsWith(`${protectedPrefix}/`) ||
    protectedPrefix.startsWith(`${normalizedPath}/`)
  ));
}

function resolveAssetsV2Root(rootPath, allowNonAssetsV2Root = false) {
  const resolvedRoot = path.resolve(rootPath || DEFAULT_ASSETS_V2_ROOT);
  if (!allowNonAssetsV2Root && path.basename(resolvedRoot) !== 'assets_v2') {
    throw new Error(`Refusing assets_v2 cleanup for unexpected root: ${resolvedRoot}`);
  }
  return resolvedRoot;
}

function isPathInside(childPath, parentPath) {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function assertSafeTarget(assetsV2Root, target) {
  const relativePath = normalizeRelativePath(target.relativePath);
  if (!relativePath || relativePath.includes('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Unsafe cleanup target path: ${target.relativePath}`);
  }
  if (isProtectedPath(relativePath)) {
    throw new Error(`Refusing cleanup target that overlaps protected assets_v2 path: ${relativePath}`);
  }

  const targetRoot = path.resolve(assetsV2Root, relativePath);
  if (!isPathInside(targetRoot, assetsV2Root)) {
    throw new Error(`Cleanup target escapes assets_v2 root: ${target.relativePath}`);
  }
  return targetRoot;
}

function resolveTargets(rawTargets) {
  if (Array.isArray(rawTargets)) {
    return rawTargets;
  }

  if (!rawTargets) {
    return [...CLEANUP_TARGETS];
  }

  const requestedTargets = String(rawTargets)
    .split(',')
    .map((entry) => normalizeRelativePath(entry))
    .filter(Boolean);

  return requestedTargets.map((requestedTarget) => {
    const target = CLEANUP_TARGETS.find((candidate) => (
      candidate.id === requestedTarget ||
      candidate.relativePath === requestedTarget
    ));

    if (!target) {
      const allowedTargets = CLEANUP_TARGETS
        .map((candidate) => `${candidate.id} (${candidate.relativePath})`)
        .join(', ');
      throw new Error(`Unsupported CLEANUP_TARGETS entry "${requestedTarget}". Allowed targets: ${allowedTargets}`);
    }

    return target;
  });
}

function isMediaFile(filePath) {
  return MEDIA_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function createCounters() {
  return {
    scannedTargets: 0,
    scannedCandidates: 0,
    skippedMissingTargets: 0,
    skippedRecentCandidates: 0,
    deletedDirectories: 0,
    deletedFiles: 0,
    deletedBytes: 0,
    wouldDeleteDirectories: 0,
    wouldDeleteFiles: 0,
    wouldDeleteBytes: 0,
    errors: [],
  };
}

async function summarizePath(entryPath) {
  let stats;
  try {
    stats = await fs.lstat(entryPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  const summary = {
    newestMtimeMs: stats.mtimeMs,
    files: stats.isFile() ? 1 : 0,
    bytes: stats.isFile() ? stats.size : 0,
  };

  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    return summary;
  }

  let children;
  try {
    children = await fs.readdir(entryPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  for (const childName of children) {
    const childSummary = await summarizePath(path.join(entryPath, childName));
    if (!childSummary) {
      continue;
    }

    summary.newestMtimeMs = Math.max(summary.newestMtimeMs, childSummary.newestMtimeMs);
    summary.files += childSummary.files;
    summary.bytes += childSummary.bytes;
  }

  return summary;
}

async function removeEmptyDirectoryIfPossible(directoryPath, rootPath) {
  if (directoryPath === rootPath) {
    return;
  }

  try {
    const entries = await fs.readdir(directoryPath);
    if (entries.length === 0) {
      await fs.rmdir(directoryPath);
    }
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') {
      throw error;
    }
  }
}

async function deleteDirectory(directoryPath, summary, counters, dryRun) {
  if (dryRun) {
    counters.wouldDeleteDirectories += 1;
    counters.wouldDeleteFiles += summary.files;
    counters.wouldDeleteBytes += summary.bytes;
    return;
  }

  await fs.rm(directoryPath, { recursive: true, force: true });
  counters.deletedDirectories += 1;
  counters.deletedFiles += summary.files;
  counters.deletedBytes += summary.bytes;
}

async function deleteFile(filePath, stats, counters, dryRun) {
  if (dryRun) {
    counters.wouldDeleteFiles += 1;
    counters.wouldDeleteBytes += stats.size;
    return;
  }

  await fs.unlink(filePath);
  counters.deletedFiles += 1;
  counters.deletedBytes += stats.size;
}

async function cleanupSessionDirectories(targetRoot, cutoffTimeMs, counters, dryRun) {
  let entries;
  try {
    entries = await fs.readdir(targetRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      counters.skippedMissingTargets += 1;
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      continue;
    }

    counters.scannedCandidates += 1;
    const candidatePath = path.join(targetRoot, entry.name);

    try {
      const summary = await summarizePath(candidatePath);
      if (!summary) {
        continue;
      }

      if (summary.newestMtimeMs > cutoffTimeMs) {
        counters.skippedRecentCandidates += 1;
        continue;
      }

      await deleteDirectory(candidatePath, summary, counters, dryRun);
    } catch (error) {
      counters.errors.push({
        path: candidatePath,
        message: error.message,
      });
    }
  }
}

async function cleanupOldMediaFiles(directoryPath, rootPath, cutoffTimeMs, counters, dryRun) {
  let entries;
  try {
    entries = await fs.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      counters.skippedMissingTargets += 1;
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      await cleanupOldMediaFiles(entryPath, rootPath, cutoffTimeMs, counters, dryRun);
      await removeEmptyDirectoryIfPossible(entryPath, rootPath);
      continue;
    }

    if (!entry.isFile() || !isMediaFile(entryPath)) {
      continue;
    }

    counters.scannedCandidates += 1;

    try {
      const stats = await fs.stat(entryPath);
      if (stats.mtimeMs > cutoffTimeMs) {
        counters.skippedRecentCandidates += 1;
        continue;
      }

      await deleteFile(entryPath, stats, counters, dryRun);
    } catch (error) {
      if (error.code === 'ENOENT') {
        continue;
      }
      counters.errors.push({
        path: entryPath,
        message: error.message,
      });
    }
  }
}

export async function cleanupAssetsV2(options = {}) {
  const env = options.env || process.env;
  const minAgeHours = parsePositiveNumber(
    options.minAgeHours ?? env.CLEANUP_MIN_AGE_HOURS,
    DEFAULT_MIN_AGE_HOURS,
    'CLEANUP_MIN_AGE_HOURS',
  );
  const dryRun = options.dryRun ?? parseBoolean(env.CLEANUP_DRY_RUN, false);
  const allowNonAssetsV2Root = options.allowNonAssetsV2Root ?? parseBoolean(env.ALLOW_NON_ASSETS_V2_ROOT, false);
  const assetsV2Root = resolveAssetsV2Root(
    options.assetsV2Root || env.SAMSAR_ASSETS_V2_ROOT || DEFAULT_ASSETS_V2_ROOT,
    allowNonAssetsV2Root,
  );
  const targets = resolveTargets(options.targets ?? env.CLEANUP_TARGETS);
  const nowMs = options.nowMs ?? Date.now();
  const cutoffTimeMs = nowMs - minAgeHours * 60 * 60 * 1000;
  const counters = createCounters();

  log('assets_v2 cleanup started', {
    assetsV2Root,
    minAgeHours,
    cutoff: new Date(cutoffTimeMs).toISOString(),
    dryRun,
    targets: targets.map((target) => target.relativePath),
  });

  for (const target of targets) {
    const targetRoot = assertSafeTarget(assetsV2Root, target);
    counters.scannedTargets += 1;

    if (target.mode === 'session-directories') {
      await cleanupSessionDirectories(targetRoot, cutoffTimeMs, counters, dryRun);
      continue;
    }

    if (target.mode === 'old-media-files') {
      await cleanupOldMediaFiles(targetRoot, targetRoot, cutoffTimeMs, counters, dryRun);
      continue;
    }

    throw new Error(`Unsupported cleanup target mode: ${target.mode}`);
  }

  log('assets_v2 cleanup completed', counters);
  return counters;
}

async function main() {
  try {
    const counters = await cleanupAssetsV2();
    if (counters.errors.length > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] assets_v2 cleanup failed: ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
  await main();
}
