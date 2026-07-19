import { createHash } from 'node:crypto';

import {
  buildBranchingMeta,
  validateBranchingNarrativeTree,
} from './BranchingNarrativeTree.js';

export const BRANCHED_VIDEO_RENDER_PLAN_VERSION = 1;

function buildPlanError(message, details = {}) {
  const error = new Error(message);
  error.code = 'BRANCH_RENDER_PLAN_INVALID';
  error.status = 422;
  error.statusCode = 422;
  Object.assign(error, details);
  return error;
}

function deepCloneJson(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function normalizeSceneIndex(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      if (value[key] !== undefined) result[key] = stableJsonValue(value[key]);
      return result;
    }, {});
}

function hashJson(value) {
  return createHash('sha256')
    .update(JSON.stringify(stableJsonValue(value)))
    .digest('hex');
}

function comparePathIds(left, right) {
  const leftParts = String(left).split('.');
  const rightParts = String(right).split('.');
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    if (leftParts[index] === undefined) return -1;
    if (rightParts[index] === undefined) return 1;
    const leftNumber = Number(leftParts[index]);
    const rightNumber = Number(rightParts[index]);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      if (leftNumber !== rightNumber) return leftNumber - rightNumber;
    } else {
      const comparison = leftParts[index].localeCompare(rightParts[index]);
      if (comparison !== 0) return comparison;
    }
  }
  return 0;
}

function getNodeAncestry(leafNode, nodeById) {
  const ancestry = [];
  const seen = new Set();
  let node = leafNode;
  while (node) {
    if (seen.has(node.nodeId)) {
      throw buildPlanError(`Branch ancestry contains a cycle at ${node.nodeId}.`);
    }
    seen.add(node.nodeId);
    ancestry.push(node);
    node = node.parentNodeId ? nodeById.get(node.parentNodeId) : null;
  }
  return ancestry.reverse();
}

function buildSelectionTrail(ancestry, branchPointByParentId, scenes = []) {
  return ancestry.slice(1).map((node) => {
    const branchPoint = branchPointByParentId.get(node.parentNodeId);
    const divergenceSceneIndex = node.divergence?.divergenceSceneIndex ?? null;
    const switchAtSeconds = Number.isInteger(divergenceSceneIndex)
      ? scenes.slice(0, divergenceSceneIndex + 1).reduce(
        (total, scene) => total + (Number(scene?.duration) || 0),
        0,
      )
      : null;
    return {
      nodeId: node.nodeId,
      parentNodeId: node.parentNodeId,
      branchPointId: branchPoint?.branchPointId || null,
      level: node.level,
      childIndex: node.childIndex,
      branchOrdinal: node.branchOrdinal,
      divergenceSceneIndex,
      switchAtSeconds,
      pathName: node.divergence?.path_name || null,
      pathDescription: node.divergence?.path_description || null,
    };
  });
}

function buildTimelineItem({ unit, sceneIndex, sequenceIndex, durationOffset }) {
  const duration = Number(unit.scene?.duration);
  return {
    assetKey: unit.assetKey,
    sequenceIndex,
    sceneIndex,
    layerId: null,
    duration,
    durationOffset,
    startTime: durationOffset,
    endTime: durationOffset + duration,
    frames: [],
    frameGenerationStatus: 'INIT',
    frameGenerationPending: false,
    frameGenerationError: null,
  };
}

function buildAudioTimelineItems({ unit, sceneIndex, durationOffset }) {
  return unit.sounds.map((sound, soundIndex) => {
    const duration = Number(sound?.duration);
    const normalizedDuration = Number.isFinite(duration) && duration > 0
      ? duration
      : Number(unit.scene?.duration);
    return {
      assetKey: unit.audioAssetKeys[soundIndex],
      audioLayerId: null,
      connectedLayerId: null,
      sceneIndex,
      duration: normalizedDuration,
      startTime: durationOffset,
      endTime: durationOffset + normalizedDuration,
    };
  });
}

function createCanonicalUnit(scene, sounds, sceneIndex) {
  const sourceScene = deepCloneJson(scene);
  const sourceSounds = deepCloneJson(sounds);
  const assetKey = `scene:${sceneIndex}:${hashJson({ sceneIndex, scene: sourceScene, sounds: sourceSounds })}`;
  const audioAssetKeys = sourceSounds.map((sound, soundIndex) => (
    `audio:${hashJson({ assetKey, soundIndex, sound })}`
  ));
  return {
    assetKey,
    audioAssetKeys,
    sourceSceneIndex: sceneIndex,
    scene: sourceScene,
    sounds: sourceSounds,
  };
}

function getDocumentId(value) {
  const id = value?._id ?? value?.id ?? value;
  if (id === null || id === undefined) return null;
  return id?.toString?.() || String(id);
}

/**
 * Converts a validated branching narrative tree into one canonical media asset
 * pool and one linear render path per leaf. Identical timeline units are keyed
 * by their scene index, exact scene JSON, and exact associated sound list, so a
 * shared prefix is generated once even though it is referenced by every leaf.
 */
