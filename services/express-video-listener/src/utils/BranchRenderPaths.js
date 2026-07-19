function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export const BRANCHED_VIDEO_STATUS_SCHEMA = 'branched_video_status.v1';

const BRANCH_FAILED_STATUSES = new Set(['FAILED', 'ERROR', 'TIMEOUT']);

function normalizeNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeBoolean(value) {
  return typeof value === 'boolean' ? value : null;
}

function normalizeStringList(values) {
  return Array.isArray(values)
    ? values.map((value) => normalizeString(value)).filter(Boolean)
    : [];
}

function compactObject(payload = {}) {
  return Object.entries(payload).reduce((result, [key, value]) => {
    if (value === undefined || value === null) {
      return result;
    }
    if (Array.isArray(value) && value.length === 0) {
      return result;
    }
    if (value instanceof Date) {
      result[key] = value;
      return result;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = compactObject(value);
      if (Object.keys(nested).length === 0) {
        return result;
      }
      result[key] = nested;
      return result;
    }
    result[key] = value;
    return result;
  }, {});
}

function normalizeBranchStageStatus(value) {
  const normalized = normalizeString(value).toUpperCase();
  if (normalized === 'COMPLETED') return 'COMPLETED';
  if (BRANCH_FAILED_STATUSES.has(normalized) || /FAIL|ERROR|TIMEOUT/.test(normalized)) {
    return 'FAILED';
  }
  if (normalized.includes('CANCEL')) return 'CANCELLED';
  if (normalized.includes('PAUS')) return 'PAUSED';
  if (!normalized || normalized === 'INIT' || normalized === 'INITIALIZED') return 'INIT';
  return 'PENDING';
}

function resolveBranchAssetUrl(value, apiServer = '') {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }
  if (
    /^https?:\/\//i.test(normalized)
    || /^data:/i.test(normalized)
    || /^blob:/i.test(normalized)
  ) {
    return normalized;
  }
  if (normalized.startsWith('//')) {
    return `https:${normalized}`;
  }

  const base = normalizeString(apiServer).replace(/\/+$/, '');
  return base ? `${base}/${normalized.replace(/^\/+/, '')}` : normalized;
}

function resolveBranchVideoUrls(path = {}, options = {}) {
  const remoteURL = resolveBranchAssetUrl(path?.remoteURL, options.apiServer);
  const videoLink = resolveBranchAssetUrl(path?.videoLink, options.apiServer);
  return {
    remoteURL,
    videoLink,
    resultUrl: remoteURL || videoLink || null,
  };
}

function normalizeBranchSelectionTrail(selectionTrail = []) {
  return (Array.isArray(selectionTrail) ? selectionTrail : []).map((choice) => compactObject({
    branch_point_id: normalizeString(choice?.branchPointId || choice?.branch_point_id) || null,
    node_id: normalizeString(choice?.nodeId || choice?.node_id || choice?.childNodeId) || null,
    parent_node_id: normalizeString(choice?.parentNodeId || choice?.parent_node_id) || null,
    level: normalizeNumber(choice?.level),
    child_index: normalizeNumber(choice?.childIndex ?? choice?.child_index),
    branch_ordinal: normalizeNumber(choice?.branchOrdinal ?? choice?.branch_ordinal),
    divergence_scene_index: normalizeNumber(
      choice?.divergenceSceneIndex ?? choice?.divergence_scene_index,
    ),
    switch_at_seconds: normalizeNumber(choice?.switchAtSeconds ?? choice?.switch_at_seconds),
    path_name: normalizeString(choice?.pathName || choice?.path_name) || null,
    path_description: normalizeString(choice?.pathDescription || choice?.path_description) || null,
  }));
}

export function isBranchedVideoSession(session = {}) {
  return normalizeString(session?.narrativeType).toLowerCase() === 'branched';
}

export function getBranchRenderPaths(session = {}) {
  if (!isBranchedVideoSession(session)) {
    return [];
  }

  return Array.isArray(session?.branchRenderPaths)
    ? session.branchRenderPaths.filter((path) => normalizeString(path?.pathId))
    : [];
}

