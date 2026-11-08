import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getCompletedFrameCleanupConfig } from './CleanupConfig.js';

const CACHE_PREFIXES = [
  ['video', 'frames'],
  ['ai_video', 'frames'],
  ['global_videos', 'frames'],
  ['video', 'narrator_avatar', 'frames'],
  ['video', 'narrator_avatar', 'joined_frames'],
];
const SESSION_ID = /^[a-f\d]{24}$/i;
const FINAL_VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.mkv', '.m4v']);
const PENDING_FLAGS = [
  'expressGenerationPending', 'videoGenerationPending', 'frameGenerationPending', 'framesGenerationPending',
  'audioGenerationPending', 'transcriptGenerationPending', 'aiVideoGenerationPending',
  'aiVideoFrameGenerationPending', 'lipSyncGenerationPending', 'soundEffectGenerationPending',
  'narratorAvatarGenerationPending', 'userVideoGenerationPending', 'videoEditPending',
  'maskGenerationPending',
  'isFrameGenerating',
];
const ACTIVE_FRAME_STATUSES = new Set(['PENDING', 'PROCESSING', 'RUNNING', 'GENERATING', 'QUEUED']);

class UnsafeTree extends Error {}

function sameIdentity(left, right) {
  return left && right && left.dev === right.dev && left.ino === right.ino;
}

function safeName(name) {
  return typeof name === 'string' && name !== '.' && name !== '..' &&
    !/[\\/\0]/.test(name) && name.length > 0;
}

function activity(stats) {
  return Math.max(Number(stats.mtimeMs) || 0, Number(stats.ctimeMs) || 0);
}

function updatedAt(session) {
  if (session.updatedAt === undefined || session.updatedAt === null) return 0;
  const time = new Date(session.updatedAt).getTime();
  return Number.isFinite(time) ? time : null;
}

export function getCompletedFrameCleanupSkipReason(state) {
  if (!state || !state.session || state.hasActiveJobs !== false) {
    return state?.hasActiveJobs === true ? 'skippedActive' : 'skippedUnknown';
  }
  const session = state.session;
  const pending = (entry) => entry && (PENDING_FLAGS.some((name) => entry[name] === true) ||
    ['framesGenerationStatus', 'frameGenerationStatus'].some((name) =>
      ACTIVE_FRAME_STATUSES.has(String(entry[name] || '').toUpperCase())));
  if (pending(session) || (session.layers || []).some(pending) ||
      (session.global_videos || []).some(pending) || (session.globalVideos || []).some(pending) ||
      (session.branchRenderPaths || []).some((branch) => pending(branch) || (branch.timeline || []).some(pending))) {
    return 'skippedActive';
  }
  if (session.expressGenerationFailed === true || session.videoGenerationFailed === true ||
      session.frameGenerationFailed === true ||
      session.expressGenerationStatus?.status !== 'COMPLETED' ||
      session.expressGenerationStatus?.video_generation !== 'COMPLETED') {
    return 'skippedIncomplete';
  }
  if (![session.videoLink, session.remoteURL].some((value) => typeof value === 'string' && value.trim())) {
    return 'skippedMissingOutput';
  }
  return updatedAt(session) === null ? 'skippedUnknown' : null;
}

function log(logger, level, message, details) {
  const write = logger?.[level] || logger?.log;
  if (typeof write === 'function') write.call(logger, message, details);
}

