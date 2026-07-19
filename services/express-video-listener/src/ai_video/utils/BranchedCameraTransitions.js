function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeId(value) {
  if (value === null || value === undefined) return '';
  return normalizeString(value?.toString?.() || String(value));
}

function normalizeSequenceIndex(value, fallback) {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized >= 0 ? normalized : fallback;
}

function compareBranchPaths(left, right) {
  const leftOrdinal = Number(left?.ordinal);
  const rightOrdinal = Number(right?.ordinal);
  if (Number.isFinite(leftOrdinal) && Number.isFinite(rightOrdinal) && leftOrdinal !== rightOrdinal) {
    return leftOrdinal - rightOrdinal;
  }
  if (Number.isFinite(leftOrdinal) !== Number.isFinite(rightOrdinal)) {
    return Number.isFinite(leftOrdinal) ? -1 : 1;
  }
  return normalizeString(left?.pathId).localeCompare(normalizeString(right?.pathId));
}

function getOrderedPathTimeline(path = {}) {
  return (Array.isArray(path?.timeline) ? path.timeline : [])
    .filter((entry) => !(
      (entry?.assetKey === null || entry?.asset_key === null) &&
      entry?.sceneIndex === null
    ))
    .map((entry, arrayIndex) => ({
      layerId: normalizeId(entry?.layerId ?? entry?.layer_id),
      sequenceIndex: normalizeSequenceIndex(entry?.sequenceIndex, arrayIndex),
      arrayIndex,
    }))
    .filter((entry) => entry.layerId)
    .sort((left, right) => (
      left.sequenceIndex - right.sequenceIndex || left.arrayIndex - right.arrayIndex
    ));
}

function getFirstDivergenceSceneIndex(branchingMeta = {}, branchRenderPaths = []) {
  const configuredIndices = Array.isArray(branchingMeta?.branchSceneIndices)
    ? branchingMeta.branchSceneIndices
    : [];
  const branchPointIndices = Array.isArray(branchingMeta?.branchPoints)
    ? branchingMeta.branchPoints.map((branchPoint) => branchPoint?.divergenceSceneIndex)
    : [];
  const selectionTrailIndices = (Array.isArray(branchRenderPaths) ? branchRenderPaths : [])
    .flatMap((path) => Array.isArray(path?.selectionTrail) ? path.selectionTrail : [])
    .map((choice) => choice?.divergenceSceneIndex);

  const indices = [...configuredIndices, ...branchPointIndices, ...selectionTrailIndices]
    .map(Number)
    .filter((value) => Number.isInteger(value) && value >= 0)
    .sort((left, right) => left - right);
  return indices[0] ?? null;
}

function getCommonPrefixLength(pathTimelines) {
  if (pathTimelines.length === 0) return 0;
  const shortestLength = Math.min(...pathTimelines.map((path) => path.timeline.length));
  let prefixLength = 0;
  while (prefixLength < shortestLength) {
    const candidateLayerId = pathTimelines[0].timeline[prefixLength]?.layerId;
    if (!candidateLayerId || pathTimelines.some(
      (path) => path.timeline[prefixLength]?.layerId !== candidateLayerId,
    )) {
      break;
    }
    prefixLength += 1;
  }
  return prefixLength;
}

/**
 * Builds a breadth-first traversal over the saved leaf timelines. The common
 * prefix is kept separate so it can use the existing batched transition prompt.
 * Every node after the first divergence carries only its own path ancestry.
 */