export function getBranchTimeline(path = {}) {
  return Array.isArray(path?.timeline)
    ? path.timeline.filter((entry) => normalizeString(entry?.layerId?.toString?.() || entry?.layerId))
    : [];
}

export function hasCompletedBranchVideo(path = {}) {
  return normalizeString(path?.videoGenerationStatus).toUpperCase() === 'COMPLETED'
    && Boolean(normalizeString(path?.remoteURL) || normalizeString(path?.videoLink));
}

export function hasCompletedBranchFrames(path = {}) {
  const timeline = getBranchTimeline(path);
  if (timeline.length === 0) {
    return false;
  }

  return timeline.every((entry) => (
    normalizeString(entry?.frameGenerationStatus).toUpperCase() === 'COMPLETED'
    && Array.isArray(entry?.frames)
    && entry.frames.length > 0
  ));
}

export function allBranchFramesCompleted(session = {}) {
  const paths = getBranchRenderPaths(session);
  return paths.length > 0 && paths.every(hasCompletedBranchFrames);
}

export function getBranchFrameFailure(session = {}) {
  for (const path of getBranchRenderPaths(session)) {
    const failedEntry = getBranchTimeline(path).find((entry) => (
      normalizeString(entry?.frameGenerationStatus).toUpperCase() === 'FAILED'
      || normalizeString(entry?.frameGenerationError)
    ));
    if (failedEntry) {
      return {
        pathId: normalizeString(path.pathId),
        message: normalizeString(failedEntry.frameGenerationError)
          || normalizeString(path.frameGenerationError)
          || `Frame generation failed for branch path ${normalizeString(path.pathId)}.`,
      };
    }

    if (
      normalizeString(path?.frameGenerationStatus).toUpperCase() === 'FAILED'
      || normalizeString(path?.frameGenerationError)
    ) {
      return {
        pathId: normalizeString(path.pathId),
        message: normalizeString(path.frameGenerationError)
          || `Frame generation failed for branch path ${normalizeString(path.pathId)}.`,
      };
    }
  }

  return null;
}

export function allBranchVideosCompleted(session = {}) {
  const paths = getBranchRenderPaths(session);
  return paths.length > 0 && paths.every(hasCompletedBranchVideo);
}

export function getBranchRenderFailure(session = {}) {
  const failedPath = getBranchRenderPaths(session).find((path) => {
    const status = normalizeString(path?.videoGenerationStatus).toUpperCase();
    return status === 'FAILED' || normalizeString(path?.videoGenerationError);
  });

  if (!failedPath) {
    return null;
  }

  return {
    pathId: normalizeString(failedPath.pathId),
    message: normalizeString(failedPath.videoGenerationError)
      || `Video generation failed for branch path ${normalizeString(failedPath.pathId)}.`,
  };
}

function buildLegacyBranchResultsFromPaths(paths = []) {
  return (Array.isArray(paths) ? paths : []).map((path) => compactObject({
    path_id: path.path_id,
    leaf_node_id: path.leaf_node_id,
    ordinal: path.ordinal,
    status: path.status,
    result_url: path.result_url,
    video_link: path.video_link,
    remote_url: path.remote_url,
    duration: path.duration,
    selection_trail: path.selection_trail,
    error: path.error,
  }));
}

export function buildBranchResults(session = {}, options = {}) {
  const branching = buildBranchingStatusManifest(session, options);
  return branching ? buildLegacyBranchResultsFromPaths(branching.paths) : [];
}

export function getDefaultBranchResult(session = {}, options = {}) {
  const results = buildBranchResults(session, options);
  const defaultPathId = normalizeString(session?.defaultBranchPathId);
  return results.find((result) => result.path_id === defaultPathId) || results[0] || null;
}

