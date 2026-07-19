import { buildCompletedBranchingManifest } from '../api/StatusAPI.js';
import { INTERACTIVE_VIDEO_MANIFEST_SCHEMA } from '../../schema/InteractivePublication.js';

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeOptionalNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
};

const buildManifestError = (message) => {
  const error = new Error(message);
  error.code = 'INTERACTIVE_PUBLICATION_MANIFEST_INVALID';
  error.status = 409;
  error.statusCode = 409;
  return error;
};

export function isBranchedVideoSession(session = {}) {
  return [session?.narrativeType, session?.sourceNarrativeType]
    .some((value) => normalizeString(value).toLowerCase() === 'branched');
}

export function isInteractiveSessionReadyForPublication(session = {}) {
  if (!isBranchedVideoSession(session) || session?.branchRenderCompletionFinalized !== true) {
    return false;
  }

  const sourcePaths = Array.isArray(session?.branchRenderPaths) ? session.branchRenderPaths : [];
  return sourcePaths.length > 0 && sourcePaths.every((path) => {
    const status = normalizeString(path?.videoGenerationStatus).toUpperCase();
    const url = normalizeString(path?.remoteURL || path?.videoLink);
    return status === 'COMPLETED' && Boolean(url);
  });
}

export function assertInteractiveSessionReadyForPublication(session = {}, branching = null) {
  if (!isBranchedVideoSession(session)) {
    throw buildManifestError('Only branched video sessions can create an InteractivePublication.');
  }
  if (session?.branchRenderCompletionFinalized !== true) {
    throw buildManifestError('Interactive video rendering is not finalized yet.');
  }

  const compactManifest = buildCompletedBranchingManifest(branching || {});
  const sourcePaths = Array.isArray(session?.branchRenderPaths) ? session.branchRenderPaths : [];

  if (!compactManifest || !isInteractiveSessionReadyForPublication(session)) {
    throw buildManifestError('Every interactive video path must be complete before publication.');
  }
  if (compactManifest.outputs.paths.length !== sourcePaths.length) {
    throw buildManifestError('Interactive video output paths are incomplete.');
  }

  return compactManifest;
}

const normalizePublicMediaEntries = (publicMedia = []) => {
  const entries = Array.isArray(publicMedia) ? publicMedia : [];
  const mediaByPathId = new Map();

  entries.forEach((entry) => {
    const pathId = normalizeString(entry?.pathId || entry?.path_id);
    const contentUrl = normalizeString(entry?.contentUrl || entry?.videoUrl || entry?.url);
    const thumbnailUrl = normalizeString(entry?.thumbnailUrl);
    if (!pathId || !contentUrl || !thumbnailUrl) {
      throw buildManifestError(
        'Every interactive path must include a path ID, public video URL, and public thumbnail URL.',
      );
    }
    if (mediaByPathId.has(pathId)) {
      throw buildManifestError(`Duplicate public media exists for interactive path ${pathId}.`);
    }
    mediaByPathId.set(pathId, { contentUrl, thumbnailUrl });
  });

  return mediaByPathId;
};

const normalizeSelectionTrail = (selectionTrail = []) => (
  (Array.isArray(selectionTrail) ? selectionTrail : []).map((choice) => ({
    branch_point_id: normalizeString(choice?.branchPointId || choice?.branch_point_id),
    node_id: normalizeString(choice?.nodeId || choice?.node_id || choice?.childNodeId),
    parent_node_id: normalizeString(choice?.parentNodeId || choice?.parent_node_id) || null,
    level: normalizeOptionalNumber(choice?.level),
    branch_ordinal: normalizeOptionalNumber(choice?.branchOrdinal ?? choice?.branch_ordinal),
    divergence_scene_index: normalizeOptionalNumber(
      choice?.divergenceSceneIndex ?? choice?.divergence_scene_index,
    ),
    switch_at_seconds: normalizeOptionalNumber(
      choice?.switchAtSeconds ?? choice?.switch_at_seconds,
    ),
    path_name: normalizeString(choice?.pathName || choice?.path_name) || null,
    path_description: normalizeString(
      choice?.pathDescription || choice?.path_description,
    ) || null,
    branching_hint: normalizeString(
      choice?.branchingHint || choice?.branching_hint || choice?.pathName || choice?.path_name,
    ) || null,
    description: normalizeString(
      choice?.description || choice?.pathDescription || choice?.path_description,
    ) || null,
  }))
);