export function buildBranchedVideoSessionPlan(movieResourceList, {
  branchingMeta = null,
  videoGenerationModel = 'RUNWAYML',
  framesPerSecond = undefined,
  requestedDuration = null,
  validateMovieResourceList,
} = {}) {
  const tree = movieResourceList?.movieResourceList || movieResourceList;
  const validation = validateBranchingNarrativeTree(tree, {
    videoGenerationModel,
    framesPerSecond,
    requestedDuration,
    includeNormalizedNodeResourceLists: true,
    ...(validateMovieResourceList ? { validateMovieResourceList } : {}),
  });
  if (!validation.valid) {
    throw buildPlanError(
      `The branched movieResourceList is invalid: ${validation.errors.join(', ')}`,
      { validationErrors: validation.errors },
    );
  }

  const nodeById = new Map(tree.nodes.map((node) => [node.nodeId, node]));
  const branchPointByParentId = new Map(
    tree.branchPoints.map((branchPoint) => [branchPoint.parentNodeId, branchPoint]),
  );
  const leafNodeIds = [...validation.leafNodeIds].sort(comparePathIds);
  const calculatedBranchingMeta = buildBranchingMeta(tree);
  if (branchingMeta) {
    const metadataChecks = [
      ['schemaVersion', calculatedBranchingMeta.schemaVersion],
      ['numLevels', calculatedBranchingMeta.numLevels],
      ['branchingFactor', calculatedBranchingMeta.branchingFactor],
      ['rootNodeId', calculatedBranchingMeta.rootNodeId],
    ];
    const invalidScalar = metadataChecks.find(([key, expected]) => branchingMeta[key] !== expected);
    const suppliedLeaves = Array.isArray(branchingMeta.leafNodeIds)
      ? [...branchingMeta.leafNodeIds].sort(comparePathIds)
      : [];
    const calculatedLeaves = [...calculatedBranchingMeta.leafNodeIds].sort(comparePathIds);
    if (invalidScalar || JSON.stringify(suppliedLeaves) !== JSON.stringify(calculatedLeaves)) {
      throw buildPlanError('branchingMeta does not match the validated narrative tree.');
    }
  }
  const canonicalUnitByKey = new Map();
  const canonicalUnits = [];
  const paths = [];

  for (const [ordinal, leafNodeId] of leafNodeIds.entries()) {
    const leafNode = nodeById.get(leafNodeId);
    const ancestry = getNodeAncestry(leafNode, nodeById);
    const normalizedLeafResource = validation.normalizedNodeResourceLists?.[leafNodeId];
    const leafScenes = Array.isArray(normalizedLeafResource?.scenes)
      ? normalizedLeafResource.scenes
      : leafNode.scenes;
    const leafSounds = Array.isArray(normalizedLeafResource?.sounds)
      ? normalizedLeafResource.sounds
      : Array.isArray(leafNode.sounds) ? leafNode.sounds : [];
    let durationOffset = 0;
    const timeline = [];
    const audioTimeline = [];

    for (let sceneIndex = 0; sceneIndex < leafScenes.length; sceneIndex += 1) {
      const scene = leafScenes[sceneIndex];
      const associatedSounds = leafSounds.filter(
        (sound) => normalizeSceneIndex(sound?.sceneIndex) === sceneIndex,
      );
      const candidate = createCanonicalUnit(scene, associatedSounds, sceneIndex);
      let unit = canonicalUnitByKey.get(candidate.assetKey);
      if (!unit) {
        unit = { ...candidate, poolIndex: canonicalUnits.length };
        canonicalUnitByKey.set(unit.assetKey, unit);
        canonicalUnits.push(unit);
      }
      timeline.push(buildTimelineItem({
        unit,
        sceneIndex,
        sequenceIndex: sceneIndex,
        durationOffset,
      }));
      audioTimeline.push(...buildAudioTimelineItems({ unit, sceneIndex, durationOffset }));
      durationOffset += Number(scene.duration);
    }

    paths.push({
      pathId: leafNodeId,
      leafNodeId,
      ordinal,
      nodeIds: ancestry.map((node) => node.nodeId),
      selectionTrail: buildSelectionTrail(ancestry, branchPointByParentId, leafScenes),
      duration: durationOffset,
      timeline,
      audioTimeline,
      frameGenerationStatus: 'INIT',
      frameGenerationPending: false,
      frameGenerationError: null,
      videoGenerationStatus: 'INIT',
      videoGenerationPending: false,
      videoGenerationError: null,
      videoLink: null,
      remoteURL: null,
    });
  }

  let canonicalDurationOffset = 0;
  const canonicalScenes = [];
  const canonicalSounds = [];
  for (const unit of canonicalUnits) {
    const duration = Number(unit.scene.duration);
    canonicalScenes.push({
      ...deepCloneJson(unit.scene),
      sceneIndex: unit.poolIndex,
      startTime: canonicalDurationOffset,
      endTime: canonicalDurationOffset + duration,
      branchAssetKey: unit.assetKey,
      branchSourceSceneIndex: unit.sourceSceneIndex,
    });
    unit.sounds.forEach((sound, soundIndex) => {
      const soundDuration = Number(sound?.duration);
      const durationForSound = Number.isFinite(soundDuration) && soundDuration > 0
        ? soundDuration
        : duration;
      canonicalSounds.push({
        ...deepCloneJson(sound),
        sceneIndex: unit.poolIndex,
        startTime: canonicalDurationOffset,
        endTime: canonicalDurationOffset + durationForSound,
        branchAssetKey: unit.assetKey,
        branchAudioAssetKey: unit.audioAssetKeys[soundIndex],
        branchSourceSceneIndex: unit.sourceSceneIndex,
      });
    });
    canonicalDurationOffset += duration;
  }

  return {
    narrativeType: 'branched',
    renderPlanVersion: BRANCHED_VIDEO_RENDER_PLAN_VERSION,
    cumulativeLayerDuration: canonicalDurationOffset,
    defaultBranchPathId: paths[0]?.pathId || null,
    branchingMeta: deepCloneJson(branchingMeta || calculatedBranchingMeta),
    canonicalMovieResourceList: {
      scenes: canonicalScenes,
      sounds: canonicalSounds,
    },
    canonicalUnits,
    branchRenderPaths: paths,
  };
}

