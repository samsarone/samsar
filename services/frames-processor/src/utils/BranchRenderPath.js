const SUPPORTED_RENDER_PLAN_VERSION = 1;

function normalizeId(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return value?.toString?.().trim?.() || '';
}

function toPlainObject(value) {
  if (!value || typeof value !== 'object') {
    return value;
  }

  return typeof value.toObject === 'function' ? value.toObject() : value;
}

function requireSafeOpaqueSegment(value, fieldName) {
  const normalized = normalizeId(value);
  if (!normalized || !/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new Error(`${fieldName} must be a non-empty filesystem-safe identifier.`);
  }
  return normalized;
}

function normalizeSequenceIndex(value) {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized >= 0 ? normalized : null;
}

function normalizePositiveDuration(value, fieldName) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new Error(`${fieldName} must be a positive number.`);
  }
  return normalized;
}

function normalizeDurationOffset(value, fieldName) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error(`${fieldName} must be a non-negative number.`);
  }
  return normalized;
}

function findTimelineIndex(timeline, pathSequenceIndex) {
  return timeline.findIndex((entry, arrayIndex) => {
    const entrySequenceIndex = normalizeSequenceIndex(entry?.sequenceIndex);
    return (entrySequenceIndex ?? arrayIndex) === pathSequenceIndex;
  });
}

function getAudioTimelineLayerId(entry = {}) {
  return normalizeId(
    entry.audioLayerId ??
    entry.audio_layer_id ??
    entry.layerId ??
    entry._id,
  );
}

function getTimelineLayerId(entry = {}) {
  return normalizeId(entry.layerId ?? entry.layer_id);
}

function getTimelineSceneIndex(entry = {}) {
  return normalizeSequenceIndex(entry.sceneIndex ?? entry.scene_index);
}

function getTimelineSequenceIndex(entry = {}, arrayIndex = 0) {
  return normalizeSequenceIndex(
    entry.sequenceIndex ?? entry.pathSequenceIndex ?? entry.path_sequence_index,
  ) ?? arrayIndex;
}

function getSelectionDivergenceSceneIndex(selection = {}) {
  return normalizeSequenceIndex(
    selection.divergenceSceneIndex ?? selection.divergence_scene_index,
  );
}

function getPathDuration(path = {}, timeline = []) {
  const configuredDuration = Number(path.duration);
  if (Number.isFinite(configuredDuration) && configuredDuration > 0) {
    return configuredDuration;
  }

  return timeline.reduce((maximum, entry) => {
    const duration = Number(entry?.duration);
    const durationOffset = Number(entry?.durationOffset);
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(durationOffset)) {
      return maximum;
    }
    return Math.max(maximum, durationOffset + duration);
  }, 0);
}

function normalizeTimingBase(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'session' || normalized === 'global') return 'session';
  if (normalized === 'layer' || normalized === 'local') return 'layer';
  if (normalized === 'item' || normalized === 'relative') return 'item';
  return '';
}

function shiftFiniteField(target, fieldName, deltaFrames) {
  const value = Number(target?.[fieldName]);
  if (Number.isFinite(value)) {
    target[fieldName] = value + deltaFrames;
  }
}

function retimeSessionSubtitleItem(item, deltaFrames) {
  if (
    !item ||
    item.type !== 'text' ||
    item.subType !== 'subtitle' ||
    !Number.isFinite(deltaFrames) ||
    deltaFrames === 0
  ) {
    return item;
  }

  const timingBase = normalizeTimingBase(
    item.subtitleTimingBase ??
    item.subtitle_timing_base ??
    item.wordTimingBase ??
    item.word_timing_base,
  );
  const hasLinkedSessionWords = Boolean(
    normalizeId(item.audioLayerId) &&
    Array.isArray(item.words) &&
    item.words.length > 0,
  );
  const shouldShiftWords = timingBase === 'session' || (!timingBase && hasLinkedSessionWords);
  const retimedItem = { ...item };

  if (shouldShiftWords && Array.isArray(item.words)) {
    retimedItem.words = item.words.map((wordInfo) => {
      if (!wordInfo || typeof wordInfo !== 'object') return wordInfo;
      const retimedWord = { ...wordInfo };
      shiftFiniteField(retimedWord, 'frameOffset', deltaFrames);
      shiftFiniteField(retimedWord, 'frame_offset', deltaFrames);
      return retimedWord;
    });
  }

  for (const fieldName of [
    'subtitleCueStartFrameSession',
    'subtitleCueEndFrameSession',
    'subtitle_cue_start_frame_session',
    'subtitle_cue_end_frame_session',
    'subtitleSessionStartFrame',
    'subtitleSessionEndFrame',
    'subtitle_session_start_frame',
    'subtitle_session_end_frame',
  ]) {
    shiftFiniteField(retimedItem, fieldName, deltaFrames);
  }

  return retimedItem;
}