const normalizeBranchingTimelineChoicePoints = (branchingTimeline = {}) => {
  const sourceChoicePoints = Array.isArray(branchingTimeline?.choicePoints)
    ? branchingTimeline.choicePoints
    : Array.isArray(branchingTimeline?.choice_points)
      ? branchingTimeline.choice_points
      : [];
  return sourceChoicePoints.map((choicePoint) => ({
    branch_point_id: normalizeString(
      choicePoint?.branchPointId || choicePoint?.branch_point_id,
    ),
    parent_node_id: normalizeString(
      choicePoint?.parentNodeId || choicePoint?.parent_node_id,
    ) || null,
    level: normalizeOptionalNumber(choicePoint?.level),
    divergence_scene_index: normalizeOptionalNumber(
      choicePoint?.divergenceSceneIndex ?? choicePoint?.divergence_scene_index,
    ),
    switch_at_seconds: normalizeOptionalNumber(
      choicePoint?.switchAtSeconds ?? choicePoint?.switch_at_seconds,
    ),
    options: (Array.isArray(choicePoint?.options) ? choicePoint.options : []).map((option) => {
      const branchingHint = normalizeString(
        option?.branchingHint || option?.branching_hint || option?.pathName || option?.path_name,
      ) || null;
      const description = normalizeString(
        option?.description || option?.pathDescription || option?.path_description,
      ) || null;
      return {
        child_node_id: normalizeString(option?.childNodeId || option?.child_node_id),
        branch_ordinal: normalizeOptionalNumber(
          option?.branchOrdinal ?? option?.branch_ordinal,
        ),
        path_name: normalizeString(option?.pathName || option?.path_name) || branchingHint,
        path_description: normalizeString(
          option?.pathDescription || option?.path_description,
        ) || description,
        branching_hint: branchingHint,
        description,
        leaf_path_ids: (Array.isArray(option?.leafPathIds)
          ? option.leafPathIds
          : Array.isArray(option?.leaf_path_ids)
            ? option.leaf_path_ids
            : [])
          .map(normalizeString)
          .filter(Boolean),
      };
    }),
  }));
};

const normalizePathMetadataEntries = (pathMetadata = []) => {
  const entries = Array.isArray(pathMetadata)
    ? pathMetadata
    : pathMetadata instanceof Map
      ? [...pathMetadata.values()]
      : [];
  return new Map(entries.map((entry) => {
    const pathId = normalizeString(entry?.pathId || entry?.path_id);
    const normalizedSelectionTrail = normalizeSelectionTrail(
      entry?.selectionTrail || entry?.selection_trail,
    );
    const immediateSelection = normalizedSelectionTrail.at(-1) || {};
    return [pathId, {
      selection_trail: normalizedSelectionTrail,
      leaf_node_id: normalizeString(entry?.leafNodeId || entry?.leaf_node_id) || null,
      ordinal: normalizeOptionalNumber(entry?.ordinal),
      branch_point_id: normalizeString(
        entry?.branchPointId || entry?.branch_point_id || immediateSelection.branch_point_id,
      ) || null,
      divergence_scene_index: normalizeOptionalNumber(
        entry?.divergenceSceneIndex ??
        entry?.divergence_scene_index ??
        immediateSelection.divergence_scene_index,
      ),
      switch_at_seconds: normalizeOptionalNumber(
        entry?.switchAtSeconds ??
        entry?.switch_at_seconds ??
        immediateSelection.switch_at_seconds,
      ),
      branching_hint: normalizeString(
        entry?.branchingHint || entry?.branching_hint || immediateSelection.branching_hint ||
        immediateSelection.path_name,
      ) || null,
      description: normalizeString(
        entry?.branchingDescription || entry?.description || entry?.branching_description ||
        immediateSelection.description || immediateSelection.path_description,
      ) || null,
    }];
  }).filter(([pathId]) => pathId));
};

