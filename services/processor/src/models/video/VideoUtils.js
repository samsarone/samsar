import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import { isContainerRuntime } from '../../utils/EnvironmentUtils.js';

function getAssetsRootCandidates() {
  const candidates = [];
  const isDockerLike = isContainerRuntime();

  if (isDockerLike) {
    candidates.push(process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2');
    candidates.push(path.join(process.cwd(), 'assets_v2'));
    candidates.push(path.join(process.cwd(), '..', 'samsar_processor', 'assets_v2'));
    candidates.push(process.env.SAMSAR_ASSETS_ROOT || '/assets');
    candidates.push(path.join(process.cwd(), 'assets'));
    candidates.push(path.join(process.cwd(), '..', 'samsar_processor', 'assets'));
  } else {
    candidates.push(path.join(process.cwd(), 'assets_v2'));
    candidates.push(path.join(process.cwd(), '..', 'samsar_processor', 'assets_v2'));
    candidates.push(process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2');
    candidates.push(path.join(process.cwd(), 'assets'));
    candidates.push(path.join(process.cwd(), '..', 'samsar_processor', 'assets'));
    candidates.push(process.env.SAMSAR_ASSETS_ROOT || '/assets');
  }

  const seen = new Set();
  return candidates.filter((root) => {
    if (!root || seen.has(root)) {
      return false;
    }
    seen.add(root);
    return true;
  });
}

function getAssetPathVariants(relativePath) {
  let normalizedPath = typeof relativePath === 'string' ? relativePath.trim() : '';
  normalizedPath = normalizedPath
    .replace(/^\/?assets_v2\//, '')
    .replace(/^\/?assets\//, '')
    .replace(/^\/+/, '');
  if (!normalizedPath) {
    return [];
  }

  const variants = [normalizedPath];
  if (normalizedPath.startsWith('ai_video/')) {
    variants.push(normalizedPath.replace(/^ai_video\//, 'video/'));
  } else if (normalizedPath.startsWith('video/')) {
    variants.push(normalizedPath.replace(/^video\//, 'ai_video/'));
  }
  return variants;
}

function resolveExistingVideoPath(relativePath) {
  const variants = getAssetPathVariants(relativePath);
  const roots = getAssetsRootCandidates();

  for (const root of roots) {
    for (const variant of variants) {
      const candidate = path.join(root, variant);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  if (roots.length > 0 && variants.length > 0) {
    return path.join(roots[0], variants[0]);
  }
  return null;
}


export async function getDurationForVideo(relativePath) {

  const videoPath = resolveExistingVideoPath(relativePath);

  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new Error(`Video file not found at path: ${videoPath}`);
  }

  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        console.error(err);
        reject(err);
      } else {
        resolve(metadata.format.duration);
      }
    });
  });

}
