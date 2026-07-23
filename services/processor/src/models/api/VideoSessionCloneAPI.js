import path from 'path';
import fs from 'fs';
import fsExtra from 'fs-extra';
import { fileURLToPath } from 'url';
import { Types } from 'mongoose';
import { isContainerRuntime } from '../../utils/EnvironmentUtils.js';

import { getDBConnectionString } from '../DBString.js';
import { createNewBlankQuickSession } from '../QuickSession.js';
import { upsertGlobalSessionMapping } from '../GlobalSession.js';
import { addImageGeneratorRequest } from '../Images.js';
import VideoSession from '../../schema/VideoSession.js';
import {
  buildNarratorAvatarImagePrompt,
  getNarratorGenderForMovieResourceList,
} from '../movie_session/image_list_to_video/SessionRequestBuilder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COMPLETED_STATUS = 'COMPLETED';
const PENDING_STATUS = 'PENDING';
const CLONE_SESSION_SUB_TYPE = 'clone';
const REGENERATE_AVATAR_SESSION_SUB_TYPE = 'regenerate_avatar';
const STANDARD_EXPRESS_GENERATION_STATUS_KEYS = [
  'status',
  'prompt_generation',
  'image_generation',
  'audio_generation',
  'frame_generation',
  'video_generation',
  'ai_video_generation',
  'speech_generation',
  'music_generation',
  'lip_sync_generation',
  'sound_effect_generation',
  'delete_reflow',
  'timeline_reflowed',
  'transcript_generation',
  'narrator_avatar_generation',
];
const SESSION_ASSET_PREFIXES = [
  'assets_v2/',
  'assets/',
  'video/',
  'ai_video/',
  'global_videos/',
  'generations/',
  'temp_images/',
  'user_resources/',
];
const V2_ONLY_ASSET_PREFIXES = [
  'user_resources/',
];
const CRITICAL_RENDER_ASSET_PATTERNS = [
  /(?:^|\/)ai_video\/generations\//,
  /(?:^|\/)global_videos\/generations\//,
  /(?:^|\/)video\/generations\//,
  /(?:^|\/)video\/lip_sync\//,
];