const buildChoicePointsFromPathMetadata = (pathMetadata = []) => {
  const entries = Array.isArray(pathMetadata)
    ? pathMetadata
    : pathMetadata instanceof Map
      ? [...pathMetadata.values()]
      : [];
  if (!entries.length) return [];

  const normalizedEntries = entries.map((entry) => ({
    pathId: normalizeString(entry?.pathId || entry?.path_id),
    selectionTrail: normalizeSelectionTrail(entry?.selectionTrail || entry?.selection_trail),
  })).filter(({ pathId }) => pathId);
  const pathsWithTrail = normalizedEntries.filter(({ selectionTrail }) => selectionTrail.length > 0);
  if (!pathsWithTrail.length) return [];
  if (pathsWithTrail.length !== normalizedEntries.length) {
    throw buildManifestError('Branch selection metadata is incomplete for one or more rendered paths.');
  }

  const pointGroups = new Map();
  for (const { pathId, selectionTrail } of pathsWithTrail) {
    for (const choice of selectionTrail) {
      const branchPointId = normalizeString(choice.branch_point_id);
      const childNodeId = normalizeString(choice.node_id);
      const parentNodeId = normalizeString(choice.parent_node_id);
      if (!branchPointId || !childNodeId || !parentNodeId) {
        throw buildManifestError('Branch selection metadata is missing a branch, parent, or child ID.');
      }

      let point = pointGroups.get(branchPointId);
      if (!point) {
        point = {
          branch_point_id: branchPointId,
          parent_node_id: parentNodeId,
          level: choice.level,
          divergence_scene_index: choice.divergence_scene_index,
          switch_at_seconds: choice.switch_at_seconds,
          optionsByChildId: new Map(),
        };
        pointGroups.set(branchPointId, point);
      } else if (
        point.parent_node_id !== parentNodeId ||
        point.level !== choice.level ||
        point.divergence_scene_index !== choice.divergence_scene_index ||
        point.switch_at_seconds !== choice.switch_at_seconds
      ) {
        throw buildManifestError(`Branch selection timing conflicts at ${branchPointId}.`);
      }

      let option = point.optionsByChildId.get(childNodeId);
      if (!option) {
        option = {
          child_node_id: childNodeId,
          branch_ordinal: choice.branch_ordinal,
          path_name: choice.path_name,
          path_description: choice.path_description,
          branching_hint: choice.branching_hint,
          description: choice.description,
          leafPathIds: new Set(),
        };
        point.optionsByChildId.set(childNodeId, option);
      }
      option.leafPathIds.add(pathId);
    }
  }

  return [...pointGroups.values()]
    .sort((left, right) => (
      (left.level ?? Number.MAX_SAFE_INTEGER) - (right.level ?? Number.MAX_SAFE_INTEGER) ||
      left.switch_at_seconds - right.switch_at_seconds ||
      left.branch_point_id.localeCompare(right.branch_point_id, undefined, { numeric: true })
    ))
    .map(({ optionsByChildId, ...point }) => ({
      ...point,
      options: [...optionsByChildId.values()]
        .sort((left, right) => (
          (left.branch_ordinal ?? Number.MAX_SAFE_INTEGER) -
            (right.branch_ordinal ?? Number.MAX_SAFE_INTEGER) ||
          left.child_node_id.localeCompare(right.child_node_id, undefined, { numeric: true })
        ))
        .map(({ leafPathIds, ...option }) => ({
          ...option,
          leaf_path_ids: [...leafPathIds].sort((left, right) => (
            left.localeCompare(right, undefined, { numeric: true })
          )),
        })),
    }));
};