export function buildBranchedCameraTransitionTraversal({
  layers = [],
  branchRenderPaths = [],
  branchingMeta = null,
} = {}) {
  const layerIndexById = new Map();
  for (let index = 0; index < layers.length; index += 1) {
    const layerId = normalizeId(layers[index]?._id ?? layers[index]?.id);
    if (layerId && !layerIndexById.has(layerId)) {
      layerIndexById.set(layerId, index);
    }
  }

  const pathTimelines = (Array.isArray(branchRenderPaths) ? branchRenderPaths : [])
    .filter((path) => normalizeString(path?.pathId))
    .sort(compareBranchPaths)
    .map((path) => ({
      pathId: normalizeString(path.pathId),
      timeline: getOrderedPathTimeline(path),
    }))
    .filter((path) => path.timeline.length > 0);

  if (pathTimelines.length === 0) {
    throw new Error('A branched camera-transition traversal requires at least one render path.');
  }

  for (const path of pathTimelines) {
    for (const entry of path.timeline) {
      if (!layerIndexById.has(entry.layerId)) {
        throw new Error(
          `Branch path ${path.pathId} references unknown layer ${entry.layerId}.`,
        );
      }
    }
  }

  const inferredCommonPrefixLength = getCommonPrefixLength(pathTimelines);
  const firstDivergenceSceneIndex = getFirstDivergenceSceneIndex(
    branchingMeta || {},
    branchRenderPaths,
  );
  const commonPrefixLength = firstDivergenceSceneIndex === null
    ? inferredCommonPrefixLength
    : firstDivergenceSceneIndex + 1;
  if (commonPrefixLength > inferredCommonPrefixLength) {
    throw new Error(
      'Branched camera-transition paths do not share the configured root scene prefix.',
    );
  }
  const rootLayerIds = pathTimelines[0].timeline
    .slice(0, commonPrefixLength)
    .map((entry) => entry.layerId);
  const levels = [];
  const plannedLayerIds = new Set(rootLayerIds);
  const maximumPathLength = Math.max(...pathTimelines.map((path) => path.timeline.length));

  for (let depth = commonPrefixLength; depth < maximumPathLength; depth += 1) {
    const nodesAtDepth = new Map();
    for (const path of pathTimelines) {
      const currentEntry = path.timeline[depth];
      if (!currentEntry || plannedLayerIds.has(currentEntry.layerId)) continue;

      if (!nodesAtDepth.has(currentEntry.layerId)) {
        nodesAtDepth.set(currentEntry.layerId, {
          layerId: currentEntry.layerId,
          layerIndex: layerIndexById.get(currentEntry.layerId),
          pathId: path.pathId,
          sequenceIndex: currentEntry.sequenceIndex,
          previousLayerIds: path.timeline.slice(0, depth).map((entry) => entry.layerId),
        });
      }
    }

    const level = [...nodesAtDepth.values()];
    if (level.length > 0) {
      levels.push(level);
      level.forEach((node) => plannedLayerIds.add(node.layerId));
    }
  }

  const unplannedLayerIds = layers.flatMap((layer) => {
    const layerId = normalizeId(layer?._id ?? layer?.id);
    return layerId && layer?.branchAssetKey && !plannedLayerIds.has(layerId) ? [layerId] : [];
  });
  if (unplannedLayerIds.length > 0) {
    throw new Error(
      `Branched camera-transition paths do not reference layers: ${unplannedLayerIds.join(', ')}.`,
    );
  }

  return {
    rootLayerIds,
    levels,
    layerIndexById,
  };
}

export function parseCameraTransitionLines(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeString).filter(Boolean);
  }
  return typeof value === 'string'
    ? value.split('\n').map(normalizeString).filter(Boolean)
    : [];
}

export function formatBranchedCameraTransitionContext({
  previousScenes = [],
  currentSceneDescription = '',
} = {}) {
  const history = previousScenes.length > 0
    ? previousScenes.map((scene, index) => [
      `Previous scene ${index + 1} description: ${normalizeString(scene?.description) || '(not available)'}`,
      `Previous scene ${index + 1} camera transition: ${normalizeString(scene?.cameraTransition) || '(not available)'}`,
    ].join('\n')).join('\n\n')
    : 'No previous scenes; this is the first scene in the current branch path.';

  return [
    'Previous scenes in the current branch path:',
    history,
    '',
    `Current scene description: ${normalizeString(currentSceneDescription) || '(not available)'}`,
  ].join('\n');
}

function getSavedTransition(layer = {}) {
  const transition = normalizeString(layer?.cameraTransition);
  const status = normalizeString(layer?.cameraTransitionGenerationStatus).toUpperCase();
  return transition && (!status || status === 'COMPLETED') ? transition : '';
}

function buildTransitionResult({
  layerId,
  transition,
  source,
  pathId = null,
  sequenceIndex = null,
}) {
  const normalizedTransition = normalizeString(transition);
  return {
    layerId,
    transition: normalizedTransition,
    status: normalizedTransition ? 'COMPLETED' : 'FAILED',
    error: normalizedTransition ? null : 'Camera transition inference returned an empty response.',
    source,
    pathId,
    sequenceIndex,
  };
}

function assertSuccessfulTransitionResults(results, stage) {
  const failedResults = results.filter((result) => result.status !== 'COMPLETED');
  if (failedResults.length === 0) return;

  const error = new Error(
    `Camera transition generation failed for ${stage}: ${failedResults
      .map((result) => result.layerId)
      .join(', ')}.`,
  );
  error.code = 'BRANCHED_CAMERA_TRANSITION_INFERENCE_FAILED';
  error.failedLayerIds = failedResults.map((result) => result.layerId);
  throw error;
}