function retimeLayerSessionSubtitles(layer, effectiveDurationOffset, session = {}) {
  const canonicalDurationOffset = Number(layer?.durationOffset);
  const framesPerSecond = Number(session?.framesPerSecond);
  const normalizedFramesPerSecond = Number.isFinite(framesPerSecond) && framesPerSecond > 0
    ? framesPerSecond
    : 24;
  const deltaFrames = (
    Number(effectiveDurationOffset) -
    (Number.isFinite(canonicalDurationOffset) ? canonicalDurationOffset : 0)
  ) * normalizedFramesPerSecond;
  const activeItemList = layer?.imageSession?.activeItemList;
  if (!Number.isFinite(deltaFrames) || deltaFrames === 0 || !Array.isArray(activeItemList)) {
    return layer;
  }

  return {
    ...layer,
    imageSession: {
      ...layer.imageSession,
      activeItemList: activeItemList.map((item) => retimeSessionSubtitleItem(item, deltaFrames)),
    },
  };
}

export function getSafeRenderPathDirectoryName(renderPathId) {
  const normalizedRenderPathId = normalizeId(renderPathId);
  if (!normalizedRenderPathId) {
    throw new Error('renderPathId must be a non-empty string.');
  }

  // base64url is reversible, contains no path separators, and avoids collisions
  // between tree ids that normalize to the same human-readable slug.
  return `path-${Buffer.from(normalizedRenderPathId, 'utf8').toString('base64url')}`;
}

export function buildFrameOutputNamespace({ sessionId, layerId, renderPathId = null } = {}) {
  const safeSessionId = requireSafeOpaqueSegment(sessionId, 'sessionId');
  const safeLayerId = requireSafeOpaqueSegment(layerId, 'layerId');

  if (renderPathId === null || renderPathId === undefined || renderPathId === '') {
    return `video/frames/${safeSessionId}/${safeLayerId}`;
  }

  return [
    'video',
    'frames',
    safeSessionId,
    'paths',
    getSafeRenderPathDirectoryName(renderPathId),
    safeLayerId,
  ].join('/');
}

export function buildBranchThumbnailAssetPath({ sessionId, renderPathId } = {}) {
  const safeSessionId = requireSafeOpaqueSegment(sessionId, 'sessionId');
  return [
    '',
    'video',
    'splash',
    safeSessionId,
    'paths',
    getSafeRenderPathDirectoryName(renderPathId),
    'thumbnail.png',
  ].join('/');
}

function buildBranchThumbnailSource(renderPath, timelineIndex, {
  divergenceSceneIndex = null,
  selectionTrailIndex = null,
  reason,
} = {}) {
  const timeline = Array.isArray(renderPath?.timeline) ? renderPath.timeline : [];
  const entry = toPlainObject(timeline[timelineIndex]);
  if (!entry) {
    return null;
  }

  return {
    timelineIndex,
    layerId: getTimelineLayerId(entry),
    pathSequenceIndex: getTimelineSequenceIndex(entry, timelineIndex),
    sceneIndex: getTimelineSceneIndex(entry),
    framePath: null,
    divergenceSceneIndex,
    selectionTrailIndex,
    reason,
  };
}

function getCommonLayerPrefixLength(leftPath = {}, rightPath = {}) {
  const leftTimeline = Array.isArray(leftPath?.timeline) ? leftPath.timeline : [];
  const rightTimeline = Array.isArray(rightPath?.timeline) ? rightPath.timeline : [];
  const comparableLength = Math.min(leftTimeline.length, rightTimeline.length);
  let prefixLength = 0;

  while (
    prefixLength < comparableLength &&
    getTimelineLayerId(leftTimeline[prefixLength]) &&
    getTimelineLayerId(leftTimeline[prefixLength]) === getTimelineLayerId(rightTimeline[prefixLength])
  ) {
    prefixLength += 1;
  }

  return prefixLength;
}