const buildChoiceGraphSignature = (choicePoints = []) => (
  (Array.isArray(choicePoints) ? choicePoints : [])
    .map((point) => ({
      branch_point_id: normalizeString(point?.branch_point_id),
      parent_node_id: normalizeString(point?.parent_node_id),
      switch_at_seconds: normalizeOptionalNumber(point?.switch_at_seconds),
      options: (Array.isArray(point?.options) ? point.options : [])
        .map((option) => ({
          child_node_id: normalizeString(option?.child_node_id),
          leaf_path_ids: (Array.isArray(option?.leaf_path_ids) ? option.leaf_path_ids : [])
            .map(normalizeString)
            .filter(Boolean)
            .sort((left, right) => left.localeCompare(right, undefined, { numeric: true })),
        }))
        .sort((left, right) => left.child_node_id.localeCompare(
          right.child_node_id,
          undefined,
          { numeric: true },
        )),
    }))
    .sort((left, right) => left.branch_point_id.localeCompare(
      right.branch_point_id,
      undefined,
      { numeric: true },
    ))
);

const assertChoiceGraphsMatch = (candidate, expected, label) => {
  if (
    JSON.stringify(buildChoiceGraphSignature(candidate)) !==
    JSON.stringify(buildChoiceGraphSignature(expected))
  ) {
    throw buildManifestError(`${label} does not match the rendered branch-path topology.`);
  }
};