/**
 * Resolves branched transitions with a persistence barrier between every tree
 * depth. Siblings may run concurrently, but descendants cannot start until all
 * results at the parent depth have been saved.
 */
export async function createBranchedCameraTransitions({
  layers = [],
  branchRenderPaths = [],
  branchingMeta = null,
  getLayerDescription,
  requestRootTransitions,
  requestSceneTransition,
  persistTransitions,
} = {}) {
  if (typeof getLayerDescription !== 'function' ||
      typeof requestRootTransitions !== 'function' ||
      typeof requestSceneTransition !== 'function' ||
      typeof persistTransitions !== 'function') {
    throw new TypeError('Branched camera-transition callbacks are required.');
  }

  const traversal = buildBranchedCameraTransitionTraversal({
    layers,
    branchRenderPaths,
    branchingMeta,
  });
  const layerById = new Map();
  const transitionByLayerId = new Map();
  let canReusePersistedDescendants = true;

  for (const layer of layers) {
    const layerId = normalizeId(layer?._id ?? layer?.id);
    if (layerId) layerById.set(layerId, layer);
  }

  const applyResults = (results) => {
    for (const result of results) {
      transitionByLayerId.set(result.layerId, result.transition);
    }
  };

  if (traversal.rootLayerIds.length > 0) {
    const savedRootResults = traversal.rootLayerIds.map((layerId) => {
      const transition = getSavedTransition(layerById.get(layerId));
      return transition
        ? buildTransitionResult({ layerId, transition, source: 'branched_root_batch' })
        : null;
    });

    if (savedRootResults.every(Boolean)) {
      applyResults(savedRootResults);
    } else {
      const rootDescriptions = traversal.rootLayerIds.map(
        (layerId) => getLayerDescription(layerById.get(layerId)),
      );
      const rootTransitionLines = parseCameraTransitionLines(
        await requestRootTransitions({
          layerIds: traversal.rootLayerIds,
          sceneDescriptions: rootDescriptions,
        }),
      );
      const hasCompleteRootResponse =
        rootTransitionLines.length === traversal.rootLayerIds.length;
      const rootResults = traversal.rootLayerIds.map((layerId, index) => (
        buildTransitionResult({
          layerId,
          // Do not positionally attach a partial response: a missing line would
          // shift every subsequent transition onto the wrong root scene.
          transition: hasCompleteRootResponse ? rootTransitionLines[index] : '',
          source: 'branched_root_batch',
        })
      ));
      await persistTransitions(rootResults);
      assertSuccessfulTransitionResults(rootResults, 'the shared root');
      applyResults(rootResults);
      canReusePersistedDescendants = false;
    }
  }

  for (const level of traversal.levels) {
    const levelResults = await Promise.all(level.map(async (node) => {
      const layer = layerById.get(node.layerId);
      const savedTransition = canReusePersistedDescendants
        ? getSavedTransition(layer)
        : '';
      if (savedTransition) {
        return {
          result: buildTransitionResult({
            layerId: node.layerId,
            transition: savedTransition,
            source: 'branched_scene',
            pathId: node.pathId,
            sequenceIndex: node.sequenceIndex,
          }),
          alreadyPersisted: true,
        };
      }

      const previousScenes = node.previousLayerIds.map((previousLayerId) => ({
        layerId: previousLayerId,
        description: getLayerDescription(layerById.get(previousLayerId)),
        cameraTransition: transitionByLayerId.get(previousLayerId) || '',
      }));
      const currentSceneDescription = getLayerDescription(layer);
      const transition = await requestSceneTransition({
        ...node,
        previousScenes,
        currentSceneDescription,
      });

      return {
        result: buildTransitionResult({
          layerId: node.layerId,
          transition,
          source: 'branched_scene',
          pathId: node.pathId,
          sequenceIndex: node.sequenceIndex,
        }),
        alreadyPersisted: false,
      };
    }));

    const resultsToPersist = levelResults
      .filter(({ alreadyPersisted }) => !alreadyPersisted)
      .map(({ result }) => result);
    if (resultsToPersist.length > 0) {
      await persistTransitions(resultsToPersist);
    }
    const resolvedLevelResults = levelResults.map(({ result }) => result);
    assertSuccessfulTransitionResults(resolvedLevelResults, 'a branch traversal level');
    applyResults(resolvedLevelResults);
    if (resultsToPersist.length > 0) {
      canReusePersistedDescendants = false;
    }
  }

  return transitionByLayerId;
}