/**
 * Resolves the first scene owned by a leaf branch after its immediate parent.
 * Canonical render plans carry that boundary in the final selectionTrail entry.
 * The common-prefix fallback keeps older render plans deterministic.
 */
export function resolveBranchThumbnailSource(renderPath = {}, branchRenderPaths = []) {
  const timeline = Array.isArray(renderPath?.timeline) ? renderPath.timeline : [];
  if (timeline.length === 0) {
    return null;
  }

  const selectionTrail = Array.isArray(renderPath?.selectionTrail)
    ? renderPath.selectionTrail
    : [];
  const selectionTrailIndex = selectionTrail.length - 1;
  if (selectionTrailIndex >= 0) {
    const divergenceSceneIndex = getSelectionDivergenceSceneIndex(
      selectionTrail[selectionTrailIndex],
    );
    if (divergenceSceneIndex !== null) {
      let timelineIndex = timeline.findIndex(
        (entry) => getTimelineSceneIndex(entry) === divergenceSceneIndex + 1,
      );
      if (timelineIndex < 0) {
        timelineIndex = timeline.findIndex((entry) => {
          const sceneIndex = getTimelineSceneIndex(entry);
          return sceneIndex !== null && sceneIndex > divergenceSceneIndex;
        });
      }
      if (timelineIndex >= 0) {
        return buildBranchThumbnailSource(renderPath, timelineIndex, {
          divergenceSceneIndex,
          selectionTrailIndex,
          reason: 'selection_trail',
        });
      }
    }
  }

  const renderPathId = normalizeId(renderPath?.pathId);
  const siblingPaths = (Array.isArray(branchRenderPaths) ? branchRenderPaths : [])
    .filter((candidate) => normalizeId(candidate?.pathId) !== renderPathId);
  const commonPrefixLength = siblingPaths.reduce(
    (deepestPrefix, siblingPath) => Math.max(
      deepestPrefix,
      getCommonLayerPrefixLength(renderPath, siblingPath),
    ),
    0,
  );
  if (commonPrefixLength < timeline.length) {
    return buildBranchThumbnailSource(renderPath, commonPrefixLength, {
      reason: siblingPaths.length > 0 ? 'common_prefix' : 'timeline_start',
    });
  }

  return buildBranchThumbnailSource(renderPath, 0, { reason: 'timeline_start' });
}

export function validateFrameOutputNamespace(frameOutputNamespace, { sessionId, layerId } = {}) {
  if (typeof frameOutputNamespace !== 'string' || !frameOutputNamespace.trim()) {
    throw new Error('frameOutputNamespace must be a non-empty string.');
  }

  const normalizedNamespace = frameOutputNamespace.replace(/\\/g, '/');
  if (
    normalizedNamespace.startsWith('/') ||
    normalizedNamespace.endsWith('/') ||
    normalizedNamespace.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error('frameOutputNamespace contains an unsafe path segment.');
  }

  const safeSessionId = requireSafeOpaqueSegment(sessionId, 'sessionId');
  const safeLayerId = requireSafeOpaqueSegment(layerId, 'layerId');
  const segments = normalizedNamespace.split('/');
  const isSingularDirectory =
    segments.length === 4 &&
    segments[0] === 'video' &&
    segments[1] === 'frames' &&
    segments[2] === safeSessionId &&
    segments[3] === safeLayerId;
  const isBranchDirectory =
    segments.length === 6 &&
    segments[0] === 'video' &&
    segments[1] === 'frames' &&
    segments[2] === safeSessionId &&
    segments[3] === 'paths' &&
    /^path-[A-Za-z0-9_-]+$/.test(segments[4]) &&
    segments[5] === safeLayerId;

  if (!isSingularDirectory && !isBranchDirectory) {
    throw new Error('frameOutputNamespace is outside the allowed session/layer frame directory.');
  }

  return normalizedNamespace;
}