const validateChoiceGraph = (choicePoints, videoPaths, rootNodeId) => {
  const videoPathDurations = videoPaths instanceof Map
    ? videoPaths
    : new Map([...videoPaths].map((pathId) => [pathId, Number.POSITIVE_INFINITY]));
  const videoPathIds = new Set(videoPathDurations.keys());
  const branchPointIds = new Set();
  const referencedPathIds = new Set();
  const pointByParentNodeId = new Map();

  choicePoints.forEach((choicePoint) => {
    const branchPointId = normalizeString(choicePoint?.branch_point_id);
    const parentNodeId = normalizeString(choicePoint?.parent_node_id);
    const switchAtSeconds = Number(choicePoint?.switch_at_seconds);
    if (
      !branchPointId ||
      !parentNodeId ||
      !Number.isFinite(switchAtSeconds) ||
      switchAtSeconds < 0
    ) {
      throw buildManifestError(
        'Every interactive choice point needs an ID, parent node, and media-relative time.',
      );
    }
    if (branchPointIds.has(branchPointId)) {
      throw buildManifestError(`Duplicate interactive choice point ${branchPointId}.`);
    }
    if (pointByParentNodeId.has(parentNodeId)) {
      throw buildManifestError(`Interactive node ${parentNodeId} has more than one choice point.`);
    }
    branchPointIds.add(branchPointId);
    pointByParentNodeId.set(parentNodeId, choicePoint);

    const options = Array.isArray(choicePoint?.options) ? choicePoint.options : [];
    if (!options.length) {
      throw buildManifestError(`Interactive choice point ${branchPointId} has no options.`);
    }
    const childNodeIds = new Set();
    options.forEach((option) => {
      const childNodeId = normalizeString(option?.child_node_id);
      const leafPathIds = Array.isArray(option?.leaf_path_ids)
        ? option.leaf_path_ids.map(normalizeString).filter(Boolean)
        : [];
      if (!childNodeId || !leafPathIds.length) {
        throw buildManifestError(
          `Every option at interactive choice point ${branchPointId} must target a rendered path.`,
        );
      }
      if (childNodeIds.has(childNodeId)) {
        throw buildManifestError(
          `Interactive choice point ${branchPointId} has duplicate option ${childNodeId}.`,
        );
      }
      childNodeIds.add(childNodeId);
      if (childNodeId === parentNodeId) {
        throw buildManifestError(`Interactive choice point ${branchPointId} contains a cycle.`);
      }
      if (new Set(leafPathIds).size !== leafPathIds.length) {
        throw buildManifestError(
          `Interactive option ${childNodeId} contains duplicate rendered paths.`,
        );
      }
      const missingPathId = leafPathIds.find((pathId) => !videoPathIds.has(pathId));
      if (missingPathId) {
        throw buildManifestError(
          `Interactive choice point ${branchPointId} references missing path ${missingPathId}.`,
        );
      }
      const pathEndingBeforeSwitch = leafPathIds.find((pathId) => {
        const duration = Number(videoPathDurations.get(pathId));
        return Number.isFinite(duration) && switchAtSeconds >= duration;
      });
      if (pathEndingBeforeSwitch) {
        throw buildManifestError(
          `Interactive choice point ${branchPointId} occurs outside path ${pathEndingBeforeSwitch}.`,
        );
      }
      leafPathIds.forEach((pathId) => referencedPathIds.add(pathId));
    });
  });

  const unreferencedPathId = [...videoPathIds]
    .find((pathId) => !referencedPathIds.has(pathId));
  if (unreferencedPathId) {
    throw buildManifestError(
      `Interactive video path ${unreferencedPathId} is not reachable from the choice graph.`,
    );
  }

  const visitedBranchPointIds = new Set();
  const visitNode = (nodeId, expectedLeafPathIds, previousSwitchAtSeconds = -1) => {
    const choicePoint = pointByParentNodeId.get(nodeId);
    if (!choicePoint) {
      if (expectedLeafPathIds.size !== 1 || !expectedLeafPathIds.has(nodeId)) {
        throw buildManifestError(`Interactive branch node ${nodeId} terminates without a rendered path.`);
      }
      return;
    }

    const branchPointId = normalizeString(choicePoint.branch_point_id);
    if (visitedBranchPointIds.has(branchPointId)) {
      throw buildManifestError(`Interactive choice graph contains a cycle at ${branchPointId}.`);
    }
    const switchAtSeconds = Number(choicePoint.switch_at_seconds);
    if (switchAtSeconds < previousSwitchAtSeconds) {
      throw buildManifestError(`Interactive choice point ${branchPointId} precedes its parent choice.`);
    }
    visitedBranchPointIds.add(branchPointId);

    const assignedLeafPathIds = new Set();
    for (const option of choicePoint.options) {
      const optionLeafPathIds = new Set(
        option.leaf_path_ids.map(normalizeString).filter(Boolean),
      );
      for (const pathId of optionLeafPathIds) {
        if (!expectedLeafPathIds.has(pathId)) {
          throw buildManifestError(
            `Interactive option ${option.child_node_id} escapes its parent branch.`,
          );
        }
        if (assignedLeafPathIds.has(pathId)) {
          throw buildManifestError(
            `Interactive path ${pathId} is assigned to multiple sibling options.`,
          );
        }
        assignedLeafPathIds.add(pathId);
      }
      visitNode(
        normalizeString(option.child_node_id),
        optionLeafPathIds,
        switchAtSeconds,
      );
    }

    if (
      assignedLeafPathIds.size !== expectedLeafPathIds.size ||
      [...expectedLeafPathIds].some((pathId) => !assignedLeafPathIds.has(pathId))
    ) {
      throw buildManifestError(`Interactive choice point ${branchPointId} does not partition its paths.`);
    }
  };

  visitNode(normalizeString(rootNodeId), videoPathIds);
  if (visitedBranchPointIds.size !== branchPointIds.size) {
    throw buildManifestError('Interactive choice graph contains an orphaned choice point.');
  }
};

/**
 * Performs a full structural validation of a stored or serialized public
 * manifest. This is shared by publication creation and the unauthenticated
 * reads so malformed graph data can never be advertised as renderable.
 */
