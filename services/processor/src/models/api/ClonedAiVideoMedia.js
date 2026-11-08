import fs from 'node:fs';
import path from 'node:path';

const MEDIA_FIELDS = [
  { local: 'aiVideoLayer', remote: 'aiVideoRemoteLink', role: 'base' },
  { local: 'lipSyncVideoLayer', remote: 'lipSyncRemoteLink', role: 'lip-sync' },
  { local: 'soundEffectVideoLayer', remote: 'soundEffectRemoteLink', role: 'sound-effect' },
];
const VIDEO_TYPES = new Map([
  ['.mp4', 'video/mp4'], ['.m4v', 'video/mp4'], ['.webm', 'video/webm'],
  ['.mov', 'video/quicktime'], ['.mkv', 'video/x-matroska'], ['.avi', 'video/x-msvideo'],
]);

function component(value, label) {
  const normalized = value?.toString?.().trim();
  if (!normalized || normalized === '.' || normalized === '..' || /[\\/\0]/.test(normalized)) {
    throw new Error(`Cloned AI media requires a safe ${label}.`);
  }
  return normalized;
}

function assetReference(value, sessionId) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let reference = value.trim();
  try {
    if (/^https?:\/\//i.test(reference)) reference = decodeURIComponent(new URL(reference).pathname);
    else reference = reference.split(/[?#]/)[0];
  } catch {
    throw new Error('Cloned AI media has an invalid asset reference.');
  }
  const parts = reference.replace(/^\/+/, '').split('/');
  if (parts.some((part) => part === '..' || part === '.' || part.includes('\0') || part.includes('\\'))) {
    throw new Error('Cloned AI media cannot publish an unsafe asset path.');
  }
  let version;
  if (parts[0] === 'assets_v2' || parts[0] === 'assets') {
    version = parts.shift() === 'assets_v2' ? 'v2' : 'legacy';
  }
  const isGeneratedClip = ['ai_video', 'video', 'global_videos'].includes(parts[0]) &&
    ['generations', 'lip_sync'].includes(parts[1]) && parts[2] === sessionId && parts.length > 3;
  const isResourceClip = parts[0] === 'user_resources' && parts[2] === 'ai_videos' &&
    parts[3] === sessionId && parts.length > 4;
  if (!isGeneratedClip && !isResourceClip) return null;
  return { relative: parts.join('/'), version: version || (isResourceClip ? 'v2' : null) };
}

async function existingClip(reference, roots, fsImpl) {
  const matchingRoots = reference.version
    ? roots.filter((root) => root.version === reference.version)
    : roots;
  const candidates = matchingRoots.length ? matchingRoots : roots.filter((root) => !root.version);
  for (const root of candidates) {
    let current = root.path;
    let missing = false;
    const parts = reference.relative.split('/');
    for (const [index, part] of parts.entries()) {
      current = path.join(current, part);
      let stats;
      try { stats = await fsImpl.lstat(current); }
      catch (error) { if (error.code === 'ENOENT') { missing = true; break; } throw error; }
      if (stats.isSymbolicLink() || (index < parts.length - 1 ? !stats.isDirectory() : !stats.isFile())) {
        throw new Error('Cloned AI media cannot publish a symlink or non-file asset.');
      }
      if (index === parts.length - 1) {
        if (stats.size <= 0) throw new Error('Cloned AI media cannot publish an empty video.');
        const canonical = await fsImpl.realpath(current);
        if (!canonical.startsWith(`${root.path}${path.sep}`)) {
          throw new Error('Cloned AI media escaped its asset root.');
        }
        return { filePath: canonical, stats };
      }
    }
    if (missing) continue;
  }
  return null;
}

function getLayers(session) {
  const candidates = [
    ...(Array.isArray(session.layers) ? session.layers : []),
    ...(Array.isArray(session.branchRenderPaths) ? session.branchRenderPaths : [])
      .flatMap((branch) => Array.isArray(branch?.timeline) ? branch.timeline : []),
  ];
  return [...new Set(candidates.filter((layer) => layer && typeof layer === 'object'))];
}

/** Publish copied clips before a cloned session can enqueue provider work. */
export async function publishClonedAiVideoMedia({
  clonedSession, newSessionId, userId, assetsRoots = [], publishFile, fsImpl = fs.promises,
} = {}) {
  if (!clonedSession || typeof clonedSession !== 'object') throw new TypeError('clonedSession must be an object.');
  const sessionId = component(newSessionId, 'session identifier');
  const ownerId = component(userId, 'user identifier');
  const roots = [];
  for (const entry of assetsRoots) {
    if (typeof entry !== 'string' || !path.isAbsolute(entry)) throw new Error('Cloned AI media requires absolute asset roots.');
    let rootStats;
    try { rootStats = await fsImpl.lstat(entry); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) throw new Error('Cloned AI media requires a real asset directory.');
    const rootPath = await fsImpl.realpath(entry);
    const basename = path.basename(entry);
    roots.push({ path: rootPath, version: basename === 'assets_v2' ? 'v2' : basename === 'assets' ? 'legacy' : null });
  }

  const plans = new Map();
  let references = 0;
  for (const layer of getLayers(clonedSession)) {
    for (const field of MEDIA_FIELDS) {
      const candidates = [layer[field.local], layer[field.remote]]
        .map((value) => assetReference(value, sessionId)).filter(Boolean);
      // Independently hosted or source-session references are not invented keys
      // from this local clone, so leave them untouched.
      if (!candidates.length) continue;
      const layerId = component(layer._id || layer.id, 'layer identifier');
      let clip;
      for (const reference of candidates) {
        clip = await existingClip(reference, roots, fsImpl);
        if (clip) break;
      }
      if (!clip) throw new Error(`Copied ${field.role} video is missing for layer ${layerId}.`);
      const filename = path.basename(clip.filePath);
      const extension = path.extname(filename).toLowerCase();
      const contentType = VIDEO_TYPES.get(extension);
      if (!contentType) throw new Error(`Copied ${field.role} media is not a supported video file.`);
      const prefix = `user_resources/${ownerId}/ai_videos/${sessionId}/${layerId}/`;
      let key = `${prefix}${filename}`;
      let plan = plans.get(key);
      const sameFile = (other) => other.filePath === clip.filePath ||
        (other.stats.dev === clip.stats.dev && other.stats.ino === clip.stats.ino);
      if (plan && !sameFile(plan)) {
        // Distinct derivatives occasionally reuse a filename. Keep each clip
        // instead of overwriting the base video's object with different bytes.
        key = `${prefix}${filename.slice(0, -extension.length)}__${field.role}${extension}`;
        plan = plans.get(key);
        if (plan && !sameFile(plan)) throw new Error(`Conflicting cloned video files for layer ${layerId}.`);
      }
      if (!plan) {
        plan = { ...clip, key, contentType, updates: [] };
        plans.set(key, plan);
      }
      plan.updates.push({ layer, field: field.remote });
      references++;
    }
  }

  if (plans.size && typeof publishFile !== 'function') throw new TypeError('publishFile must be a function.');
  for (const plan of plans.values()) {
    const url = await publishFile({ filePath: plan.filePath, key: plan.key, contentType: plan.contentType });
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      throw new Error('Cloned video publication did not return a media URL.');
    }
    plan.url = url;
  }
  // A failed publication leaves every stored reference unchanged. Callers save
  // this prepared session and enqueue speech/render work only after resolution.
  for (const plan of plans.values()) {
    for (const update of plan.updates) update.layer[update.field] = plan.url;
  }
  return { publishedFiles: plans.size, updatedReferences: references, deduplicatedReferences: references - plans.size };
}