function normalizeOptionalString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function getFirstNonEmptyString(...values) {
  for (const value of values) {
    const normalized = normalizeOptionalString(value);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function getSourceSessionId(payload = {}) {
  return (
    normalizeOptionalString(payload.videoSessionId) ||
    normalizeOptionalString(payload.video_session_id) ||
    normalizeOptionalString(payload.videoSessionID) ||
    normalizeOptionalString(payload.session_id) ||
    normalizeOptionalString(payload.sessionId) ||
    normalizeOptionalString(payload.sessionID) ||
    normalizeOptionalString(payload.request_id) ||
    normalizeOptionalString(payload.requestId) ||
    normalizeOptionalString(payload.source_session_id) ||
    normalizeOptionalString(payload.sourceSessionId) ||
    normalizeOptionalString(payload.source_request_id) ||
    normalizeOptionalString(payload.sourceRequestId)
  );
}

function getSourceShareToken(payload = {}) {
  return (
    normalizeOptionalString(payload.shareToken) ||
    normalizeOptionalString(payload.share_token) ||
    normalizeOptionalString(payload.sourceShareToken) ||
    normalizeOptionalString(payload.source_share_token)
  );
}

function shouldAllowGuestSessionCopy(payload = {}) {
  return (
    payload.allowGuestSession === true ||
    payload.isGuestSession === true ||
    normalizeOptionalString(payload.sourceType) === 'guest'
  );
}

function parseMaybeJson(value) {
  if (!value) {
    return null;
  }
  if (typeof value === 'object') {
    return value;
  }
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isWritableDirectory(dirPath) {
  try {
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function pushUniqueWritableRoot(roots, rootPath) {
  if (!rootPath || roots.includes(rootPath)) {
    return;
  }
  if (fsExtra.existsSync(rootPath) && isWritableDirectory(rootPath)) {
    roots.push(rootPath);
  }
}

function normalizePathSeparators(value) {
  return typeof value === 'string' ? value.replace(/\\/g, '/') : value;
}

function getReferencePath(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return '';
  }

  const trimmedValue = value.trim();
  let pathValue = trimmedValue;

  if (/^https?:\/\//i.test(trimmedValue)) {
    try {
      pathValue = decodeURIComponent(new URL(trimmedValue).pathname);
    } catch {
      pathValue = trimmedValue.replace(/^https?:\/\/[^/]+/i, '');
    }
  }

  const hashIndex = pathValue.indexOf('#');
  if (hashIndex >= 0) {
    pathValue = pathValue.slice(0, hashIndex);
  }
  const queryIndex = pathValue.indexOf('?');
  if (queryIndex >= 0) {
    pathValue = pathValue.slice(0, queryIndex);
  }

  return normalizePathSeparators(pathValue).trim();
}

function isCloudFrontSignedAssetUrl(value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) {
    return false;
  }

  try {
    const parsedUrl = new URL(value.trim());
    const normalizedPath = decodeURIComponent(parsedUrl.pathname).replace(/^\/+/, '');
    const hasCloudFrontSignatureParam = [
      'Expires',
      'Signature',
      'Key-Pair-Id',
      'Policy',
    ].some((paramName) => parsedUrl.searchParams.has(paramName));

    return normalizedPath.startsWith('assets_v2/') && hasCloudFrontSignatureParam;
  } catch {
    return false;
  }
}

function normalizeAssetReferencePath(value) {
  const referencePath = getReferencePath(value);
  if (!referencePath) {
    return '';
  }

  const normalized = referencePath
    .replace(/^\/?samsar_processor\/assets_v2\//, 'assets_v2/')
    .replace(/^\/?samsar_processor\/assets\//, 'assets/')
    .replace(/^\/+/, '');
  const assetsV2Index = normalized.indexOf('/assets_v2/');
  if (assetsV2Index >= 0) {
    return normalized.slice(assetsV2Index + 1);
  }
  const assetsIndex = normalized.indexOf('/assets/');
  if (assetsIndex >= 0) {
    return normalized.slice(assetsIndex + 1);
  }

  return normalized;
}

function getAssetReferenceLogPath(value) {
  return normalizeAssetReferencePath(value) || getReferencePath(value) || '';
}

function isSessionAssetReference(value, oldSessionId) {
  if (typeof value !== 'string' || !value.includes(oldSessionId)) {
    return false;
  }

  const normalizedPath = normalizeAssetReferencePath(value);
  return SESSION_ASSET_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix));
}

function isCriticalRenderAssetReference(value) {
  const normalizedPath = normalizeAssetReferencePath(value);
  return CRITICAL_RENDER_ASSET_PATTERNS.some((pattern) => pattern.test(normalizedPath));
}

function resolveAssetsRoots() {
  const localAssetsRoot = path.resolve(__dirname, '../../..', 'assets');
  const localAssetsV2Root = path.resolve(__dirname, '../../..', 'assets_v2');
  const dockerAssetsRoot = process.env.SAMSAR_ASSETS_ROOT || '/assets';
  const dockerAssetsV2Root = process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2';
  const roots = [];

  if (process.env.SAMSAR_ASSETS_ROOT || process.env.SAMSAR_ASSETS_V2_ROOT || isContainerRuntime()) {
    pushUniqueWritableRoot(roots, dockerAssetsRoot);
    pushUniqueWritableRoot(roots, dockerAssetsV2Root);
  }

  pushUniqueWritableRoot(roots, localAssetsRoot);
  pushUniqueWritableRoot(roots, localAssetsV2Root);

  if (roots.length) {
    return roots;
  }

  if (!fsExtra.existsSync(localAssetsRoot)) {
    fsExtra.ensureDirSync(localAssetsRoot);
  }

  return [localAssetsRoot];
}

function resolveAssetsRoot() {
  return resolveAssetsRoots()[0];
}

async function copyDirIfExists(sourceDir, targetDir) {
  if (!sourceDir || !targetDir) {
    return false;
  }

  if (!(await fsExtra.pathExists(sourceDir))) {
    return false;
  }

  await fsExtra.ensureDir(path.dirname(targetDir));
  await fsExtra.copy(sourceDir, targetDir, {
    overwrite: true,
    errorOnExist: false,
    recursive: true,
  });
  return true;
}

async function copySessionAssetDirectories({ assetsRoot, assetsRoots, oldSessionId, newSessionId }) {
  const roots = Array.isArray(assetsRoots) && assetsRoots.length
    ? assetsRoots
    : [assetsRoot].filter(Boolean);

  await Promise.all(roots.flatMap((root) => [
    copyDirIfExists(path.join(root, 'video', oldSessionId), path.join(root, 'video', newSessionId)),
    copyDirIfExists(path.join(root, 'video', 'output', oldSessionId), path.join(root, 'video', 'output', newSessionId)),
    copyDirIfExists(path.join(root, 'video', 'frames', oldSessionId), path.join(root, 'video', 'frames', newSessionId)),
    copyDirIfExists(path.join(root, 'video', 'audio', oldSessionId), path.join(root, 'video', 'audio', newSessionId)),
    copyDirIfExists(path.join(root, 'video', 'outro', oldSessionId), path.join(root, 'video', 'outro', newSessionId)),
    copyDirIfExists(path.join(root, 'video', 'splash', oldSessionId), path.join(root, 'video', 'splash', newSessionId)),
    copyDirIfExists(path.join(root, 'video', 'lip_sync', oldSessionId), path.join(root, 'video', 'lip_sync', newSessionId)),
    copyDirIfExists(path.join(root, 'video', 'narrator_avatar', 'audio', oldSessionId), path.join(root, 'video', 'narrator_avatar', 'audio', newSessionId)),
    copyDirIfExists(path.join(root, 'video', 'narrator_avatar', 'video', oldSessionId), path.join(root, 'video', 'narrator_avatar', 'video', newSessionId)),
    copyDirIfExists(path.join(root, 'video', 'narrator_avatar', 'frames', oldSessionId), path.join(root, 'video', 'narrator_avatar', 'frames', newSessionId)),
    copyDirIfExists(path.join(root, 'video', 'generations', oldSessionId), path.join(root, 'video', 'generations', newSessionId)),
    copyDirIfExists(path.join(root, 'video', 'footer_qr', oldSessionId), path.join(root, 'video', 'footer_qr', newSessionId)),
    copyDirIfExists(path.join(root, 'video', 'footer_logo', oldSessionId), path.join(root, 'video', 'footer_logo', newSessionId)),
    copyDirIfExists(path.join(root, 'ai_video', 'frames', oldSessionId), path.join(root, 'ai_video', 'frames', newSessionId)),
    copyDirIfExists(path.join(root, 'ai_video', 'audio', oldSessionId), path.join(root, 'ai_video', 'audio', newSessionId)),
    copyDirIfExists(path.join(root, 'ai_video', 'generations', oldSessionId), path.join(root, 'ai_video', 'generations', newSessionId)),
    copyDirIfExists(path.join(root, 'global_videos', 'frames', oldSessionId), path.join(root, 'global_videos', 'frames', newSessionId)),
    copyDirIfExists(path.join(root, 'global_videos', 'generations', oldSessionId), path.join(root, 'global_videos', 'generations', newSessionId)),
  ]));
}

function getRootAssetVersion(rootPath) {
  const normalizedRoot = normalizePathSeparators(rootPath).replace(/\/+$/, '');
  if (normalizedRoot.endsWith('/assets_v2')) {
    return 'v2';
  }
  if (normalizedRoot.endsWith('/assets')) {
    return 'legacy';
  }
  return 'unknown';
}

function getReferenceRelativePath(assetReference, rootVersion) {
  const normalizedPath = normalizeAssetReferencePath(assetReference);
  if (!normalizedPath) {
    return null;
  }

  if (normalizedPath.startsWith('assets_v2/')) {
    return rootVersion === 'v2' ? normalizedPath.slice('assets_v2/'.length) : null;
  }
  if (normalizedPath.startsWith('assets/')) {
    return rootVersion === 'legacy' ? normalizedPath.slice('assets/'.length) : null;
  }
  if (V2_ONLY_ASSET_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix))) {
    return rootVersion === 'v2' ? normalizedPath : null;
  }
  if (SESSION_ASSET_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix))) {
    return normalizedPath;
  }
  return null;
}