export function assertInteractivePublicationManifestRenderable(manifest = {}) {
  const source = manifest?.toObject?.() || manifest || {};
  const schemaVersion = normalizeString(source.schemaVersion || source.schema);
  if (schemaVersion !== INTERACTIVE_VIDEO_MANIFEST_SCHEMA) {
    throw buildManifestError('The interactive publication manifest schema is unsupported.');
  }
  if (source?.timing?.origin !== 'media' || source?.timing?.unit !== 'seconds') {
    throw buildManifestError('Interactive publication timing must use media-relative seconds.');
  }

  const defaultPathId = normalizeString(source.default_path_id);
  const rootNodeId = normalizeString(source?.tree?.root_node_id);
  const paths = Array.isArray(source?.outputs?.paths) ? source.outputs.paths : [];
  if (!defaultPathId || !rootNodeId || !paths.length) {
    throw buildManifestError('The interactive publication manifest is missing required identifiers.');
  }

  const pathIds = new Set();
  const pathDurations = new Map();
  let defaultPathCount = 0;
  paths.forEach((path) => {
    const pathId = normalizeString(path?.path_id);
    const contentUrl = normalizeString(path?.contentUrl);
    const thumbnailUrl = normalizeString(path?.thumbnailUrl);
    const duration = Number(path?.duration);
    if (
      !pathId ||
      !contentUrl ||
      !thumbnailUrl ||
      path?.encodingFormat !== 'video/mp4' ||
      !Number.isFinite(duration) ||
      duration < 0 ||
      typeof path?.is_default !== 'boolean'
    ) {
      throw buildManifestError(`Interactive video path ${pathId || '<unknown>'} is incomplete.`);
    }
    if (pathIds.has(pathId)) {
      throw buildManifestError(`Duplicate interactive video path ${pathId}.`);
    }
    pathIds.add(pathId);
    pathDurations.set(pathId, duration);
    if (path.is_default === true) {
      defaultPathCount += 1;
      if (pathId !== defaultPathId) {
        throw buildManifestError('The default path marker does not match default_path_id.');
      }
    }
  });

  if (!pathIds.has(defaultPathId) || defaultPathCount !== 1) {
    throw buildManifestError('The interactive publication must contain exactly one default path.');
  }

  const choicePoints = Array.isArray(source?.tree?.choice_points)
    ? source.tree.choice_points
    : [];
  if (!choicePoints.length) {
    throw buildManifestError('The interactive video graph has no choice points.');
  }
  validateChoiceGraph(choicePoints, pathDurations, rootNodeId);

  return source;
}

/**
 * Maps the compact completed status graph to an immutable publication manifest.
 * Branch graph keys intentionally remain status-compatible. Only media resource
 * fields use the Schema.org names clients already understand.
 */