export function resolveBranchRenderContext(session = {}, job = {}) {
  const renderPathId = normalizeId(job.renderPathId);
  if (!renderPathId) {
    throw new Error('Branched frame generation requires renderPathId.');
  }

  if (session?.narrativeType !== 'branched') {
    throw new Error('renderPathId can only be used with a branched VideoSession.');
  }

  const sessionRenderPlanVersion = Number(session?.renderPlanVersion);
  const jobRenderPlanVersion = Number(job?.renderPlanVersion ?? sessionRenderPlanVersion);
  if (
    sessionRenderPlanVersion !== SUPPORTED_RENDER_PLAN_VERSION ||
    jobRenderPlanVersion !== SUPPORTED_RENDER_PLAN_VERSION ||
    jobRenderPlanVersion !== sessionRenderPlanVersion
  ) {
    throw new Error(
      `Unsupported or mismatched renderPlanVersion for path ${renderPathId}.`,
    );
  }

  const branchRenderPaths = Array.isArray(session?.branchRenderPaths)
    ? session.branchRenderPaths
    : [];
  const pathIndex = branchRenderPaths.findIndex(
    (candidate) => normalizeId(candidate?.pathId) === renderPathId,
  );
  if (pathIndex < 0) {
    throw new Error(`Render path ${renderPathId} was not found in the VideoSession.`);
  }

  const renderPath = toPlainObject(branchRenderPaths[pathIndex]);
  const timeline = Array.isArray(renderPath?.timeline) ? renderPath.timeline : [];
  const pathSequenceIndex = normalizeSequenceIndex(job.pathSequenceIndex);
  if (pathSequenceIndex === null) {
    throw new Error(`Render path ${renderPathId} requires a non-negative pathSequenceIndex.`);
  }

  const timelineIndex = findTimelineIndex(timeline, pathSequenceIndex);
  if (timelineIndex < 0) {
    throw new Error(
      `Sequence ${pathSequenceIndex} was not found in render path ${renderPathId}.`,
    );
  }

  const timelineEntry = toPlainObject(timeline[timelineIndex]);
  const timelineLayerId = getTimelineLayerId(timelineEntry);
  const jobLayerId = normalizeId(job.layerId);
  if (!jobLayerId || timelineLayerId !== jobLayerId) {
    throw new Error(
      `Layer ${jobLayerId || '<missing>'} does not match sequence ${pathSequenceIndex} in render path ${renderPathId}.`,
    );
  }

  const layers = Array.isArray(session?.layers) ? session.layers : [];
  const layerIndex = layers.findIndex(
    (candidate) => normalizeId(candidate?._id) === timelineLayerId,
  );
  if (layerIndex < 0) {
    throw new Error(
      `Shared layer ${timelineLayerId} for render path ${renderPathId} was not found.`,
    );
  }

  const sharedLayer = toPlainObject(layers[layerIndex]);
  const duration = normalizePositiveDuration(
    timelineEntry.duration,
    `branchRenderPaths.${pathIndex}.timeline.${timelineIndex}.duration`,
  );
  const durationOffset = normalizeDurationOffset(
    timelineEntry.durationOffset,
    `branchRenderPaths.${pathIndex}.timeline.${timelineIndex}.durationOffset`,
  );
  const retimedSharedLayer = retimeLayerSessionSubtitles(
    sharedLayer,
    durationOffset,
    session,
  );
  const effectiveLayer = {
    ...retimedSharedLayer,
    duration,
    durationOffset,
    frames: Array.isArray(timelineEntry.frames) ? [...timelineEntry.frames] : [],
    frameGenerationPending: timelineEntry.frameGenerationPending === true,
    frameGenerationStatus: timelineEntry.frameGenerationStatus || 'PENDING',
    frameGenerationError: timelineEntry.frameGenerationError || timelineEntry.error || null,
  };

  return {
    renderPathId,
    renderPlanVersion: sessionRenderPlanVersion,
    pathSequenceIndex,
    pathIndex,
    timelineIndex,
    renderPath,
    timelineEntry,
    timelineLayerId,
    layerIndex,
    sharedLayer,
    effectiveLayer,
    pathDuration: getPathDuration(renderPath, timeline),
    frameOutputNamespace: buildFrameOutputNamespace({
      sessionId: session?._id,
      layerId: timelineLayerId,
      renderPathId,
    }),
  };
}