function resolveLocalAssetCandidates(assetReference, assetsRoots) {
  return assetsRoots
    .map((root) => {
      const relativePath = getReferenceRelativePath(assetReference, getRootAssetVersion(root));
      if (!relativePath) {
        return null;
      }
      return {
        root,
        relativePath,
        path: path.join(root, ...relativePath.split('/')),
      };
    })
    .filter(Boolean);
}

function getAlternateUserResourceSourceCandidates(assetReference, assetsRoots) {
  const normalizedPath = normalizeAssetReferencePath(assetReference);
  const match = normalizedPath.match(/^(?:assets_v2\/)?user_resources\/[^/]+\/ai_videos\/(.+)$/);
  if (!match?.[1]) {
    return [];
  }

  const aiVideoGenerationReference = path.posix.join('assets_v2', 'ai_video', 'generations', match[1]);
  return resolveLocalAssetCandidates(aiVideoGenerationReference, assetsRoots);
}

function collectSessionAssetReferencePairs(sessionData, oldSessionId, newSessionId) {
  const pairs = new Map();
  const escapedOldSessionId = oldSessionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const segmentPattern = new RegExp(`(^|[\\\\/])${escapedOldSessionId}(?=([\\\\/]|$))`, 'g');

  const rewriteReference = (value) => {
    const shouldStripSignedQuery = isCloudFrontSignedAssetUrl(value);
    const hashIndex = value.indexOf('#');
    const pathAndQuery = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
    const hashSuffix = !shouldStripSignedQuery && hashIndex >= 0 ? value.slice(hashIndex) : '';
    const queryIndex = pathAndQuery.indexOf('?');
    const rawPath = queryIndex >= 0 ? pathAndQuery.slice(0, queryIndex) : pathAndQuery;
    const querySuffix = !shouldStripSignedQuery && queryIndex >= 0 ? pathAndQuery.slice(queryIndex) : '';
    const rewrittenPath = rawPath.replace(segmentPattern, `$1${newSessionId}`);
    return `${rewrittenPath}${querySuffix}${hashSuffix}`;
  };

  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }

    for (const current of Object.values(value)) {
      if (typeof current === 'string') {
        if (!isSessionAssetReference(current, oldSessionId)) {
          continue;
        }
        const rewritten = rewriteReference(current);
        if (rewritten !== current) {
          pairs.set(`${current}\n${rewritten}`, { source: current, target: rewritten });
        }
      } else if (Array.isArray(current) || (current && typeof current === 'object')) {
        visit(current);
      }
    }
  };

  visit(sessionData);
  return Array.from(pairs.values());
}

async function copyReferencedSessionAssets({ sessionData, assetsRoots, oldSessionId, newSessionId }) {
  const roots = Array.isArray(assetsRoots) ? assetsRoots.filter(Boolean) : [];
  if (!roots.length) {
    return {
      copied: 0,
      referenceCount: 0,
      signedReferenceCount: 0,
      userResourceReferenceCount: 0,
      noCandidateCount: 0,
      missingSourceFileCount: 0,
      missingCritical: [],
      missingSourceSamples: [],
    };
  }

  const pairs = collectSessionAssetReferencePairs(sessionData, oldSessionId, newSessionId);
  let copied = 0;
  const missingCritical = [];
  let signedReferenceCount = 0;
  let userResourceReferenceCount = 0;
  let noCandidateCount = 0;
  let missingSourceFileCount = 0;
  const missingSourceSamples = [];

  for (const pair of pairs) {
    const normalizedSourcePath = getAssetReferenceLogPath(pair.source);
    if (isCloudFrontSignedAssetUrl(pair.source)) {
      signedReferenceCount += 1;
    }
    if (normalizedSourcePath.startsWith('user_resources/') || normalizedSourcePath.startsWith('assets_v2/user_resources/')) {
      userResourceReferenceCount += 1;
    }

    const sourceCandidates = [
      ...resolveLocalAssetCandidates(pair.source, roots),
      ...getAlternateUserResourceSourceCandidates(pair.source, roots),
    ];
    const targetCandidates = resolveLocalAssetCandidates(pair.target, roots);

    if (!sourceCandidates.length || !targetCandidates.length) {
      noCandidateCount += 1;
      continue;
    }

    let copiedPair = false;
    for (const sourceCandidate of sourceCandidates) {
      if (!(await fsExtra.pathExists(sourceCandidate.path))) {
        continue;
      }

      const matchingTargets = targetCandidates.filter((targetCandidate) => targetCandidate.root === sourceCandidate.root);
      const targets = matchingTargets.length ? matchingTargets : targetCandidates;
      for (const targetCandidate of targets) {
        if (await copyDirIfExists(sourceCandidate.path, targetCandidate.path)) {
          copied += 1;
          copiedPair = true;
        }
      }
      break;
    }

    if (!copiedPair) {
      missingSourceFileCount += 1;
      if (missingSourceSamples.length < 5) {
        missingSourceSamples.push(normalizedSourcePath);
      }
    }

    if (!copiedPair && isCriticalRenderAssetReference(pair.source)) {
      missingCritical.push(normalizedSourcePath);
    }
  }

  if (missingCritical.length) {
    throw new Error(
      `Unable to deep-clone render assets; missing source files for ${missingCritical.slice(0, 5).join(', ')}${missingCritical.length > 5 ? ` and ${missingCritical.length - 5} more` : ''}.`,
    );
  }

  return {
    copied,
    referenceCount: pairs.length,
    signedReferenceCount,
    userResourceReferenceCount,
    noCandidateCount,
    missingSourceFileCount,
    missingCritical,
    missingSourceSamples,
  };
}

