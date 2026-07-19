const BRANCHED_NARRATIVE_TYPE = 'branched';
const COMPLETED_STATUS = 'COMPLETED';
const FAILED_STATUS = 'FAILED';

function toPlainObject(value) {
  if (!value || typeof value !== 'object') {
    return {};
  }
  if (typeof value.toObject === 'function') {
    return value.toObject({ depopulate: true });
  }
  return { ...value };
}

export function normalizeBranchRenderId(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function normalizeStatus(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function hasAssetUrl(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasPositiveDuration(value) {
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0;
}

function getSharedLayers(videoSession = {}) {
  const layers = [
    ...(Array.isArray(videoSession?.layers) ? videoSession.layers : []),
    ...(Array.isArray(videoSession?.branchedLayers) ? videoSession.branchedLayers : []),
  ];
  const seenIds = new Set();
  return layers.filter((layer) => {
    const layerId = normalizeBranchRenderId(layer?._id ?? layer?.layerId);
    if (!layerId || seenIds.has(layerId)) {
      return false;
    }
    seenIds.add(layerId);
    return true;
  });
}

function getSharedAudioLayers(videoSession = {}) {
  const layers = [
    ...(Array.isArray(videoSession?.audioLayers) ? videoSession.audioLayers : []),
    ...(Array.isArray(videoSession?.branchedAudioLayers) ? videoSession.branchedAudioLayers : []),
  ];
  const seenIds = new Set();
  return layers.filter((layer) => {
    const audioLayerId = normalizeBranchRenderId(layer?._id ?? layer?.audioLayerId);
    if (!audioLayerId || seenIds.has(audioLayerId)) {
      return false;
    }
    seenIds.add(audioLayerId);
    return true;
  });
}

function isSharedAudioLayer(audioLayer = {}) {
  const normalizedType = String(
    audioLayer?.generationType
      ?? audioLayer?.libraryType
      ?? audioLayer?.type
      ?? audioLayer?.audioType
      ?? '',
  ).trim().toLowerCase().replace(/[\s-]+/g, '_');
  const isMusic = [
    'music',
    'background_music',
    'bgm',
    'backing_track',
  ].includes(normalizedType);
  return isMusic || !normalizeBranchRenderId(audioLayer?.connectedLayerId);
}

export function isBranchedVideoSession(videoSession = {}) {
  return [videoSession?.narrativeType, videoSession?.sourceNarrativeType]
    .some((value) => String(value || '').trim().toLowerCase() === BRANCHED_NARRATIVE_TYPE);
}

export function getBranchRenderPaths(videoSession = {}) {
  return Array.isArray(videoSession?.branchRenderPaths)
    ? videoSession.branchRenderPaths
    : [];
}

export function findBranchRenderPath(videoSession = {}, renderPathId) {
  const normalizedRenderPathId = normalizeBranchRenderId(renderPathId);
  if (!normalizedRenderPathId) {
    return null;
  }
  const paths = getBranchRenderPaths(videoSession);
  const pathIndex = paths.findIndex((renderPath) => (
    normalizeBranchRenderId(renderPath?.pathId) === normalizedRenderPathId
  ));
  if (pathIndex < 0) {
    return null;
  }
  return {
    pathIndex,
    renderPath: paths[pathIndex],
  };
}

export function sanitizeBranchRenderPathSegment(renderPathId) {
  const normalizedRenderPathId = normalizeBranchRenderId(renderPathId);
  if (!normalizedRenderPathId) {
    throw new Error('A non-empty renderPathId is required.');
  }
  return `path-${Buffer.from(normalizedRenderPathId).toString('base64url')}`;
}

function buildEffectiveLayer(sourceLayer, timelineEntry, sequenceIndex) {
  const source = toPlainObject(sourceLayer);
  const timeline = toPlainObject(timelineEntry);
  const sourceLayerId = normalizeBranchRenderId(sourceLayer?._id ?? sourceLayer?.layerId);
  return {
    ...source,
    ...timeline,
    _id: sourceLayer?._id ?? source._id ?? sourceLayerId,
    layerId: sourceLayerId,
    timelineIndex: sequenceIndex,
    sequenceIndex: Number.isInteger(Number(timeline?.sequenceIndex))
      ? Number(timeline.sequenceIndex)
      : sequenceIndex,
  };
}

function buildEffectiveAudioLayer(sourceLayer, timelineEntry) {
  const source = toPlainObject(sourceLayer);
  const timeline = toPlainObject(timelineEntry);
  const audioLayerId = normalizeBranchRenderId(sourceLayer?._id ?? sourceLayer?.audioLayerId);
  return {
    ...source,
    ...timeline,
    _id: sourceLayer?._id ?? source._id ?? audioLayerId,
    audioLayerId,
  };
}

export function resolveBranchRenderContext(videoSession = {}, renderPathId) {
  if (!isBranchedVideoSession(videoSession)) {
    throw new Error('Branch render context requires a branched VideoSession.');
  }

  const match = findBranchRenderPath(videoSession, renderPathId);
  if (!match) {
    throw new Error(`Unknown branch render path: ${normalizeBranchRenderId(renderPathId) || '(empty)'}.`);
  }

  const timeline = Array.isArray(match.renderPath?.timeline)
    ? match.renderPath.timeline
    : [];
  if (!timeline.length) {
    throw new Error(`Branch render path ${normalizeBranchRenderId(renderPathId)} has no timeline.`);
  }

  const layerMap = new Map(getSharedLayers(videoSession).map((layer) => [
    normalizeBranchRenderId(layer?._id ?? layer?.layerId),
    layer,
  ]));
  const effectiveLayers = timeline.map((timelineEntry, timelineIndex) => {
    const layerId = normalizeBranchRenderId(timelineEntry?.layerId ?? timelineEntry?._id);
    const sourceLayer = layerMap.get(layerId);
    if (!sourceLayer) {
      throw new Error(
        `Branch render path ${normalizeBranchRenderId(renderPathId)} references missing layer ${layerId || '(empty)'}.`,
      );
    }
    return buildEffectiveLayer(sourceLayer, timelineEntry, timelineIndex);
  }).sort((left, right) => Number(left.sequenceIndex) - Number(right.sequenceIndex));

  const audioLayerMap = new Map(getSharedAudioLayers(videoSession).map((audioLayer) => [
    normalizeBranchRenderId(audioLayer?._id ?? audioLayer?.audioLayerId),
    audioLayer,
  ]));
  const audioTimeline = Array.isArray(match.renderPath?.audioTimeline)
    ? match.renderPath.audioTimeline
    : [];
  const effectiveAudioLayers = audioTimeline.map((timelineEntry) => {
    const audioLayerId = normalizeBranchRenderId(timelineEntry?.audioLayerId ?? timelineEntry?._id);
    const sourceLayer = audioLayerMap.get(audioLayerId);
    if (!sourceLayer) {
      throw new Error(
        `Branch render path ${normalizeBranchRenderId(renderPathId)} references missing audio layer ${audioLayerId || '(empty)'}.`,
      );
    }
    return buildEffectiveAudioLayer(sourceLayer, timelineEntry);
  });

  const referencedAudioLayerIds = new Set(effectiveAudioLayers.map((audioLayer) => (
    normalizeBranchRenderId(audioLayer?.audioLayerId ?? audioLayer?._id)
  )));
  for (const sharedAudioLayer of getSharedAudioLayers(videoSession)) {
    const audioLayerId = normalizeBranchRenderId(sharedAudioLayer?._id ?? sharedAudioLayer?.audioLayerId);
    if (!referencedAudioLayerIds.has(audioLayerId) && isSharedAudioLayer(sharedAudioLayer)) {
      effectiveAudioLayers.push(buildEffectiveAudioLayer(sharedAudioLayer, {}));
    }
  }

  const computedDuration = effectiveLayers.reduce((maximum, layer) => {
    const startTime = Number(layer?.durationOffset) || 0;
    const duration = Number(layer?.duration) || 0;
    return Math.max(maximum, startTime + duration);
  }, 0);

  return {
    pathIndex: match.pathIndex,
    renderPath: match.renderPath,
    renderPathId: normalizeBranchRenderId(renderPathId),
    safeRenderPathId: sanitizeBranchRenderPathSegment(renderPathId),
    layers: effectiveLayers,
    audioLayers: effectiveAudioLayers,
    duration: hasPositiveDuration(match.renderPath?.duration)
      ? Number(match.renderPath.duration)
      : computedDuration,
  };
}

export function hasBranchPathVideoResult(renderPath = {}) {
  return hasAssetUrl(renderPath?.remoteURL) || hasAssetUrl(renderPath?.videoLink);
}

export function isBranchPathVideoComplete(renderPath = {}) {
  return normalizeStatus(renderPath?.videoGenerationStatus) === COMPLETED_STATUS
    && hasBranchPathVideoResult(renderPath);
}

export function areAllBranchPathVideosComplete(videoSession = {}) {
  const paths = getBranchRenderPaths(videoSession);
  return paths.length > 0 && paths.every(isBranchPathVideoComplete);
}

export function getDefaultBranchRenderPath(videoSession = {}) {
  const paths = getBranchRenderPaths(videoSession);
  if (!paths.length) {
    return null;
  }
  const configuredPathId = normalizeBranchRenderId(videoSession?.defaultBranchPathId);
  return paths.find((renderPath) => (
    normalizeBranchRenderId(renderPath?.pathId) === configuredPathId
  )) ?? paths[0];
}

export function hasBranchPathRenderableFramesReady(renderPath = {}) {
  const timeline = Array.isArray(renderPath?.timeline) ? renderPath.timeline : [];
  const renderableEntries = timeline.filter((entry) => hasPositiveDuration(entry?.duration));
  return renderableEntries.length > 0 && renderableEntries.every((entry) => (
    Array.isArray(entry?.frames) && entry.frames.length > 0
  ));
}

export function getRepairableBranchRenderPaths(videoSession = {}) {
  if (!isBranchedVideoSession(videoSession)) {
    return [];
  }
  return getBranchRenderPaths(videoSession).filter((renderPath) => {
    const status = normalizeStatus(renderPath?.videoGenerationStatus);
    if (status === COMPLETED_STATUS || status === FAILED_STATUS || hasBranchPathVideoResult(renderPath)) {
      return false;
    }
    if (normalizeStatus(renderPath?.frameGenerationStatus) === FAILED_STATUS) {
      return false;
    }
    return hasBranchPathRenderableFramesReady(renderPath);
  });
}

export const BranchRenderPlanConstants = Object.freeze({
  BRANCHED_NARRATIVE_TYPE,
  COMPLETED_STATUS,
  FAILED_STATUS,
});