function buildEffectiveTimelineLayers(session = {}, renderPath = {}) {
  const sharedLayers = Array.isArray(session?.layers) ? session.layers : [];
  const sharedLayerById = new Map(
    sharedLayers.map((layer) => [normalizeId(layer?._id), toPlainObject(layer)]),
  );
  const timeline = Array.isArray(renderPath?.timeline) ? renderPath.timeline : [];

  return timeline.map((rawEntry, arrayIndex) => {
    const entry = toPlainObject(rawEntry);
    const layerId = getTimelineLayerId(entry);
    const sharedLayer = sharedLayerById.get(layerId);
    if (!sharedLayer) {
      throw new Error(
        `Shared layer ${layerId || '<missing>'} for sequence ${arrayIndex} was not found.`,
      );
    }

    const durationOffset = normalizeDurationOffset(
      entry.durationOffset,
      `timeline.${arrayIndex}.durationOffset`,
    );
    const retimedSharedLayer = retimeLayerSessionSubtitles(
      sharedLayer,
      durationOffset,
      session,
    );

    return {
      ...retimedSharedLayer,
      duration: normalizePositiveDuration(entry.duration, `timeline.${arrayIndex}.duration`),
      durationOffset,
      frames: Array.isArray(entry.frames) ? [...entry.frames] : [],
      frameGenerationPending: entry.frameGenerationPending === true,
      frameGenerationStatus: entry.frameGenerationStatus || 'PENDING',
      frameGenerationError: entry.frameGenerationError || entry.error || null,
      branchPathSequenceIndex: normalizeSequenceIndex(entry.sequenceIndex) ?? arrayIndex,
    };
  });
}

function buildEffectiveAudioTimeline(session = {}, renderPath = {}, effectiveLayers = []) {
  const sharedAudioLayers = Array.isArray(session?.audioLayers) ? session.audioLayers : [];
  const sharedAudioById = new Map(
    sharedAudioLayers.map((audioLayer) => [normalizeId(audioLayer?._id), toPlainObject(audioLayer)]),
  );
  const audioTimeline = Array.isArray(renderPath?.audioTimeline)
    ? renderPath.audioTimeline
    : [];

  if (audioTimeline.length === 0) {
    return sharedAudioLayers.map(toPlainObject);
  }

  return audioTimeline.map((rawEntry, arrayIndex) => {
    const entry = toPlainObject(rawEntry);
    const audioLayerId = getAudioTimelineLayerId(entry);
    const sharedAudioLayer = sharedAudioById.get(audioLayerId);
    if (!sharedAudioLayer) {
      throw new Error(
        `Shared audio layer ${audioLayerId || '<missing>'} for audio sequence ${arrayIndex} was not found.`,
      );
    }

    const effectiveAudioLayer = { ...sharedAudioLayer };
    for (const field of [
      'duration',
      'startTime',
      'endTime',
      'connectedLayerStartTimeOffset',
      'connectedLayerId',
      'connectedLayerIndex',
    ]) {
      if (entry[field] !== undefined && entry[field] !== null) {
        effectiveAudioLayer[field] = entry[field];
      }
    }

    const connectedSequenceIndex = normalizeSequenceIndex(entry.pathSequenceIndex);
    const connectedLayerIndex = connectedSequenceIndex !== null
      ? effectiveLayers.findIndex(
        (layer) => layer.branchPathSequenceIndex === connectedSequenceIndex,
      )
      : effectiveLayers.findIndex(
        (layer) => normalizeId(layer?._id) === normalizeId(effectiveAudioLayer.connectedLayerId),
      );
    if (connectedLayerIndex >= 0) {
      effectiveAudioLayer.connectedLayerId = normalizeId(
        effectiveLayers[connectedLayerIndex]._id,
      );
      effectiveAudioLayer.connectedLayerIndex = connectedLayerIndex;
      effectiveAudioLayer.connectedLayerStartTimeOffset =
        effectiveLayers[connectedLayerIndex].durationOffset;
    }

    return effectiveAudioLayer;
  });
}

export function buildEffectiveBranchSession(session = {}, renderPath = {}) {
  const effectiveLayers = buildEffectiveTimelineLayers(session, renderPath);
  const effectiveAudioLayers = buildEffectiveAudioTimeline(
    session,
    renderPath,
    effectiveLayers,
  );

  return {
    ...toPlainObject(session),
    layers: effectiveLayers,
    audioLayers: effectiveAudioLayers,
    totalDuration: getPathDuration(renderPath, renderPath.timeline),
  };
}

export function isBranchTimelineEntryComplete(entry = {}) {
  return (
    entry?.frameGenerationPending !== true &&
    entry?.frameGenerationStatus === 'COMPLETED' &&
    Array.isArray(entry?.frames) &&
    entry.frames.length > 0
  );
}

export function isBranchPathFrameComplete(renderPath = {}) {
  const timeline = Array.isArray(renderPath?.timeline) ? renderPath.timeline : [];
  return timeline.length > 0 && timeline.every(isBranchTimelineEntryComplete);
}

export const BRANCH_RENDER_PLAN_VERSION = SUPPORTED_RENDER_PLAN_VERSION;