function rewriteSessionAssetReferences(sessionData, oldSessionId, newSessionId) {
  if (!sessionData || typeof sessionData !== 'object') {
    return { rewrittenCount: 0, strippedSignedQueryCount: 0 };
  }

  const escapedOldSessionId = oldSessionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let rewrittenCount = 0;
  let strippedSignedQueryCount = 0;

  const replaceSessionPathSegment = (value) => {
    if (typeof value !== 'string' || !value.includes(oldSessionId)) {
      return value;
    }

    const shouldStripSignedQuery = isCloudFrontSignedAssetUrl(value);
    const hashIndex = value.indexOf('#');
    const pathAndQuery = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
    const hashSuffix = !shouldStripSignedQuery && hashIndex >= 0 ? value.slice(hashIndex) : '';
    const queryIndex = pathAndQuery.indexOf('?');
    const rawPath = queryIndex >= 0 ? pathAndQuery.slice(0, queryIndex) : pathAndQuery;
    const querySuffix = !shouldStripSignedQuery && queryIndex >= 0 ? pathAndQuery.slice(queryIndex) : '';
    const segmentPattern = new RegExp(`(^|[\\\\/])${escapedOldSessionId}(?=([\\\\/]|$))`, 'g');
    const rewrittenPath = rawPath.replace(segmentPattern, `$1${newSessionId}`);

    return `${rewrittenPath}${querySuffix}${hashSuffix}`;
  };

  const visit = (value) => {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const current = value[index];
        if (typeof current === 'string') {
          if (!isSessionAssetReference(current, oldSessionId)) {
            continue;
          }
          const rewritten = replaceSessionPathSegment(current);
          if (rewritten !== current) {
            value[index] = rewritten;
            rewrittenCount += 1;
            if (isCloudFrontSignedAssetUrl(current)) {
              strippedSignedQueryCount += 1;
            }
          }
        } else {
          visit(current);
        }
      }
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }

    for (const key of Object.keys(value)) {
      const current = value[key];
      if (typeof current === 'string') {
        if (!isSessionAssetReference(current, oldSessionId)) {
          continue;
        }
        const rewritten = replaceSessionPathSegment(current);
        if (rewritten !== current) {
          value[key] = rewritten;
          rewrittenCount += 1;
          if (isCloudFrontSignedAssetUrl(current)) {
            strippedSignedQueryCount += 1;
          }
        }
      } else if (Array.isArray(current) || (current && typeof current === 'object')) {
        visit(current);
      }
    }
  };

  visit(sessionData);
  return { rewrittenCount, strippedSignedQueryCount };
}

function logCloneAssetSummary(operation, {
  oldSessionId,
  newSessionId,
  assetsRoots,
  referencedAssetCopyResult,
  rewriteSummary,
}) {
}

function buildCompletedExpressGenerationStatus(existingStatus = {}) {
  const status = existingStatus && typeof existingStatus === 'object' && !Array.isArray(existingStatus)
    ? { ...existingStatus }
    : {};
  const allKeys = new Set([
    ...STANDARD_EXPRESS_GENERATION_STATUS_KEYS,
    ...Object.keys(status),
  ]);

  for (const key of allKeys) {
    status[key] = COMPLETED_STATUS;
  }

  return status;
}

function markLayerGenerationComplete(layer) {
  if (!layer || typeof layer !== 'object') {
    return layer;
  }

  layer.frameGenerationPending = false;
  layer.aiVideoFrameGenerationPending = false;
  layer.aiVideoGenerationPending = false;
  layer.lipSyncGenerationPending = false;
  layer.soundEffectGenerationPending = false;
  layer.userVideoGenerationPending = false;
  layer.maskGenerationPending = false;
  layer.videoEditPending = false;

  layer.aiVideoGenerationStatus = COMPLETED_STATUS;
  layer.lipSyncVideoGenerationStatus = COMPLETED_STATUS;
  layer.soundEffectVideoGenerationStatus = COMPLETED_STATUS;
  layer.userVideoGenerationStatus = COMPLETED_STATUS;
  layer.videoEditStatus = COMPLETED_STATUS;

  if (layer.imageSession && typeof layer.imageSession === 'object') {
    layer.imageSession.generationStatus = COMPLETED_STATUS;
    layer.imageSession.editStatus = COMPLETED_STATUS;
    layer.imageSession.generationError = null;
    layer.imageSession.editError = '';
  }

  return layer;
}

function markAudioLayerGenerationComplete(audioLayer) {
  if (!audioLayer || typeof audioLayer !== 'object') {
    return audioLayer;
  }

  audioLayer.generationStatus = COMPLETED_STATUS;
  audioLayer.generationError = null;
  audioLayer.streamDownloadPending = false;
  return audioLayer;
}