function buildNormalizedBranchPath(path = {}, sourceOrdinal = 0, defaultPathId = null, options = {}) {
  const pathId = normalizeString(path?.pathId);
  const { remoteURL, videoLink, resultUrl } = resolveBranchVideoUrls(path, options);
  const frameStatus = normalizeBranchStageStatus(path?.frameGenerationStatus);
  const videoStatus = normalizeBranchStageStatus(path?.videoGenerationStatus);
  const videoComplete = hasCompletedBranchVideo(path) && Boolean(resultUrl);
  const failed = frameStatus === 'FAILED' || videoStatus === 'FAILED';
  const cancelled = frameStatus === 'CANCELLED' || videoStatus === 'CANCELLED';
  const pathStatus = failed
    ? 'FAILED'
    : cancelled
      ? 'CANCELLED'
      : videoComplete
        ? 'COMPLETED'
        : frameStatus === 'INIT' && videoStatus === 'INIT'
          ? 'INIT'
          : 'PENDING';

  return compactObject({
    path_id: pathId,
    leaf_node_id: normalizeString(path?.leafNodeId || pathId) || null,
    ordinal: Number.isInteger(path?.ordinal) ? path.ordinal : sourceOrdinal,
    is_default: Boolean(pathId && pathId === defaultPathId),
    node_ids: normalizeStringList(path?.nodeIds),
    duration: normalizeNumber(path?.duration),
    status: pathStatus,
    current_stage: ['COMPLETED', 'FAILED', 'CANCELLED'].includes(pathStatus)
      ? null
      : frameStatus === 'COMPLETED'
        ? 'video_generation'
        : 'frame_generation',
    stages: {
      frame_generation: frameStatus,
      video_generation: videoStatus,
    },
    stage_details: {
      frame_generation: {
        status: frameStatus,
        pending: normalizeBoolean(path?.frameGenerationPending),
        error: normalizeString(path?.frameGenerationError) || null,
      },
      video_generation: {
        status: videoStatus,
        pending: normalizeBoolean(path?.videoGenerationPending),
        completed_at: path?.videoGenerationCompletedAt || null,
        error: normalizeString(path?.videoGenerationError) || null,
      },
    },
    result_url: videoComplete ? resultUrl : null,
    video_link: videoComplete ? videoLink : null,
    remote_url: videoComplete ? remoteURL : null,
    selection_trail: normalizeBranchSelectionTrail(path?.selectionTrail),
    error: normalizeString(path?.videoGenerationError || path?.frameGenerationError) || null,
  });
}

function compareNormalizedBranchPaths(left = {}, right = {}) {
  const ordinalDifference = (normalizeNumber(left.ordinal) ?? Number.MAX_SAFE_INTEGER)
    - (normalizeNumber(right.ordinal) ?? Number.MAX_SAFE_INTEGER);
  if (ordinalDifference !== 0) {
    return ordinalDifference;
  }
  return normalizeString(left.path_id).localeCompare(normalizeString(right.path_id));
}