export function buildInteractivePublicationManifest({
  completedBranching,
  publicMedia,
  pathMetadata = [],
  branchingTimeline = null,
} = {}) {
  const completed = buildCompletedBranchingManifest(completedBranching || {});
  if (!completed) {
    throw buildManifestError('A completed branched video manifest is required for publication.');
  }

  const mediaByPathId = normalizePublicMediaEntries(publicMedia);
  const metadataByPathId = normalizePathMetadataEntries(pathMetadata);
  const pathMetadataChoicePoints = buildChoicePointsFromPathMetadata(pathMetadata);
  const sourcePaths = Array.isArray(completed?.outputs?.paths) ? completed.outputs.paths : [];
  const defaultPathId = normalizeString(completed.default_path_id);
  const timelineDefaultPathId = normalizeString(
    branchingTimeline?.defaultPathId || branchingTimeline?.default_path_id,
  );
  if (timelineDefaultPathId && timelineDefaultPathId !== defaultPathId) {
    throw buildManifestError('Branching timing metadata does not match the default rendered path.');
  }
  if (
    branchingTimeline?.timing &&
    (
      branchingTimeline.timing.origin !== 'media' ||
      branchingTimeline.timing.unit !== 'seconds'
    )
  ) {
    throw buildManifestError('Branching timing metadata must use media-relative seconds.');
  }
  const timelineRootNodeId = normalizeString(
    branchingTimeline?.rootNodeId || branchingTimeline?.root_node_id,
  );
  const rootNodeId = timelineRootNodeId || normalizeString(completed?.tree?.root_node_id);
  if (!defaultPathId || !rootNodeId || !sourcePaths.length) {
    throw buildManifestError('The completed interactive video graph is missing required identifiers.');
  }
  if (mediaByPathId.size !== sourcePaths.length) {
    throw buildManifestError('Public media must be available for every interactive video path.');
  }

  const outputPaths = sourcePaths.map((path) => {
    const pathId = normalizeString(path?.path_id);
    const duration = Number(path?.duration);
    const media = mediaByPathId.get(pathId);
    const metadata = metadataByPathId.get(pathId) || {
      leaf_node_id: normalizeString(path?.leaf_node_id) || null,
      ordinal: normalizeOptionalNumber(path?.ordinal),
      branch_point_id: normalizeString(path?.branch_point_id) || null,
      divergence_scene_index: normalizeOptionalNumber(path?.divergence_scene_index),
      switch_at_seconds: normalizeOptionalNumber(path?.switch_at_seconds),
      branching_hint: normalizeString(path?.branching_hint) || null,
      description: normalizeString(path?.description || path?.branching_description) || null,
    };
    if (!pathId || !media || !Number.isFinite(duration) || duration < 0) {
      throw buildManifestError(`Interactive video path ${pathId || '<unknown>'} is incomplete.`);
    }
    return {
      path_id: pathId,
      ...(metadata.leaf_node_id ? { leaf_node_id: metadata.leaf_node_id } : {}),
      ...(metadata.ordinal !== null ? { ordinal: metadata.ordinal } : {}),
      ...(metadata.branch_point_id ? { branch_point_id: metadata.branch_point_id } : {}),
      ...(metadata.divergence_scene_index !== null
        ? { divergence_scene_index: metadata.divergence_scene_index }
        : {}),
      ...(metadata.switch_at_seconds !== null
        ? { switch_at_seconds: metadata.switch_at_seconds }
        : {}),
      ...(metadata.branching_hint ? { branching_hint: metadata.branching_hint } : {}),
      ...(metadata.description ? { description: metadata.description } : {}),
      contentUrl: media.contentUrl,
      thumbnailUrl: media.thumbnailUrl,
      encodingFormat: 'video/mp4',
      duration,
      is_default: pathId === defaultPathId,
    };
  });

  if (!outputPaths.some((path) => path.is_default)) {
    throw buildManifestError('The default interactive video path is missing from public media.');
  }

  const timelineChoicePoints = normalizeBranchingTimelineChoicePoints(branchingTimeline || {});
  const completedChoicePoints = Array.isArray(completed?.tree?.choice_points)
    ? completed.tree.choice_points
    : [];
  if (pathMetadataChoicePoints.length) {
    if (timelineChoicePoints.length) {
      assertChoiceGraphsMatch(
        timelineChoicePoints,
        pathMetadataChoicePoints,
        'Persisted branching timing metadata',
      );
    }
    if (completedChoicePoints.length) {
      assertChoiceGraphsMatch(
        completedChoicePoints,
        pathMetadataChoicePoints,
        'Completed branching output',
      );
    }
  }
  const choicePoints = timelineChoicePoints.length
    ? timelineChoicePoints
    : pathMetadataChoicePoints.length
      ? pathMetadataChoicePoints
      : completedChoicePoints;
  if (!choicePoints.length) {
    throw buildManifestError('The interactive video graph has no choice points.');
  }
  validateChoiceGraph(
    choicePoints,
    new Map(outputPaths.map((path) => [path.path_id, path.duration])),
    rootNodeId,
  );

  const manifest = {
    schemaVersion: INTERACTIVE_VIDEO_MANIFEST_SCHEMA,
    default_path_id: defaultPathId,
    timing: {
      origin: 'media',
      unit: 'seconds',
    },
    tree: {
      root_node_id: rootNodeId,
      choice_points: choicePoints,
    },
    outputs: {
      paths: outputPaths,
    },
  };
  assertInteractivePublicationManifestRenderable(manifest);
  return manifest;
}

export function serializeInteractivePublicationManifest(manifest = {}) {
  const source = manifest?.toObject?.() || manifest || {};
  return {
    schema: source.schemaVersion || INTERACTIVE_VIDEO_MANIFEST_SCHEMA,
    default_path_id: source.default_path_id,
    timing: source.timing || { origin: 'media', unit: 'seconds' },
    tree: source.tree || { root_node_id: null, choice_points: [] },
    outputs: source.outputs || { paths: [] },
  };
}