function prepareClonedSessionForVideoRender({ clonedSession, webhookUrl }) {
  clonedSession.isExpressGeneration = true;
  clonedSession.expressGenerationPending = true;
  clonedSession.expressGenerationFailed = false;
  clonedSession.expressGenerationCancelled = false;
  clonedSession.expressGenerationError = null;
  clonedSession.videoLink = null;
  clonedSession.remoteURL = null;
  clonedSession.videoGenerationPending = false;
  clonedSession.frameGenerationPending = false;
  clonedSession.audioGenerationPending = false;
  clonedSession.transcriptGenerationPending = false;
  clonedSession.maskGenerationPending = false;
  clonedSession.sessionMessageGenerationPending = false;
  clonedSession.aiVideoGenerationPending = false;
  clonedSession.lipSyncGenerationPending = false;
  clonedSession.soundEffectGenerationPending = false;
  clonedSession.expressGenerativeVideoRequired = false;
  clonedSession.expressGenerativeSpeechRequired = false;
  clonedSession.provisionalCredits = 0;
  clonedSession.externalWebhook = webhookUrl || null;
  clonedSession.isExternalUserRequest = false;
  clonedSession.externalRequestUserId = null;
  clonedSession.externalRequestId = null;
  clonedSession.externalRequestIdentityKey = null;
  clonedSession.expressGenerationStatus = buildCompletedExpressGenerationStatus(
    clonedSession.expressGenerationStatus,
  );
  clonedSession.expressGenerationStatus.video_generation = 'INIT';

  clonedSession.layers = Array.isArray(clonedSession.layers)
    ? clonedSession.layers.map(markLayerGenerationComplete)
    : [];
  clonedSession.audioLayers = Array.isArray(clonedSession.audioLayers)
    ? clonedSession.audioLayers.map(markAudioLayerGenerationComplete)
    : [];

}

function resolveNarratorAvatarImageGenerationInput({ clonedSession = null, originalSessionData = null } = {}) {
  const movieResourceList = clonedSession?.movieResourceList || originalSessionData?.movieResourceList || null;
  const rebuiltPrompt = movieResourceList
    ? buildNarratorAvatarImagePrompt({
      inputPrompt: getFirstNonEmptyString(
        clonedSession?.inputPrompt,
        clonedSession?.expressInputPrompt,
        originalSessionData?.inputPrompt,
        originalSessionData?.expressInputPrompt,
      ),
      themeJson: parseMaybeJson(clonedSession?.parentJsonTheme || originalSessionData?.parentJsonTheme),
      movieResourceList,
      languageString: getFirstNonEmptyString(clonedSession?.languageString, originalSessionData?.languageString),
      metadata: originalSessionData?.metadata || null,
      imageDescriptionList: originalSessionData?.imageDescriptionList || null,
    })
    : null;
  const prompt = getFirstNonEmptyString(
    rebuiltPrompt,
    clonedSession?.narratorAvatarImagePrompt,
    originalSessionData?.narratorAvatarImagePrompt,
  );
  const narratorGender = getNarratorGenderForMovieResourceList(movieResourceList || {});

  return {
    prompt,
    narratorGender,
  };
}

async function queueNarratorAvatarImageGeneration({
  userId,
  sessionId,
  clonedSession,
  originalSessionData,
  resolvedImageGenerationInput = null,
}) {
  const { prompt, narratorGender } = resolvedImageGenerationInput
    || resolveNarratorAvatarImageGenerationInput({ clonedSession, originalSessionData });

  if (!prompt) {
    const error = new Error('Source session does not have a narrator avatar image prompt to regenerate.');
    error.status = 400;
    throw error;
  }
  clonedSession.narratorAvatarImagePrompt = prompt;
  clonedSession.narratorAvatarGender = narratorGender;

  const avatarImageRequest = await addImageGeneratorRequest(userId, {
    userId: userId.toString(),
    sessionId,
    videoSessionId: sessionId,
    layerId: null,
    prompt,
    model: 'GPTIMAGE2',
    aspectRatio: '16:9',
    background_color: 'black',
    backgroundColor: 'black',
    transparent_background: false,
    transparentBackground: false,
    background: { r: 0, g: 0, b: 0, alpha: 1 },
    narratorGender,
    narrator_gender: narratorGender,
    requestType: 'EXPRESS_NARRATOR_AVATAR',
    contentFilterRating: originalSessionData?.contentFilterRating ?? 3,
    retryOnFailure: true,
  }, false);

  if (!avatarImageRequest?._id) {
    const error = new Error('Unable to queue narrator avatar image generation.');
    error.status = 500;
    throw error;
  }

  return avatarImageRequest._id.toString();
}

