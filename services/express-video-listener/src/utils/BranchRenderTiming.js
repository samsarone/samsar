const LOCKED_BILLING_STATUSES = new Set([
  'CHARGED',
  'CHARGING',
  'CUSTOM_SUCCEEDED',
  'WAIVED',
]);

const DURATION_BILLING_STAGES = Object.freeze({
  IMAGE: 'image_generation',
  SPEECH: 'speech_generation',
  MUSIC: 'music_generation',
  AI_VIDEO: 'ai_video_generation',
  LIP_SYNC: 'lip_sync_generation',
  SOUND_EFFECT: 'sound_effect_generation',
  NARRATOR_AVATAR: 'narrator_avatar_generation',
  PIPELINE: 'pipeline',
});

export const BRANCHING_TIMELINE_SCHEMA = 'branching_timeline.v1';

function normalizeId(value) {
  if (value === null || value === undefined) return '';
  return value?.toString?.().trim?.() || '';
}

function normalizeAudioType(value) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[\s-]+/g, '_')
    : '';
}

function normalizeBillingStatus(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function getPositiveDuration(value) {
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function getNonNegativeInteger(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized >= 0 ? normalized : null;
}

function toPlainObject(value) {
  if (!value || typeof value !== 'object') return value;
  return typeof value.toObject === 'function' ? value.toObject() : value;
}

function cloneObject(value) {
  const plainValue = toPlainObject(value);
  return plainValue && typeof plainValue === 'object' ? { ...plainValue } : {};
}

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getSelectionTrail(path = {}) {
  return Array.isArray(path?.selectionTrail) ? path.selectionTrail : [];
}

/**
 * Builds the compact, render-facing choice graph persisted on branched video
 * sessions. Path-local frame and audio timelines remain on branchRenderPaths;
 * this document contains only the metadata a player needs to switch media.
 */
export function buildBranchingTimeline({
  branchRenderPaths = [],
  branchingMeta = {},
  defaultBranchPathId = null,
} = {}) {
  const paths = (Array.isArray(branchRenderPaths) ? branchRenderPaths : [])
    .map((rawPath) => toPlainObject(rawPath) || {})
    .filter((path) => normalizeId(path.pathId));
  const configuredBranchPoints = Array.isArray(branchingMeta?.branchPoints)
    ? [...branchingMeta.branchPoints].sort((left, right) => {
      const levelDifference = (Number(left?.level) || 0) - (Number(right?.level) || 0);
      if (levelDifference !== 0) return levelDifference;
      return normalizeId(left?.parentNodeId).localeCompare(
        normalizeId(right?.parentNodeId),
        undefined,
        { numeric: true },
      );
    })
    : [];
  const trailEntries = paths.flatMap((path) => getSelectionTrail(path).map((rawChoice) => ({
    ...cloneObject(rawChoice),
    leafPathId: normalizeId(path.pathId),
  })));

  const matchingEntriesForPoint = (branchPoint = {}) => {
    const branchPointId = normalizeId(
      branchPoint.branchPointId ?? branchPoint.branch_point_id,
    );
    const parentNodeId = normalizeId(
      branchPoint.parentNodeId ?? branchPoint.parent_node_id,
    );
    return trailEntries.filter((entry) => {
      const entryBranchPointId = normalizeId(
        entry.branchPointId ?? entry.branch_point_id,
      );
      const entryParentNodeId = normalizeId(
        entry.parentNodeId ?? entry.parent_node_id,
      );
      return (branchPointId && entryBranchPointId === branchPointId) ||
        (!branchPointId && parentNodeId && entryParentNodeId === parentNodeId);
    });
  };

  const buildOptions = (branchPoint = {}, matchingEntries = []) => {
    const configuredOptions = Array.isArray(branchPoint?.divergencePaths)
      ? branchPoint.divergencePaths
      : [];
    const sourceOptions = configuredOptions.length > 0
      ? configuredOptions
      : [...new Map(matchingEntries.map((entry) => [
        normalizeId(entry.nodeId ?? entry.node_id ?? entry.childNodeId),
        entry,
      ])).values()];

    return sourceOptions.map((rawOption, optionIndex) => {
      const option = toPlainObject(rawOption) || {};
      const childNodeId = normalizeId(
        option.childNodeId ?? option.child_node_id ?? option.nodeId ?? option.node_id,
      );
      const matchingChoice = matchingEntries.find((entry) => (
        normalizeId(entry.nodeId ?? entry.node_id ?? entry.childNodeId) === childNodeId
      )) || {};
      return {
        childNodeId,
        branchOrdinal: getNonNegativeInteger(
          option.branchOrdinal ?? option.branch_ordinal ?? matchingChoice.branchOrdinal,
        ) ?? optionIndex + 1,
        branchingHint: normalizeOptionalString(
          option.branchingHint ?? option.path_name ?? option.pathName ??
          matchingChoice.branchingHint ?? matchingChoice.pathName ?? matchingChoice.path_name,
        ),
        description: normalizeOptionalString(
          option.description ?? option.path_description ?? option.pathDescription ??
          matchingChoice.description ?? matchingChoice.pathDescription ??
          matchingChoice.path_description,
        ),
        leafPathIds: paths
          .filter((path) => getSelectionTrail(path).some((choice) => (
            normalizeId(choice.nodeId ?? choice.node_id ?? choice.childNodeId) === childNodeId
          )))
          .map((path) => normalizeId(path.pathId)),
      };
    }).filter((option) => option.childNodeId && option.leafPathIds.length > 0);
  };

  let sourceBranchPoints = configuredBranchPoints;
  if (sourceBranchPoints.length === 0) {
    const groupedEntries = new Map();
    trailEntries.forEach((entry) => {
      const branchPointId = normalizeId(entry.branchPointId ?? entry.branch_point_id);
      const parentNodeId = normalizeId(entry.parentNodeId ?? entry.parent_node_id);
      const level = getNonNegativeInteger(entry.level) ?? 0;
      const key = branchPointId || `${parentNodeId || 'root'}:${level}`;
      const group = groupedEntries.get(key) || [];
      group.push(entry);
      groupedEntries.set(key, group);
    });
    sourceBranchPoints = [...groupedEntries.entries()].map(([branchPointId, entries]) => ({
      branchPointId,
      parentNodeId: entries[0]?.parentNodeId ?? entries[0]?.parent_node_id,
      level: entries[0]?.level,
      divergenceSceneIndex:
        entries[0]?.divergenceSceneIndex ?? entries[0]?.divergence_scene_index,
      __matchingEntries: entries,
    }));
  }

  const choicePoints = sourceBranchPoints.map((rawBranchPoint) => {
    const branchPoint = toPlainObject(rawBranchPoint) || {};
    const matchingEntries = branchPoint.__matchingEntries ||
      matchingEntriesForPoint(branchPoint);
    const timingChoice = matchingEntries[0] || {};
    return {
      branchPointId: normalizeId(
        branchPoint.branchPointId ?? branchPoint.branch_point_id,
      ),
      parentNodeId: normalizeId(
        branchPoint.parentNodeId ?? branchPoint.parent_node_id ??
        timingChoice.parentNodeId ?? timingChoice.parent_node_id,
      ) || null,
      level: getNonNegativeInteger(branchPoint.level ?? timingChoice.level),
      divergenceSceneIndex: getNonNegativeInteger(
        branchPoint.divergenceSceneIndex ?? branchPoint.divergence_scene_index ??
        timingChoice.divergenceSceneIndex ?? timingChoice.divergence_scene_index,
      ),
      switchAtSeconds: Number.isFinite(Number(
        timingChoice.switchAtSeconds ?? timingChoice.switch_at_seconds,
      ))
        ? Number(timingChoice.switchAtSeconds ?? timingChoice.switch_at_seconds)
        : null,
      options: buildOptions(branchPoint, matchingEntries),
    };
  }).filter((choicePoint) => (
    choicePoint.branchPointId &&
    choicePoint.switchAtSeconds !== null &&
    choicePoint.options.length > 0
  ));

  const configuredDefaultPathId = normalizeId(defaultBranchPathId);
  const effectiveDefaultPathId = paths.some((path) => (
    normalizeId(path.pathId) === configuredDefaultPathId
  ))
    ? configuredDefaultPathId
    : normalizeId(paths[0]?.pathId) || null;

  return {
    schemaVersion: BRANCHING_TIMELINE_SCHEMA,
    timing: { origin: 'media', unit: 'seconds' },
    rootNodeId: normalizeId(branchingMeta?.rootNodeId) ||
      normalizeId(paths[0]?.nodeIds?.[0]) || null,
    defaultPathId: effectiveDefaultPathId,
    choicePoints,
  };
}

function getAudioLayerId(audioLayer = {}) {
  return normalizeId(audioLayer?._id ?? audioLayer?.id);
}

function getTimelineLayerId(entry = {}) {
  return normalizeId(entry?.layerId ?? entry?.layer_id);
}

function getAudioTimelineLayerId(entry = {}) {
  return normalizeId(
    entry?.audioLayerId ??
    entry?.audio_layer_id ??
    entry?.layerId ??
    entry?._id,
  );
}

function getConnectedLayerId(entry = {}, sharedAudioLayer = {}) {
  return normalizeId(
    entry?.connectedLayerId ??
    entry?.connected_layer_id ??
    sharedAudioLayer?.connectedLayerId ??
    sharedAudioLayer?.connected_layer_id,
  );
}

function getSharedLayerDurationById(layers = []) {
  return new Map(
    layers.flatMap((rawLayer) => {
      const layer = toPlainObject(rawLayer) || {};
      const layerId = normalizeId(layer?._id ?? layer?.id);
      const duration = getPositiveDuration(layer?.duration);
      return layerId && duration !== null ? [[layerId, duration]] : [];
    }),
  );
}

function getSharedAudioById(audioLayers = []) {
  return new Map(
    audioLayers.flatMap((rawAudioLayer) => {
      const audioLayer = toPlainObject(rawAudioLayer) || {};
      const audioLayerId = getAudioLayerId(audioLayer);
      return audioLayerId ? [[audioLayerId, audioLayer]] : [];
    }),
  );
}

function findConnectedTimelineIndex(entry, sharedAudioLayer, timeline) {
  const pathSequenceIndex = getNonNegativeInteger(
    entry?.pathSequenceIndex ?? entry?.sequenceIndex,
  );
  if (pathSequenceIndex !== null) {
    const sequenceMatchIndex = timeline.findIndex((timelineEntry, arrayIndex) => (
      (getNonNegativeInteger(timelineEntry?.sequenceIndex) ?? arrayIndex) === pathSequenceIndex
    ));
    if (sequenceMatchIndex >= 0) return sequenceMatchIndex;
  }

  const connectedLayerId = getConnectedLayerId(entry, sharedAudioLayer);
  return timeline.findIndex(
    (timelineEntry) => getTimelineLayerId(timelineEntry) === connectedLayerId,
  );
}

function retimeSelectionTrail(selectionTrail, timeline) {
  if (!Array.isArray(selectionTrail)) return [];

  return selectionTrail.map((rawChoice) => {
    const choice = cloneObject(rawChoice);
    const divergenceSceneIndex = getNonNegativeInteger(choice.divergenceSceneIndex);
    if (divergenceSceneIndex === null) return choice;

    const divergenceTimelineEntry = [...timeline].reverse().find(
      (entry) => getNonNegativeInteger(entry?.sceneIndex) === divergenceSceneIndex,
    );
    if (divergenceTimelineEntry) {
      choice.switchAtSeconds = divergenceTimelineEntry.endTime;
    }
    return choice;
  });
}

function retimeAudioTimeline(audioTimeline, timeline, pathDuration, sharedAudioById) {
  if (!Array.isArray(audioTimeline)) return [];

  return audioTimeline.map((rawEntry) => {
    const entry = cloneObject(rawEntry);
    const audioLayerId = getAudioTimelineLayerId(entry);
    const sharedAudioLayer = sharedAudioById.get(audioLayerId) || {};
    const connectedLayerId = getConnectedLayerId(entry, sharedAudioLayer);
    const audioType = normalizeAudioType(
      sharedAudioLayer?.generationType ??
      sharedAudioLayer?.type ??
      sharedAudioLayer?.audioType ??
      entry?.generationType ??
      entry?.type ??
      entry?.audioType,
    );
    const isGlobalAudio = !connectedLayerId || audioType === 'music';

    if (isGlobalAudio) {
      return {
        ...entry,
        duration: pathDuration,
        startTime: 0,
        endTime: pathDuration,
        connectedLayerStartTimeOffset: 0,
      };
    }

    const connectedTimelineIndex = findConnectedTimelineIndex(
      entry,
      sharedAudioLayer,
      timeline,
    );
    if (connectedTimelineIndex < 0) {
      return entry;
    }

    const connectedTimelineEntry = timeline[connectedTimelineIndex];
    const connectedLayerDuration = getPositiveDuration(connectedTimelineEntry.duration) || 0;
    const sharedAudioDuration = getPositiveDuration(sharedAudioLayer?.duration);
    const entryAudioDuration = getPositiveDuration(entry.duration);
    const audioDuration = sharedAudioDuration || entryAudioDuration || connectedLayerDuration;
    const audioStartOffset = audioType === 'speech' && connectedLayerDuration > audioDuration
      ? (connectedLayerDuration - audioDuration) / 2
      : 0;
    const startTime = connectedTimelineEntry.startTime + audioStartOffset;

    return {
      ...entry,
      connectedLayerId: getTimelineLayerId(connectedTimelineEntry),
      connectedLayerIndex: connectedTimelineIndex,
      pathSequenceIndex: getNonNegativeInteger(connectedTimelineEntry.sequenceIndex)
        ?? connectedTimelineIndex,
      connectedLayerStartTimeOffset: audioStartOffset,
      duration: audioDuration,
      startTime,
      endTime: startTime + audioDuration,
    };
  });
}

function retimePath({
  rawPath,
  sharedLayerDurationById,
  sharedAudioById,
  durationOverrideByLayerId,
}) {
  const path = cloneObject(rawPath);
  const rawTimeline = Array.isArray(path.timeline) ? path.timeline : [];
  let durationOffset = 0;
  const timeline = rawTimeline.map((rawEntry, arrayIndex) => {
    const entry = cloneObject(rawEntry);
    const layerId = getTimelineLayerId(entry);
    const duration = durationOverrideByLayerId.get(layerId)
      ?? sharedLayerDurationById.get(layerId)
      ?? getPositiveDuration(entry.duration);
    if (duration === null || duration === undefined) {
      throw new Error(
        `Branch path ${normalizeId(path.pathId) || '<unknown>'} has an invalid duration at timeline index ${arrayIndex}.`,
      );
    }

    const retimedEntry = {
      ...entry,
      sequenceIndex: getNonNegativeInteger(entry.sequenceIndex) ?? arrayIndex,
      duration,
      durationOffset,
      startTime: durationOffset,
      endTime: durationOffset + duration,
    };
    durationOffset += duration;
    return retimedEntry;
  });
  const selectionTrail = retimeSelectionTrail(path.selectionTrail, timeline);
  const immediateChoice = selectionTrail.at(-1) || {};

  return {
    ...path,
    duration: durationOffset,
    timeline,
    selectionTrail,
    ...(selectionTrail.length > 0
      ? {
        branchingHint: normalizeOptionalString(
          immediateChoice.branchingHint ?? immediateChoice.pathName ?? immediateChoice.path_name,
        ),
        branchingDescription: normalizeOptionalString(
          immediateChoice.branchingDescription ?? immediateChoice.pathDescription ??
          immediateChoice.path_description,
        ),
        branchPointId: normalizeId(
          immediateChoice.branchPointId ?? immediateChoice.branch_point_id,
        ) || null,
        divergenceSceneIndex: getNonNegativeInteger(
          immediateChoice.divergenceSceneIndex ?? immediateChoice.divergence_scene_index,
        ),
        switchAtSeconds: Number.isFinite(Number(
          immediateChoice.switchAtSeconds ?? immediateChoice.switch_at_seconds,
        ))
          ? Number(immediateChoice.switchAtSeconds ?? immediateChoice.switch_at_seconds)
          : null,
      }
      : {}),
    audioTimeline: retimeAudioTimeline(
      path.audioTimeline,
      timeline,
      durationOffset,
      sharedAudioById,
    ),
  };
}

/**
 * Rebuilds every saved leaf timeline from the shared media catalog. This is
 * useful immediately before frame fan-out because audio/lip-sync/video workers
 * may have changed shared asset durations after the initial plan was saved.
 */
export function normalizeBranchRenderPathTimings({
  branchRenderPaths = [],
  layers = [],
  audioLayers = [],
} = {}) {
  if (!Array.isArray(branchRenderPaths)) return [];
  const sharedLayerDurationById = getSharedLayerDurationById(layers);
  const sharedAudioById = getSharedAudioById(audioLayers);
  return branchRenderPaths.map((rawPath) => retimePath({
    rawPath,
    sharedLayerDurationById,
    sharedAudioById,
    durationOverrideByLayerId: new Map(),
  }));
}

/**
 * Applies a shared layer duration change to every leaf that references it and
 * recomputes that leaf's visual, choice, and audio timing without mutating the
 * input render plan.
 */
export function retimeBranchRenderPathsForSharedLayer({
  branchRenderPaths = [],
  layers = [],
  audioLayers = [],
  layerId,
  duration,
} = {}) {
  const normalizedLayerId = normalizeId(layerId);
  const normalizedDuration = getPositiveDuration(duration);
  if (!normalizedLayerId || normalizedDuration === null) {
    throw new TypeError('A shared layer id and positive duration are required.');
  }

  const sharedLayerDurationById = getSharedLayerDurationById(layers);
  const sharedAudioById = getSharedAudioById(audioLayers);
  const durationOverrideByLayerId = new Map([[normalizedLayerId, normalizedDuration]]);

  return (Array.isArray(branchRenderPaths) ? branchRenderPaths : []).map((rawPath) => {
    const path = toPlainObject(rawPath) || {};
    const referencesChangedLayer = Array.isArray(path.timeline) && path.timeline.some(
      (entry) => getTimelineLayerId(entry) === normalizedLayerId,
    );
    if (!referencesChangedLayer) return rawPath;

    return retimePath({
      rawPath,
      sharedLayerDurationById,
      sharedAudioById,
      durationOverrideByLayerId,
    });
  });
}

function isBillingStageLocked(creditCharges, stageKey) {
  const status = normalizeBillingStatus(creditCharges?.stages?.[stageKey]?.status);
  return LOCKED_BILLING_STATUSES.has(status);
}

function getUniqueBranchLayerDuration(branchRenderPaths, layers = []) {
  const catalogLayers = Array.isArray(layers) ? layers : [];
  if (catalogLayers.length > 0) {
    const seenLayerIds = new Set();
    return catalogLayers.reduce((total, rawLayer, index) => {
      const layer = toPlainObject(rawLayer) || {};
      const duration = getPositiveDuration(layer?.duration);
      if (duration === null) return total;
      const identity = normalizeId(layer?._id ?? layer?.id ?? layer?.branchAssetKey) ||
        `index:${index}`;
      if (seenLayerIds.has(identity)) return total;
      seenLayerIds.add(identity);
      return total + duration;
    }, 0);
  }

  const layerDurationByKey = new Map();
  for (const path of branchRenderPaths) {
    const timeline = Array.isArray(path?.timeline) ? path.timeline : [];
    for (const entry of timeline) {
      const layerKey = getTimelineLayerId(entry) || normalizeId(entry?.assetKey);
      if (!layerKey) continue;
      const duration = getPositiveDuration(entry?.duration);
      if (duration !== null) layerDurationByKey.set(layerKey, duration);
    }
  }
  return [...layerDurationByKey.values()].reduce((total, duration) => total + duration, 0);
}

/** Returns duration-derived session fields while preserving locked stage rates. */
export function buildBranchDurationSessionMetadata({
  branchRenderPaths = [],
  layers = [],
  expressGenerationBillingDurationSeconds = null,
  expressGenerationBillingStageDurations = {},
  expressGenerationCreditCharges = {},
} = {}) {
  const paths = Array.isArray(branchRenderPaths) ? branchRenderPaths : [];
  const pathDurations = paths.map((path) => getPositiveDuration(path?.duration) || 0);
  const maxPathDuration = pathDurations.reduce((maximum, duration) => (
    Math.max(maximum, duration)
  ), 0);
  const uniqueLayerDuration = getUniqueBranchLayerDuration(paths, layers);
  const configuredBillingDuration = getPositiveDuration(
    expressGenerationBillingDurationSeconds,
  );
  const billableLayerDuration = configuredBillingDuration ??
    (uniqueLayerDuration > 0 ? uniqueLayerDuration : maxPathDuration);
  const stageDurations = {
    ...(expressGenerationBillingStageDurations || {}),
  };

  for (const stageKey of [
    DURATION_BILLING_STAGES.IMAGE,
    DURATION_BILLING_STAGES.SPEECH,
    DURATION_BILLING_STAGES.MUSIC,
    DURATION_BILLING_STAGES.AI_VIDEO,
    DURATION_BILLING_STAGES.LIP_SYNC,
    DURATION_BILLING_STAGES.SOUND_EFFECT,
    DURATION_BILLING_STAGES.NARRATOR_AVATAR,
    DURATION_BILLING_STAGES.PIPELINE,
  ]) {
    if (!isBillingStageLocked(expressGenerationCreditCharges, stageKey)) {
      stageDurations[stageKey] = billableLayerDuration;
    }
  }

  return {
    totalDuration: maxPathDuration,
    expressGenerationBillingDurationSeconds: billableLayerDuration,
    expressGenerationBillingStageDurations: stageDurations,
  };
}

export const __testOnly__ = {
  DURATION_BILLING_STAGES,
  getUniqueBranchLayerDuration,
  retimeSelectionTrail,
};