/** Adds persisted layer/audio subdocument IDs to a render plan. */
export function materializeBranchedVideoSessionPaths(plan, {
  layers = [],
  audioLayers = [],
} = {}) {
  if (!plan || plan.renderPlanVersion !== BRANCHED_VIDEO_RENDER_PLAN_VERSION) {
    throw buildPlanError('A version 1 branched render plan is required.');
  }
  const layerByAssetKey = new Map();
  const sharedLayers = [];
  for (const layer of layers) {
    if (layer?.branchAssetKey) layerByAssetKey.set(layer.branchAssetKey, layer);
    else sharedLayers.push(layer);
  }
  const audioByAssetKey = new Map();
  const sharedAudioLayers = [];
  for (const audioLayer of audioLayers) {
    if (audioLayer?.branchAudioAssetKey) {
      audioByAssetKey.set(audioLayer.branchAudioAssetKey, audioLayer);
    } else {
      sharedAudioLayers.push(audioLayer);
    }
  }

  return plan.branchRenderPaths.map((sourcePath) => {
    const path = deepCloneJson(sourcePath);
    path.timeline = path.timeline.map((item) => {
      const layer = layerByAssetKey.get(item.assetKey);
      const layerId = getDocumentId(layer);
      if (!layerId) {
        throw buildPlanError(`No persisted layer exists for ${item.assetKey}.`);
      }
      return { ...item, layerId };
    });

    let duration = Number(path.duration) || 0;
    for (const layer of sharedLayers) {
      const layerId = getDocumentId(layer);
      const layerDuration = Number(layer?.duration);
      if (!layerId || !Number.isFinite(layerDuration) || layerDuration <= 0) continue;
      const sequenceIndex = path.timeline.length;
      path.timeline.push({
        assetKey: null,
        sequenceIndex,
        sceneIndex: null,
        layerId,
        duration: layerDuration,
        durationOffset: duration,
        startTime: duration,
        endTime: duration + layerDuration,
        frames: [],
        frameGenerationStatus: 'INIT',
        frameGenerationPending: false,
        frameGenerationError: null,
      });
      duration += layerDuration;
    }
    path.duration = duration;

    path.audioTimeline = path.audioTimeline.flatMap((item) => {
      const audioLayer = audioByAssetKey.get(item.assetKey);
      const audioLayerId = getDocumentId(audioLayer);
      if (!audioLayerId) return [];
      const connectedTimeline = path.timeline.find(
        (timelineItem) => timelineItem.assetKey === audioLayer?.branchAssetKey,
      );
      if (!connectedTimeline) {
        throw buildPlanError(`No path layer exists for audio asset ${item.assetKey}.`);
      }
      return [{
        ...item,
        audioLayerId,
        connectedLayerId: connectedTimeline.layerId,
        startTime: connectedTimeline.durationOffset,
        endTime: connectedTimeline.durationOffset + Number(item.duration),
      }];
    });
    for (const audioLayer of sharedAudioLayers) {
      const audioLayerId = getDocumentId(audioLayer);
      if (!audioLayerId || audioLayer?.generationType !== 'music') continue;
      path.audioTimeline.push({
        assetKey: null,
        audioLayerId,
        connectedLayerId: null,
        sceneIndex: null,
        duration: path.duration,
        startTime: 0,
        endTime: path.duration,
      });
    }
    return path;
  });
}

export const __testOnly__ = {
  comparePathIds,
  hashJson,
  normalizeSceneIndex,
  stableJsonValue,
};