function prepareClonedSessionForNarratorAvatarRegeneration({
  clonedSession,
  newSessionId,
  avatarImageRequestId,
  webhookUrl,
}) {
  clonedSession.isExpressGeneration = true;
  clonedSession.expressGenerationPending = true;
  clonedSession.expressGenerationFailed = false;
  clonedSession.expressGenerationCancelled = false;
  clonedSession.expressGenerationError = null;
  clonedSession.videoLink = null;
  clonedSession.remoteURL = null;
  clonedSession.videoGenerationPending = false;
  clonedSession.frameGenerationPending = false;
  clonedSession.audioGenerationPending = false;
  clonedSession.transcriptGenerationPending = clonedSession.enableSubtitles !== false;
  clonedSession.maskGenerationPending = false;
  clonedSession.sessionMessageGenerationPending = false;
  clonedSession.aiVideoGenerationPending = false;
  clonedSession.lipSyncGenerationPending = false;
  clonedSession.soundEffectGenerationPending = false;
  clonedSession.expressGenerativeVideoRequired = false;
  clonedSession.expressGenerativeSpeechRequired = false;
  clonedSession.provisionalCredits = 0;
  clonedSession.externalWebhook = webhookUrl || null;
  clonedSession.isExternalUserRequest = false;
  clonedSession.externalRequestUserId = null;
  clonedSession.externalRequestId = null;
  clonedSession.externalRequestIdentityKey = null;

  clonedSession.addNarratorAvatar = true;
  clonedSession.add_narrator_avatar = true;
  clonedSession.narratorAvatarType = clonedSession.narratorAvatarType || 'influencer';
  clonedSession.narratorAvatarImageRequestId = avatarImageRequestId;
  clonedSession.narratorAvatarImageStatus = 'PENDING';
  clonedSession.narratorAvatarImage = '';
  clonedSession.narratorAvatarImageUrl = '';
  clonedSession.narratorAvatarImageWidth = 0;
  clonedSession.narratorAvatarImageHeight = 0;
  clonedSession.narratorAvatarId = '';
  clonedSession.narratorAvatarStatus = 'INIT';
  clonedSession.narratorAvatarRunwayResponse = null;
  clonedSession.narratorAvatarError = '';
  clonedSession.narratorAvatarAudioStatus = 'INIT';
  clonedSession.narratorAvatarAudioAssetPath = '';
  clonedSession.narratorAvatarAudioUrl = '';
  clonedSession.narratorAvatarAudioDuration = 0;
  clonedSession.narratorAvatarSceneDurationSeconds = 0;
  clonedSession.narratorAvatarSpeechSegments = [];
  clonedSession.narratorAvatarVideoTaskId = '';
  clonedSession.narratorAvatarVideoStatus = 'INIT';
  clonedSession.narratorAvatarVideoUrl = '';
  clonedSession.narratorAvatarVideoAssetPath = '';
  clonedSession.narratorAvatarVideoRunwayResponse = null;
  clonedSession.narratorAvatarVideoError = '';
  clonedSession.narratorAvatarGenerationSkipped = false;

  const status = buildCompletedExpressGenerationStatus(clonedSession.expressGenerationStatus);
  status.status = PENDING_STATUS;
  status.narrator_avatar_generation = 'INIT';
  status.transcript_generation = clonedSession.enableSubtitles !== false ? 'INIT' : 'COMPLETED';
  status.frame_generation = 'INIT';
  status.video_generation = 'INIT';
  clonedSession.expressGenerationStatus = status;

  clonedSession.layers = Array.isArray(clonedSession.layers)
    ? clonedSession.layers.map((layer) => {
      markLayerGenerationComplete(layer);
      layer.frameGenerationPending = true;
      layer.frames = [];
      layer.initFramesGenerated = false;
      return layer;
    })
    : [];
  clonedSession.audioLayers = Array.isArray(clonedSession.audioLayers)
    ? clonedSession.audioLayers.map(markAudioLayerGenerationComplete)
    : [];
}

function clearLayerCopyTransientState(layer) {
  if (!layer || typeof layer !== 'object') {
    return layer;
  }

  const frameGenerationPending = Boolean(layer.frameGenerationPending);
  markLayerGenerationComplete(layer);
  layer.frameGenerationPending = frameGenerationPending;
  layer.userVideoUploadTaskId = null;
  return layer;
}

function prepareCopiedSessionForStudio({ clonedSession, userId }) {
  clonedSession.userId = userId.toString();
  clonedSession.shareEnabled = false;
  clonedSession.shareToken = null;
  clonedSession.shareCreatedAt = null;
  clonedSession.shareLastViewedAt = null;
  clonedSession.shareOgImageUrl = null;
  clonedSession.shareOgImagePath = null;
  clonedSession.shareOgImageSource = null;
  clonedSession.shareOgImageCreatedAt = null;
  clonedSession.shareOgImageUpdatedAt = null;
  clonedSession.editableShareEnabled = false;
  clonedSession.editableShareToken = null;
  clonedSession.editableShareCreatedAt = null;
  clonedSession.editableShareLastViewedAt = null;
  clonedSession.editableShareLastEditedAt = null;
  clonedSession.editableShareCollaborators = [];
  clonedSession.editableShareImportedUserIds = [];
  clonedSession.isGuestSession = false;
  clonedSession.isIntroSession = false;
  clonedSession.isFrameGenerating = false;
  clonedSession.videoGenerationPending = false;
  clonedSession.audioGenerationPending = false;
  clonedSession.transcriptGenerationPending = false;
  clonedSession.maskGenerationPending = false;
  clonedSession.sessionMessageGenerationPending = false;
  clonedSession.sessionMessageGenerationError = null;
  clonedSession.expressGenerationPending = false;
  clonedSession.expressGenerationFailed = false;
  clonedSession.expressGenerationCancelled = false;
  clonedSession.expressGenerationError = null;
  clonedSession.aiVideoGenerationPending = false;
  clonedSession.lipSyncGenerationPending = false;
  clonedSession.soundEffectGenerationPending = false;
  clonedSession.provisionalCredits = 0;
  clonedSession.externalWebhook = null;
  clonedSession.isExternalUserRequest = false;
  clonedSession.externalRequestUserId = null;
  clonedSession.externalRequestId = null;
  clonedSession.externalRequestIdentityKey = null;

  clonedSession.ispublishedVideo = false;
  clonedSession.publishedTitle = null;
  clonedSession.publishedDescription = null;
  clonedSession.publishedTags = [];
  clonedSession.publishedAspectRatio = null;
  clonedSession.publishedVideoURL = null;
  clonedSession.publishedAt = null;
  clonedSession.publishedOriginalPrompt = null;
  clonedSession.publishedSplashImage = null;
  clonedSession.publishedImageModel = null;
  clonedSession.publishedVideoModel = null;
  clonedSession.publishedPublicationId = null;
  clonedSession.publishedHasSubtitles = null;
  clonedSession.publishedSessionLanguage = null;
  clonedSession.publishedLanguageString = null;

  clonedSession.layers = Array.isArray(clonedSession.layers)
    ? clonedSession.layers.map(clearLayerCopyTransientState)
    : [];
  clonedSession.audioLayers = Array.isArray(clonedSession.audioLayers)
    ? clonedSession.audioLayers.map(markAudioLayerGenerationComplete)
    : [];
}

