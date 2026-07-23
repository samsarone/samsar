import fs from 'fs';
import path from 'path';
import { isDockerRuntime } from './EnvironmentUtils.js';

export function getProcessorAssetsRoot(folderName) {
  const configuredRoot = folderName === 'assets_v2'
    ? process.env.SAMSAR_ASSETS_V2_ROOT
    : process.env.SAMSAR_ASSETS_ROOT;
  if (typeof configuredRoot === 'string' && configuredRoot.trim()) {
    return path.resolve(configuredRoot.trim());
  }
  if (isDockerRuntime()) {
    return `/${folderName}`;
  }
  return path.join(process.cwd(), '../', 'samsar_processor', folderName);
}

function normalizeLocalAssetReference(value) {
  return typeof value === 'string'
    ? value.trim().replace(/\\/g, '/').replace(/^\/+/, '')
    : '';
}

function isPathInsideRoot(candidatePath, rootPath) {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return (
    relativePath === '' ||
    (!path.isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`))
  );
}

function resolvesInsideRoot(candidatePath, rootPath) {
  if (!isPathInsideRoot(candidatePath, rootPath)) {
    return false;
  }

  if (!fs.existsSync(rootPath)) {
    return true;
  }

  try {
    let existingAncestor = candidatePath;
    while (!fs.existsSync(existingAncestor)) {
      const parentPath = path.dirname(existingAncestor);
      if (parentPath === existingAncestor) {
        return false;
      }
      existingAncestor = parentPath;
    }
    return isPathInsideRoot(fs.realpathSync(existingAncestor), fs.realpathSync(rootPath));
  } catch {
    return false;
  }
}

function buildContainedCandidate(rootPath, relativePath) {
  const candidatePath = path.resolve(rootPath, relativePath);
  return resolvesInsideRoot(candidatePath, rootPath) ? candidatePath : null;
}

/**
 * Resolve stored processor asset references without mixing the `assets_v2`
 * namespace into the legacy `assets` root.
 */
export function resolveLocalAssetPath(localAssetRef) {
  const rawRef = typeof localAssetRef === 'string' ? localAssetRef.trim() : '';
  if (!rawRef) {
    return null;
  }

  const assetsV2Root = getProcessorAssetsRoot('assets_v2');
  const legacyAssetsRoot = getProcessorAssetsRoot('assets');

  if (path.isAbsolute(rawRef)) {
    const normalizedAbsolutePath = path.resolve(rawRef);
    if (!fs.existsSync(normalizedAbsolutePath)) {
      return null;
    }
    return [assetsV2Root, legacyAssetsRoot].some((rootPath) =>
      resolvesInsideRoot(normalizedAbsolutePath, rootPath))
      ? normalizedAbsolutePath
      : null;
  }

  const normalizedRef = normalizeLocalAssetReference(rawRef)
    .replace(/^samsar_processor\/assets_v2\/+/, 'assets_v2/')
    .replace(/^samsar_processor\/assets\/+/, 'assets/');

  let candidates;
  if (normalizedRef.startsWith('assets_v2/')) {
    candidates = [buildContainedCandidate(
      assetsV2Root,
      normalizedRef.replace(/^assets_v2\/+/, ''),
    )];
  } else if (normalizedRef.startsWith('assets/')) {
    candidates = [buildContainedCandidate(
      legacyAssetsRoot,
      normalizedRef.replace(/^assets\/+/, ''),
    )];
  } else {
    candidates = [
      buildContainedCandidate(assetsV2Root, normalizedRef),
      buildContainedCandidate(legacyAssetsRoot, normalizedRef),
    ];
  }

  const containedCandidates = candidates.filter(Boolean);
  return containedCandidates.find((candidatePath) => fs.existsSync(candidatePath)) || containedCandidates[0] || null;
}

export function toLocalAssetReference(absolutePath) {
  if (typeof absolutePath !== 'string' || !absolutePath.trim()) {
    return absolutePath;
  }

  const normalizedPath = absolutePath.replace(/\\/g, '/');
  const isStagingOrDocker = isDockerRuntime();
  const roots = [
    { root: getProcessorAssetsRoot('assets_v2'), prefix: 'assets_v2' },
    { root: getProcessorAssetsRoot('assets'), prefix: '' },
  ];

  for (const { root, prefix } of roots) {
    const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
    if (normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)) {
      const relativePath = normalizedPath.slice(normalizedRoot.length).replace(/^\/+/, '');
      if (!prefix) {
        return isStagingOrDocker ? normalizedPath : relativePath;
      }
      return isStagingOrDocker
        ? path.posix.join('/', prefix, relativePath)
        : path.posix.join(prefix, relativePath);
    }
  }

  return absolutePath;
}