function buildNormalizedBranchChoicePoints(session = {}, paths = []) {
  const branchingMeta = session?.branchingMeta && typeof session.branchingMeta === 'object'
    ? session.branchingMeta
    : {};
  const configuredBranchPoints = Array.isArray(branchingMeta.branchPoints)
    ? branchingMeta.branchPoints
    : [];
  const allTrailEntries = paths.flatMap((path) => (
    (Array.isArray(path.selection_trail) ? path.selection_trail : [])
      .map((choice) => ({ ...choice, leaf_path_id: path.path_id }))
  ));

  const buildOptions = (branchPoint = {}, matchingTrailEntries = []) => {
    const configuredOptions = Array.isArray(branchPoint.divergencePaths)
      ? branchPoint.divergencePaths
      : [];
    const sourceOptions = configuredOptions.length
      ? configuredOptions
      : Array.from(new Map(
        matchingTrailEntries.map((choice) => [choice.node_id, choice]),
      ).values());

    return sourceOptions.map((option, optionIndex) => {
      const childNodeId = normalizeString(
        option?.childNodeId || option?.child_node_id || option?.node_id,
      );
      const matchingChoice = matchingTrailEntries.find((choice) => (
        choice.node_id === childNodeId
      )) || {};
      return compactObject({
        child_node_id: childNodeId || null,
        branch_ordinal: normalizeNumber(
          option?.branchOrdinal ?? option?.branch_ordinal ?? matchingChoice.branch_ordinal,
        ) ?? optionIndex + 1,
        path_name: normalizeString(
          option?.path_name || option?.pathName || matchingChoice.path_name,
        ) || null,
        path_description: normalizeString(
          option?.path_description || option?.pathDescription || matchingChoice.path_description,
        ) || null,
        leaf_path_ids: paths
          .filter((path) => path.selection_trail?.some((choice) => choice.node_id === childNodeId))
          .map((path) => path.path_id)
          .filter(Boolean),
      });
    });
  };

  if (configuredBranchPoints.length) {
    return configuredBranchPoints.map((branchPoint) => {
      const branchPointId = normalizeString(
        branchPoint?.branchPointId || branchPoint?.branch_point_id,
      );
      const parentNodeId = normalizeString(
        branchPoint?.parentNodeId || branchPoint?.parent_node_id,
      );
      const matchingTrailEntries = allTrailEntries.filter((choice) => (
        (branchPointId && choice.branch_point_id === branchPointId)
        || (!branchPointId && parentNodeId && choice.parent_node_id === parentNodeId)
      ));
      const timingChoice = matchingTrailEntries[0] || {};
      return compactObject({
        branch_point_id: branchPointId || null,
        parent_node_id: parentNodeId || null,
        level: normalizeNumber(branchPoint?.level ?? timingChoice.level),
        divergence_scene_index: normalizeNumber(
          branchPoint?.divergenceSceneIndex
          ?? branchPoint?.divergence_scene_index
          ?? timingChoice.divergence_scene_index,
        ),
        switch_at_seconds: normalizeNumber(timingChoice.switch_at_seconds),
        options: buildOptions(branchPoint, matchingTrailEntries),
      });
    });
  }

  const groupedTrailEntries = new Map();
  allTrailEntries.forEach((choice) => {
    const key = choice.branch_point_id || `${choice.parent_node_id || 'root'}:${choice.level || 0}`;
    const existing = groupedTrailEntries.get(key) || [];
    existing.push(choice);
    groupedTrailEntries.set(key, existing);
  });

  return Array.from(groupedTrailEntries.entries()).map(([branchPointId, choices]) => {
    const firstChoice = choices[0] || {};
    return compactObject({
      branch_point_id: branchPointId,
      parent_node_id: firstChoice.parent_node_id,
      level: firstChoice.level,
      divergence_scene_index: firstChoice.divergence_scene_index,
      switch_at_seconds: firstChoice.switch_at_seconds,
      options: buildOptions({}, choices),
    });
  });
}

/**
 * Builds the compact, provider-facing branch status contract. Path-local frame and
 * audio timelines intentionally remain out of this payload; clients can poll the
 * detailed processor status endpoint when they need those records.
 */