function resolveCloneResultUrl(sessionData = {}) {
  return (
    normalizeOptionalString(sessionData.remoteURL) ||
    normalizeOptionalString(sessionData.videoLink) ||
    null
  );
}

export async function cloneVideoSessionAndQueueRender(userId, payload = {}) {
  if (!userId) {
    const error = new Error('userId is required.');
    error.status = 400;
    throw error;
  }

  const originalSessionId = getSourceSessionId(payload);
  if (!originalSessionId) {
    const error = new Error('videoSessionId (or session_id) must be a non-empty string.');
    error.status = 400;
    throw error;
  }

  if (!Types.ObjectId.isValid(originalSessionId)) {
    const error = new Error('videoSessionId must be a valid id.');
    error.status = 400;
    throw error;
  }

  await getDBConnectionString();

  const oldSessionId = originalSessionId;
  const originalSessionDoc = await VideoSession.findOne({
    _id: oldSessionId,
    userId: userId.toString(),
  });

  if (!originalSessionDoc) {
    const error = new Error('Video session not found.');
    error.status = 404;
    throw error;
  }

  const originalSessionData = originalSessionDoc.toObject({ depopulate: true });
  const sourceResultUrl = resolveCloneResultUrl(originalSessionData);
  if (!sourceResultUrl) {
    const error = new Error('Video session does not have a completed video URL to clone.');
    error.status = 400;
    throw error;
  }

  const newSessionId = await createNewBlankQuickSession(userId);
  const assetsRoots = resolveAssetsRoots();
  await copySessionAssetDirectories({ assetsRoots, oldSessionId, newSessionId });
  const referencedAssetCopyResult = await copyReferencedSessionAssets({
    sessionData: originalSessionData,
    assetsRoots,
    oldSessionId,
    newSessionId,
  });

  const clonedSession = JSON.parse(JSON.stringify(originalSessionData));

  delete clonedSession._id;
  delete clonedSession.__v;
  delete clonedSession.createdAt;
  delete clonedSession.updatedAt;

  const rewriteSummary = rewriteSessionAssetReferences(clonedSession, oldSessionId, newSessionId);
  logCloneAssetSummary('clone_render', {
    oldSessionId,
    newSessionId,
    assetsRoots,
    referencedAssetCopyResult,
    rewriteSummary,
  });
  prepareClonedSessionForVideoRender({
    clonedSession,
    webhookUrl: normalizeOptionalString(payload.webhookUrl),
  });

  await VideoSession.updateOne({ _id: newSessionId }, { $set: clonedSession });

  const provider = getFirstNonEmptyString(
    originalSessionData?.expressGenerativeVideoModel,
    originalSessionData?.video_model,
    originalSessionData?.provider,
    originalSessionData?.videoGenerationModelSubType,
  ) || CLONE_SESSION_SUB_TYPE;

  await upsertGlobalSessionMapping({
    sessionId: newSessionId,
    sessionType: 'video',
    requestId: newSessionId,
    provider,
    userId,
    status: PENDING_STATUS,
    requestType: 'API',
    sessionSubType: CLONE_SESSION_SUB_TYPE,
    metadata: {
      originalSessionId: oldSessionId,
      clonedFromSessionId: oldSessionId,
      cloneType: 'deep_copy',
    },
    resultUrl: null,
    resultUrls: [],
  });

  return {
    request_id: newSessionId,
    session_id: newSessionId,
    status: PENDING_STATUS,
    creditsCharged: 0,
    remainingCredits: null,
  };
}

