import { buildCompletedBranchingManifest } from '../api/StatusAPI.js';
import { INTERACTIVE_VIDEO_MANIFEST_SCHEMA } from '../../schema/InteractivePublication.js';

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');

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

const validateChoiceGraph = (choicePoints, videoPathIds) => {
  const branchPointIds = new Set();
  const referencedPathIds = new Set();

  choicePoints.forEach((choicePoint) => {
    const branchPointId = normalizeString(choicePoint?.branch_point_id);
    const switchAtSeconds = Number(choicePoint?.switch_at_seconds);
    if (!branchPointId || !Number.isFinite(switchAtSeconds) || switchAtSeconds < 0) {
      throw buildManifestError('Every interactive choice point needs an ID and media-relative time.');
    }
    if (branchPointIds.has(branchPointId)) {
      throw buildManifestError(`Duplicate interactive choice point ${branchPointId}.`);
    }
    branchPointIds.add(branchPointId);

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
  validateChoiceGraph(choicePoints, pathIds);

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
} = {}) {
  const completed = buildCompletedBranchingManifest(completedBranching || {});
  if (!completed) {
    throw buildManifestError('A completed branched video manifest is required for publication.');
  }

  const mediaByPathId = normalizePublicMediaEntries(publicMedia);
  const sourcePaths = Array.isArray(completed?.outputs?.paths) ? completed.outputs.paths : [];
  const defaultPathId = normalizeString(completed.default_path_id);
  const rootNodeId = normalizeString(completed?.tree?.root_node_id);
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
    if (!pathId || !media || !Number.isFinite(duration) || duration < 0) {
      throw buildManifestError(`Interactive video path ${pathId || '<unknown>'} is incomplete.`);
    }
    return {
      path_id: pathId,
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

  const choicePoints = Array.isArray(completed?.tree?.choice_points)
    ? completed.tree.choice_points
    : [];
  if (!choicePoints.length) {
    throw buildManifestError('The interactive video graph has no choice points.');
  }
  validateChoiceGraph(choicePoints, new Set(outputPaths.map((path) => path.path_id)));

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