export function buildBranchingStatusManifest(session = {}, options = {}) {
  if (!isBranchedVideoSession(session) || !Array.isArray(session?.branchRenderPaths)) {
    return null;
  }

  const configuredDefaultPathId = normalizeString(session?.defaultBranchPathId);
  const paths = getBranchRenderPaths(session)
    .map((path, ordinal) => (
      buildNormalizedBranchPath(path, ordinal, configuredDefaultPathId, options)
    ))
    .sort(compareNormalizedBranchPaths);
  if (paths.length === 0) {
    return null;
  }

  const defaultPathId = paths.some((path) => path.path_id === configuredDefaultPathId)
    ? configuredDefaultPathId
    : paths[0]?.path_id || null;
  paths.forEach((path) => {
    path.is_default = path.path_id === defaultPathId;
  });

  const completedPaths = paths.filter((path) => path.status === 'COMPLETED');
  const failedPaths = paths.filter((path) => path.status === 'FAILED');
  const cancelledPaths = paths.filter((path) => path.status === 'CANCELLED');
  const frameCompletedPaths = paths.filter((path) => (
    path.status === 'COMPLETED' || path.stages?.frame_generation === 'COMPLETED'
  ));
  const allPathsComplete = completedPaths.length === paths.length;
  const allPathsInit = paths.every((path) => path.status === 'INIT');
  const renderUnitsCompleted = frameCompletedPaths.length + completedPaths.length;
  const renderUnitsTotal = paths.length * 2;
  const progressPercent = allPathsComplete
    ? 100
    : renderUnitsTotal > 0
      ? Math.round((renderUnitsCompleted / renderUnitsTotal) * 1000) / 10
      : 0;
  const expressStatus = normalizeBranchStageStatus(session?.expressGenerationStatus?.status);
  const aggregateStatus =
    session?.expressGenerationCancelled ||
    expressStatus === 'CANCELLED' ||
    cancelledPaths.length > 0
    ? 'CANCELLED'
    : session?.expressGenerationFailed || expressStatus === 'FAILED' || failedPaths.length > 0
      ? 'FAILED'
      : session?.expressGenerationPaused || expressStatus === 'PAUSED'
        ? 'PAUSED'
        : allPathsComplete
          ? 'COMPLETED'
          : expressStatus === 'INIT' && renderUnitsCompleted === 0 && allPathsInit
            ? 'INIT'
            : 'PENDING';
  const outputsReady = allPathsComplete && aggregateStatus === 'COMPLETED';
  const branchingMeta = session?.branchingMeta && typeof session.branchingMeta === 'object'
    ? session.branchingMeta
    : {};
  const choicePoints = buildNormalizedBranchChoicePoints(session, paths);
  const outputPaths = outputsReady
    ? paths.map((path) => compactObject({
      path_id: path.path_id,
      leaf_node_id: path.leaf_node_id,
      ordinal: path.ordinal,
      is_default: path.is_default,
      url: path.result_url,
      duration: path.duration,
      selection_trail: path.selection_trail,
    }))
    : [];
  const defaultOutput = outputPaths.find((path) => path.path_id === defaultPathId)
    || outputPaths[0];

  return compactObject({
    schema: BRANCHED_VIDEO_STATUS_SCHEMA,
    status: aggregateStatus,
    is_complete: allPathsComplete,
    finalized: session?.branchRenderCompletionFinalized === true,
    completed_at: session?.branchRenderCompletedAt || null,
    render_plan_version: normalizeNumber(session?.renderPlanVersion),
    default_path_id: defaultPathId,
    summary: {
      total_paths: paths.length,
      completed_paths: completedPaths.length,
      pending_paths: Math.max(
        0,
        paths.length - completedPaths.length - failedPaths.length - cancelledPaths.length,
      ),
      failed_paths: failedPaths.length,
      cancelled_paths: cancelledPaths.length,
      frame_paths_completed: frameCompletedPaths.length,
      video_paths_completed: completedPaths.length,
      progress_percent: progressPercent,
    },
    tree: {
      root_node_id: normalizeString(branchingMeta.rootNodeId) || null,
      num_levels: normalizeNumber(branchingMeta.numLevels),
      branching_factor: normalizeNumber(branchingMeta.branchingFactor),
      node_count: normalizeNumber(branchingMeta.nodeCount),
      leaf_node_ids: normalizeStringList(branchingMeta.leafNodeIds).length
        ? normalizeStringList(branchingMeta.leafNodeIds)
        : paths.map((path) => path.leaf_node_id).filter(Boolean),
      branch_scene_indices: (Array.isArray(branchingMeta.branchSceneIndices)
        ? branchingMeta.branchSceneIndices
        : []).map(normalizeNumber).filter((value) => value !== null),
      choice_points: choicePoints,
    },
    paths,
    outputs: {
      ready: outputsReady,
      default_path_id: defaultPathId,
      ...(outputsReady
        ? {
          default_url: defaultOutput?.url || null,
          paths: outputPaths,
        }
        : {}),
    },
  });
}

export function buildBranchDeliveryFields(session = {}, options = {}) {
  const branching = buildBranchingStatusManifest(session, options);
  if (!branching) {
    return null;
  }

  const branchResults = buildLegacyBranchResultsFromPaths(branching.paths);
  return {
    narrative_type: 'branched',
    default_path_id: branching.default_path_id,
    ...(branching.status === 'COMPLETED' && branching.outputs?.ready
      ? { result_urls: branching.outputs.paths.map((path) => path.url) }
      : {}),
    branch_results: branchResults,
    branching,
  };
}

export function isCompleteBranchDelivery(deliveryFields = null) {
  const branching = deliveryFields?.branching;
  return Boolean(
    branching?.status === 'COMPLETED'
    && branching?.is_complete === true
    && branching?.outputs?.ready === true
    && normalizeString(branching?.outputs?.default_url)
    && Array.isArray(branching?.outputs?.paths)
    && branching.outputs.paths.length === branching.summary?.total_paths
  );
}