export async function cloneVideoSessionAndRegenerateNarratorAvatar(userId, payload = {}) {
  if (!userId) {
    const error = new Error('userId is required.');
    error.status = 400;
    throw error;
  }

  const originalSessionId = getSourceSessionId(payload);
  if (!originalSessionId) {
    const error = new Error('videoSessionId (or session_id) must be a non-empty string.');
    error.status = 400;
    throw error;
  }

  if (!Types.ObjectId.isValid(originalSessionId)) {
    const error = new Error('videoSessionId must be a valid id.');
    error.status = 400;
    throw error;
  }

  await getDBConnectionString();

  const oldSessionId = originalSessionId;
  const originalSessionDoc = await VideoSession.findOne({
    _id: oldSessionId,
    userId: userId.toString(),
  });

  if (!originalSessionDoc) {
    const error = new Error('Video session not found.');
    error.status = 404;
    throw error;
  }

  const originalSessionData = originalSessionDoc.toObject({ depopulate: true });
  const sourceResultUrl = resolveCloneResultUrl(originalSessionData);
  if (!sourceResultUrl) {
    const error = new Error('Video session does not have a completed video URL to regenerate.');
    error.status = 400;
    throw error;
  }

  const narratorAvatarImageInput = resolveNarratorAvatarImageGenerationInput({
    originalSessionData,
  });
  if (!narratorAvatarImageInput.prompt) {
    const error = new Error('Source session does not have enough narrative data to generate a narrator avatar image.');
    error.status = 400;
    throw error;
  }

  const newSessionId = await createNewBlankQuickSession(userId);
  const assetsRoots = resolveAssetsRoots();
  await copySessionAssetDirectories({ assetsRoots, oldSessionId, newSessionId });
  const referencedAssetCopyResult = await copyReferencedSessionAssets({
    sessionData: originalSessionData,
    assetsRoots,
    oldSessionId,
    newSessionId,
  });

  const clonedSession = JSON.parse(JSON.stringify(originalSessionData));

  delete clonedSession._id;
  delete clonedSession.__v;
  delete clonedSession.createdAt;
  delete clonedSession.updatedAt;

  const rewriteSummary = rewriteSessionAssetReferences(clonedSession, oldSessionId, newSessionId);
  logCloneAssetSummary('regenerate_avatar', {
    oldSessionId,
    newSessionId,
    assetsRoots,
    referencedAssetCopyResult,
    rewriteSummary,
  });
  prepareClonedSessionForNarratorAvatarRegeneration({
    clonedSession,
    newSessionId,
    avatarImageRequestId: '',
    webhookUrl: normalizeOptionalString(payload.webhookUrl),
  });

  await VideoSession.updateOne({ _id: newSessionId }, { $set: clonedSession });

  const avatarImageRequestId = await queueNarratorAvatarImageGeneration({
    userId,
    sessionId: newSessionId,
    clonedSession,
    originalSessionData,
    resolvedImageGenerationInput: narratorAvatarImageInput,
  });

  await VideoSession.updateOne(
    { _id: newSessionId },
    {
      $set: {
        narratorAvatarImageRequestId: avatarImageRequestId,
        narratorAvatarImageStatus: 'PENDING',
        narratorAvatarImagePrompt: clonedSession.narratorAvatarImagePrompt,
        narratorAvatarGender: clonedSession.narratorAvatarGender,
        'expressGenerationStatus.narrator_avatar_generation': 'INIT',
      },
    },
  );

  const provider = getFirstNonEmptyString(
    originalSessionData?.expressGenerativeVideoModel,
    originalSessionData?.video_model,
    originalSessionData?.provider,
    originalSessionData?.videoGenerationModelSubType,
  ) || REGENERATE_AVATAR_SESSION_SUB_TYPE;

  await upsertGlobalSessionMapping({
    sessionId: newSessionId,
    sessionType: 'video',
    requestId: newSessionId,
    provider,
    userId,
    status: PENDING_STATUS,
    requestType: 'API',
    sessionSubType: REGENERATE_AVATAR_SESSION_SUB_TYPE,
    metadata: {
      originalSessionId: oldSessionId,
      clonedFromSessionId: oldSessionId,
      cloneType: REGENERATE_AVATAR_SESSION_SUB_TYPE,
      avatarImageRequestId,
    },
    resultUrl: null,
    resultUrls: [],
  });

  return {
    request_id: newSessionId,
    session_id: newSessionId,
    status: PENDING_STATUS,
    creditsCharged: 0,
    remainingCredits: null,
  };
}

export async function copyVideoSession(userId, payload = {}) {
  if (!userId) {
    const error = new Error('userId is required.');
    error.status = 400;
    throw error;
  }

  const originalSessionId = getSourceSessionId(payload);
  const sourceShareToken = getSourceShareToken(payload);
  if (!originalSessionId && !sourceShareToken) {
    const error = new Error('videoSessionId (or session_id) or shareToken must be a non-empty string.');
    error.status = 400;
    throw error;
  }

  if (originalSessionId && !Types.ObjectId.isValid(originalSessionId)) {
    const error = new Error('videoSessionId must be a valid id.');
    error.status = 400;
    throw error;
  }

  await getDBConnectionString();

  const allowGuestSessionCopy = shouldAllowGuestSessionCopy(payload);
  const originalSessionDoc = sourceShareToken
    ? await VideoSession.findOne({
      shareToken: sourceShareToken,
      shareEnabled: true,
    })
    : allowGuestSessionCopy
      ? await VideoSession.findOne({
        _id: originalSessionId,
        isGuestSession: true,
      })
    : await VideoSession.findOne({
      _id: originalSessionId,
      userId: userId.toString(),
    });

  if (!originalSessionDoc) {
    const error = new Error('Video session not found.');
    error.status = 404;
    throw error;
  }

  const oldSessionId = originalSessionDoc._id.toString();
  const originalSessionData = originalSessionDoc.toObject({ depopulate: true });
  const newSessionId = await createNewBlankQuickSession(userId);
  const assetsRoots = resolveAssetsRoots();
  await copySessionAssetDirectories({ assetsRoots, oldSessionId, newSessionId });
  const referencedAssetCopyResult = await copyReferencedSessionAssets({
    sessionData: originalSessionData,
    assetsRoots,
    oldSessionId,
    newSessionId,
  });

  const clonedSession = JSON.parse(JSON.stringify(originalSessionData));

  delete clonedSession._id;
  delete clonedSession.__v;
  delete clonedSession.createdAt;
  delete clonedSession.updatedAt;

  const rewriteSummary = rewriteSessionAssetReferences(clonedSession, oldSessionId, newSessionId);
  logCloneAssetSummary('copy_studio', {
    oldSessionId,
    newSessionId,
    assetsRoots,
    referencedAssetCopyResult,
    rewriteSummary,
  });
  prepareCopiedSessionForStudio({ clonedSession, userId });

  await VideoSession.updateOne({ _id: newSessionId }, { $set: clonedSession });
  const copiedSession = await VideoSession.findById(newSessionId);

  return {
    session: copiedSession,
    sessionId: newSessionId,
    session_id: newSessionId,
  };
}

export {
  resolveAssetsRoot,
  resolveAssetsRoots,
  copySessionAssetDirectories,
  copyReferencedSessionAssets,
  rewriteSessionAssetReferences,
};

export const __testOnly__ = {
  resolveNarratorAvatarImageGenerationInput,
  resolveAssetsRoot,
  resolveAssetsRoots,
  copySessionAssetDirectories,
  copyReferencedSessionAssets,
  rewriteSessionAssetReferences,
  isCloudFrontSignedAssetUrl,
};