async function optionalStat(fsImpl, filename) {
  try { return await fsImpl.lstat(filename); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function scopedDirectory(fsImpl, root, parts) {
  let filename = root.path;
  let stats = await optionalStat(fsImpl, filename);
  if (!sameIdentity(stats, root.identity) || !stats.isDirectory() || stats.isSymbolicLink()) {
    throw new UnsafeTree('Media root changed.');
  }
  for (const part of parts) {
    if (!safeName(part)) throw new UnsafeTree('Unsafe path component.');
    filename = path.join(filename, part);
    stats = await optionalStat(fsImpl, filename);
    if (!stats) return null;
    if (!stats.isDirectory() || stats.isSymbolicLink() || stats.dev !== root.identity.dev) {
      throw new UnsafeTree('Unsafe cache directory.');
    }
  }
  if (await fsImpl.realpath(filename) !== filename) throw new UnsafeTree('Cache directory traverses a symlink.');
  return { filename, stats };
}

async function inspectTree(fsImpl, root, parts) {
  const directory = await scopedDirectory(fsImpl, root, parts);
  if (!directory) return null;
  const digest = createHash('sha256');
  let files = 0;
  let bytes = 0;
  let newest = 0;
  async function visit(filename, relative, stats) {
    if (stats.isSymbolicLink() || stats.dev !== root.identity.dev ||
        (!stats.isDirectory() && !stats.isFile())) throw new UnsafeTree('Unsafe entry in frame cache.');
    newest = Math.max(newest, activity(stats));
    digest.update(JSON.stringify([relative, stats.isDirectory() ? 'directory' : 'file',
      String(stats.dev), String(stats.ino), stats.size, stats.mtimeMs, stats.ctimeMs]));
    if (stats.isFile()) { files++; bytes += stats.size; return; }
    const names = (await fsImpl.readdir(filename)).sort();
    for (const name of names) {
      if (!safeName(name)) throw new UnsafeTree('Unsafe frame cache entry name.');
      const child = path.join(filename, name);
      const childStats = await optionalStat(fsImpl, child);
      if (!childStats) throw new UnsafeTree('Frame cache changed while inspecting.');
      await visit(child, relative ? `${relative}/${name}` : name, childStats);
    }
  }
  await visit(directory.filename, '', directory.stats);
  return { parts, filename: directory.filename, identity: directory.stats, files, bytes, newest,
    signature: digest.digest('hex') };
}

async function finalVideo(fsImpl, roots, sessionId) {
  for (const root of roots) {
    const directory = await scopedDirectory(fsImpl, root, ['video', 'output', sessionId]);
    if (!directory) continue;
    async function visit(filename) {
      for (const name of (await fsImpl.readdir(filename)).sort()) {
        if (!safeName(name)) throw new UnsafeTree('Unsafe final video entry.');
        const child = path.join(filename, name);
        const stats = await optionalStat(fsImpl, child);
        if (!stats || stats.isSymbolicLink() || stats.dev !== root.identity.dev) continue;
        if (stats.isFile() && stats.size > 0 && FINAL_VIDEO_EXTENSIONS.has(path.extname(name).toLowerCase())) {
          if (await fsImpl.realpath(child) !== child) throw new UnsafeTree('Final video traverses a symlink.');
          return { root, filename: child, identity: stats };
        }
        if (stats.isDirectory()) {
          const found = await visit(child);
          if (found) return found;
        }
      }
      return null;
    }
    const found = await visit(directory.filename);
    if (found) return found;
  }
  return null;
}

async function diskState(fsImpl, root) {
  const stats = await fsImpl.statfs(root.path);
  const size = Number(stats.bsize);
  const blocks = Number(stats.blocks);
  const free = Number(stats.bfree);
  const reportedAvailable = Number(stats.bavail);
  const available = Math.max(0, reportedAvailable);
  if (![size, blocks, free, reportedAvailable].every(Number.isFinite) || size <= 0 || blocks <= 0 ||
      free < 0 || free > blocks || available < 0 || available > free) {
    throw new Error('Unable to determine media filesystem capacity safely.');
  }
  return { availableBytes: available * size, usedPercent: 100 * (blocks - free) / blocks };
}

/** Reclaim only verified, completed sessions' disposable frame-cache trees. */
export async function cleanupCompletedSessionFrames({
  assetsRoots = [], loadSessionState, env = process.env, now = Date.now(),
  logger = console, fsImpl = fs.promises,
} = {}) {
  const config = getCompletedFrameCleanupConfig(env);
  const counters = { enabled: config.enabled, dryRun: config.dryRun,
    rootsScanned: 0, candidatesScanned: 0, eligibleSessions: 0,
    deletedSessions: 0, deletedDirectories: 0, deletedFiles: 0, deletedBytes: 0,
    wouldDeleteDirectories: 0, wouldDeleteFiles: 0, wouldDeleteBytes: 0,
    skippedActive: 0, skippedIncomplete: 0, skippedMissingOutput: 0,
    skippedGrace: 0, skippedUnknown: 0, skippedUnsafe: 0, skippedChanged: 0,
    pressureFilesystems: 0, recoveredFilesystems: 0 };
  if (!config.enabled) return counters;
  if (typeof loadSessionState !== 'function') throw new Error('loadSessionState must be a function.');
  const nowMs = typeof now === 'function' ? now() : Number(now);
  if (!Number.isFinite(nowMs)) throw new Error('now must be a valid timestamp.');

  const roots = [];
  for (const value of assetsRoots) {
    if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0') ||
        value.split(/[\\/]/).includes('..') || path.parse(value).root === path.resolve(value)) {
      counters.skippedUnsafe++; continue;
    }
    const identity = await optionalStat(fsImpl, value);
    if (!identity) continue;
    if (!identity.isDirectory() || identity.isSymbolicLink()) { counters.skippedUnsafe++; continue; }
    const canonical = await fsImpl.realpath(value);
    const canonicalIdentity = await fsImpl.lstat(canonical);
    const repeatedIdentity = await optionalStat(fsImpl, value);
    if (!repeatedIdentity || repeatedIdentity.isSymbolicLink() ||
        !sameIdentity(identity, repeatedIdentity) || !sameIdentity(identity, canonicalIdentity)) {
      counters.skippedUnsafe++; continue;
    }
    if (roots.some((root) => root.path === canonical)) continue;
    roots.push({ path: canonical, identity: canonicalIdentity });
  }
  counters.rootsScanned = roots.length;
  const groups = new Map();
  for (const root of roots) {
    let group = groups.get(String(root.identity.dev));
    if (!group) {
      group = { root, sessions: new Map(), disk: await diskState(fsImpl, root) };
      groups.set(String(root.identity.dev), group);
    }
    for (const prefix of CACHE_PREFIXES) {
      let directory;
      try { directory = await scopedDirectory(fsImpl, root, prefix); }
      catch (error) { if (error instanceof UnsafeTree) { counters.skippedUnsafe++; continue; } throw error; }
      if (!directory) continue;
      for (const id of await fsImpl.readdir(directory.filename)) {
        if (!SESSION_ID.test(id)) continue;
        const entry = { root, parts: [...prefix, id] };
        const session = group.sessions.get(id) || { id, entries: [] };
        session.entries.push(entry);
        group.sessions.set(id, session);
      }
    }
  }
  async function load(id) {
    try { return await loadSessionState(id); }
    catch {
      log(logger, 'warn', '[task-processor] Frame cleanup stopped: session verification unavailable.', { sessionId: id });
      throw new Error('Completed-frame cleanup could not verify session state; no further caches were removed.');
    }
  }
  const deletedSessions = new Set();
  for (const group of groups.values()) {
    const pressure = group.disk.usedPercent >= config.pressureUsedPercent ||
      group.disk.availableBytes < config.pressureAvailableBytes;
    if (pressure) counters.pressureFilesystems++;
    const candidates = [];
    for (const candidate of group.sessions.values()) {
      counters.candidatesScanned++;
      const state = await load(candidate.id);
      const reason = getCompletedFrameCleanupSkipReason(state);
      if (reason) { counters[reason]++; continue; }
      try {
        candidate.final = await finalVideo(fsImpl, roots, candidate.id);
        if (!candidate.final) { counters.skippedMissingOutput++; continue; }
        candidate.trees = [];
        for (const entry of candidate.entries) {
          const tree = await inspectTree(fsImpl, entry.root, entry.parts);
          if (tree) candidate.trees.push({ ...tree, root: entry.root });
        }
        if (!candidate.trees.length) continue;
        candidate.updatedAt = updatedAt(state.session);
        candidate.newest = Math.max(candidate.updatedAt, ...candidate.trees.map((tree) => tree.newest));
        if (!pressure && nowMs - candidate.newest < config.minCompletedAgeMs) { counters.skippedGrace++; continue; }
        counters.eligibleSessions++;
        candidates.push(candidate);
      } catch (error) {
        if (error instanceof UnsafeTree || error.code === 'ENOENT') { counters.skippedUnsafe++; continue; }
        throw error;
      }
    }
    candidates.sort((left, right) => left.newest - right.newest || left.id.localeCompare(right.id));
    let recovered = false;
    for (const candidate of candidates) {
      if (recovered) break;
      for (const tree of candidate.trees) {
        if (pressure) {
          group.disk = await diskState(fsImpl, group.root);
          if (group.disk.availableBytes >= config.targetAvailableBytes && group.disk.usedPercent < config.targetUsedPercent) {
            recovered = true;
            counters.recoveredFilesystems++;
            break;
          }
        }
        const state = await load(candidate.id);
        const reason = getCompletedFrameCleanupSkipReason(state);
        if (reason) { counters[reason]++; break; }
        if (updatedAt(state.session) !== candidate.updatedAt) { counters.skippedChanged++; break; }
        let current;
        try {
          const final = await finalVideo(fsImpl, roots, candidate.id);
          if (!final || !sameIdentity(final.identity, candidate.final.identity)) { counters.skippedMissingOutput++; break; }
          current = await inspectTree(fsImpl, tree.root, tree.parts);
          if (!current || current.signature !== tree.signature || !sameIdentity(current.identity, tree.identity)) {
            counters.skippedChanged++; break;
          }
          // A large cache walk can take time. New work may have started without
          // changing these old files, so verify database/queue state after it.
          const latest = await load(candidate.id);
          const latestReason = getCompletedFrameCleanupSkipReason(latest);
          if (latestReason) { counters[latestReason]++; break; }
          if (updatedAt(latest.session) !== candidate.updatedAt) { counters.skippedChanged++; break; }
          const finalStats = await optionalStat(fsImpl, final.filename);
          if (!finalStats || !finalStats.isFile() || finalStats.isSymbolicLink() || finalStats.size <= 0 ||
              !sameIdentity(finalStats, final.identity) || await fsImpl.realpath(final.filename) !== final.filename) {
            counters.skippedMissingOutput++; break;
          }
          if (!pressure && nowMs - Math.max(current.newest, updatedAt(state.session)) < config.minCompletedAgeMs) {
            counters.skippedGrace++; break;
          }
          // Repeat the scoped ancestor check after inspecting the descendants.
          const scoped = await scopedDirectory(fsImpl, tree.root, tree.parts);
          if (!scoped || !sameIdentity(scoped.stats, current.identity)) { counters.skippedChanged++; break; }
        } catch (error) {
          if (error instanceof UnsafeTree || error.code === 'ENOENT') { counters.skippedUnsafe++; break; }
          throw error;
        }
        if (config.dryRun) {
          counters.wouldDeleteDirectories++;
          counters.wouldDeleteFiles += current.files;
          counters.wouldDeleteBytes += current.bytes;
          continue;
        }
        await fsImpl.rm(current.filename, { recursive: true, force: false });
        deletedSessions.add(candidate.id);
        counters.deletedDirectories++;
        counters.deletedFiles += current.files;
        counters.deletedBytes += current.bytes;
        log(logger, 'info', '[task-processor] Removed completed-session frame cache.', {
          sessionId: candidate.id, prefix: tree.parts.slice(0, -1).join('/'),
          files: current.files, bytes: current.bytes, pressure,
        });
        if (pressure) {
          group.disk = await diskState(fsImpl, group.root);
          recovered = group.disk.availableBytes >= config.targetAvailableBytes &&
            group.disk.usedPercent < config.targetUsedPercent;
          if (recovered) { counters.recoveredFilesystems++; break; }
        }
      }
    }
  }
  counters.deletedSessions = deletedSessions.size;
  log(logger, 'info', '[task-processor] Completed-session frame cleanup finished.', counters);
  return counters;
}
