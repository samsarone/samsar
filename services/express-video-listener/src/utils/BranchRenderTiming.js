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

  return {
    ...path,
    duration: durationOffset,
    timeline,
    selectionTrail: retimeSelectionTrail(path.selectionTrail, timeline),
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
