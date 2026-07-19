import { isDeepStrictEqual } from 'node:util';

import {
  generateBranchMovieResourceList as defaultGenerateBranchMovieResourceList,
  generateDivergencePaths as defaultGenerateDivergencePaths,
} from './BranchingNarrativeAgent.js';
import { validateTextToVideoNarrative as defaultValidateTextToVideoNarrative } from '../utils/TranscriptUtils.js';

export const BRANCHING_NARRATIVE_SCHEMA_VERSION = 1;
export const BRANCHING_FACTOR = 2;
export const BRANCHING_ROOT_NODE_ID = 'root';
export const MAX_BRANCHING_LEVELS = 3;
export const BRANCHED_MOVIE_RESOURCE_LIST_STRUCTURE_TYPE = 'branched';

function buildBranchingError(message, code, status = 502, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.statusCode = status;
  Object.assign(error, details);
  return error;
}

function deepCloneJson(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseSceneIndex(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function getResourceList(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value.movieResourceList && typeof value.movieResourceList === 'object'
    ? value.movieResourceList
    : value;
  if (!Array.isArray(candidate.scenes)) return null;
  return {
    scenes: candidate.scenes,
    sounds: Array.isArray(candidate.sounds) ? candidate.sounds : [],
  };
}

function getNodeResourceList(node) {
  return getResourceList(node);
}

function getPrefixSounds(sounds, divergenceSceneIndex) {
  return sounds.filter((sound) => {
    const sceneIndex = parseSceneIndex(sound?.sceneIndex);
    return sceneIndex !== null && sceneIndex <= divergenceSceneIndex;
  });
}

function getPrefixErrors(parentMovieResourceList, childMovieResourceList, divergenceSceneIndex) {
  const errors = [];
  const parent = getResourceList(parentMovieResourceList);
  const child = getResourceList(childMovieResourceList);
  if (!parent || !child) return ['Parent and child must each include a scenes array.'];

  if (child.scenes.length !== parent.scenes.length) {
    errors.push(
      `Child has ${child.scenes.length} scenes; parent has ${parent.scenes.length}.`,
    );
  }

  const sharedSceneCount = Math.min(child.scenes.length, parent.scenes.length);
  for (let sceneIndex = 0; sceneIndex < sharedSceneCount; sceneIndex += 1) {
    for (const field of ['startTime', 'duration', 'endTime']) {
      if (Number(child.scenes[sceneIndex]?.[field]) !==
        Number(parent.scenes[sceneIndex]?.[field])) {
        errors.push(
          `Scene ${sceneIndex} must retain parent ${field}=${parent.scenes[sceneIndex]?.[field]}.`,
        );
      }
    }
  }

  if (!isDeepStrictEqual(
    child.scenes.slice(0, divergenceSceneIndex + 1),
    parent.scenes.slice(0, divergenceSceneIndex + 1),
  )) {
    errors.push(
      `Scenes through index ${divergenceSceneIndex} must be an exact clone of the parent.`,
    );
  }

  if (!isDeepStrictEqual(
    getPrefixSounds(child.sounds, divergenceSceneIndex),
    getPrefixSounds(parent.sounds, divergenceSceneIndex),
  )) {
    errors.push(
      `Sounds through scene index ${divergenceSceneIndex} must be an exact clone of the parent.`,
    );
  }

  return errors;
}

function assertStrictParentPrefix(parent, child, divergenceSceneIndex, childNodeId) {
  const errors = getPrefixErrors(parent, child, divergenceSceneIndex);
  if (errors.length === 0) return;
  throw buildBranchingError(
    `Generated branch ${childNodeId} did not preserve its parent prefix: ${errors.join(' ')}`,
    'BRANCH_PREFIX_MISMATCH',
    502,
    { validationErrors: errors, childNodeId, divergenceSceneIndex },
  );
}

function normalizeDivergencePath(path, index) {
  const pathName = normalizeString(path?.path_name ?? path?.pathName);
  const pathDescription = normalizeString(path?.path_description ?? path?.pathDescription);
  if (!pathName || !pathDescription) {
    throw buildBranchingError(
      `Divergence path ${index} must include non-empty path_name and path_description.`,
      'BRANCH_DIVERGENCE_PATHS_INVALID',
      502,
    );
  }
  return {
    path_name: pathName,
    path_description: pathDescription,
  };
}

function normalizeDivergencePaths(paths) {
  if (!Array.isArray(paths) || paths.length !== BRANCHING_FACTOR) {
    throw buildBranchingError(
      `Divergence inference must return exactly ${BRANCHING_FACTOR} paths.`,
      'BRANCH_DIVERGENCE_PATHS_INVALID',
      502,
    );
  }
  const normalized = paths.map(normalizeDivergencePath);
  if (normalized[0].path_name.toLowerCase() === normalized[1].path_name.toLowerCase()) {
    throw buildBranchingError(
      'Divergence paths must have distinct path_name values.',
      'BRANCH_DIVERGENCE_PATHS_INVALID',
      502,
    );
  }
  return normalized;
}

function getDurationFromScenes(scenes) {
  return scenes.reduce((total, scene) => {
    const duration = Number(scene?.duration);
    return total + (Number.isFinite(duration) && duration > 0 ? duration : 0);
  }, 0);
}

function normalizeValidationResult(result, fallbackResourceList) {
  if (result === true) {
    return { valid: true, errors: [], narrativeJson: fallbackResourceList };
  }
  if (!result || typeof result !== 'object') {
    return {
      valid: false,
      errors: ['Movie resource validation did not return a validation result.'],
      narrativeJson: fallbackResourceList,
    };
  }
  return {
    ...result,
    valid: result.valid === true,
    errors: Array.isArray(result.errors) ? result.errors : [],
    narrativeJson: getResourceList(result.narrativeJson) || fallbackResourceList,
  };
}

async function validateGeneratedResourceList({
  movieResourceList,
  validateTextToVideoNarrative,
  videoGenerationModel,
  requestedDuration,
  errorCode,
  nodeId,
  errorStatus = 502,
}) {
  const resourceList = getResourceList(movieResourceList);
  if (!resourceList) {
    throw buildBranchingError(
      `Movie resource list for node ${nodeId} must include a scenes array.`,
      errorCode,
      errorStatus,
      { nodeId, validationErrors: ['Missing or invalid `scenes` array.'] },
    );
  }
  const result = normalizeValidationResult(
    await validateTextToVideoNarrative(
      resourceList,
      videoGenerationModel,
      undefined,
      { requestedDuration },
    ),
    resourceList,
  );
  if (!result.valid) {
    throw buildBranchingError(
      `Movie resource list validation failed for node ${nodeId}: ${result.errors.join(', ')}`,
      errorCode,
      errorStatus,
      { nodeId, validationErrors: result.errors },
    );
  }
  return deepCloneJson(result.narrativeJson);
}

export function calculateBranchSceneIndices(
  sceneCount,
  numLevels,
  { maxLevels = MAX_BRANCHING_LEVELS } = {},
) {
  if (!Number.isInteger(sceneCount) || sceneCount < 2) {
    throw buildBranchingError(
      'A branching narrative requires at least two scenes.',
      'BRANCH_SOURCE_SCENES_INVALID',
      400,
    );
  }
  if (!Number.isInteger(numLevels) || numLevels < 1 || numLevels > maxLevels) {
    throw buildBranchingError(
      `num_levels must be an integer from 1 through ${maxLevels}.`,
      'INVALID_BRANCHING_LEVELS',
      400,
    );
  }
  if (numLevels >= sceneCount) {
    throw buildBranchingError(
      `num_levels must be less than the source scene count (${sceneCount}).`,
      'INVALID_BRANCHING_LEVELS',
      400,
    );
  }

  const indices = [];
  for (let level = 1; level <= numLevels; level += 1) {
    const oneBasedSceneNumber = Math.round((level * sceneCount) / (numLevels + 1));
    const sceneIndex = Math.min(sceneCount - 2, Math.max(0, oneBasedSceneNumber - 1));
    if (indices.length > 0 && sceneIndex <= indices[indices.length - 1]) {
      throw buildBranchingError(
        'The source does not contain enough scenes for distinct branching levels.',
        'INVALID_BRANCHING_LEVELS',
        400,
      );
    }
    indices.push(sceneIndex);
  }
  return indices;
}

export function buildBranchNodeId(parentNodeId, childIndex) {
  if (!normalizeString(parentNodeId)) {
    throw buildBranchingError('parentNodeId is required.', 'BRANCH_NODE_ID_INVALID', 500);
  }
  if (!Number.isInteger(childIndex) || childIndex < 0 || childIndex >= BRANCHING_FACTOR) {
    throw buildBranchingError(
      `childIndex must be 0 or ${BRANCHING_FACTOR - 1}.`,
      'BRANCH_NODE_ID_INVALID',
      500,
    );
  }
  return `${parentNodeId}.${childIndex + 1}`;
}

function buildBranchPointId(parentNodeId) {
  return `branch-point:${parentNodeId}`;
}

function createRootTree({ sourceMovieResourceList, numLevels, branchSceneIndices }) {
  const source = getResourceList(sourceMovieResourceList);
  return {
    structureType: BRANCHED_MOVIE_RESOURCE_LIST_STRUCTURE_TYPE,
    schemaVersion: BRANCHING_NARRATIVE_SCHEMA_VERSION,
    rootNodeId: BRANCHING_ROOT_NODE_ID,
    numLevels,
    branchingFactor: BRANCHING_FACTOR,
    branchSceneIndices: [...branchSceneIndices],
    nodes: [{
      nodeId: BRANCHING_ROOT_NODE_ID,
      parentNodeId: null,
      childNodeIds: [],
      level: 0,
      childIndex: null,
      branchOrdinal: null,
      divergence: null,
      scenes: deepCloneJson(source.scenes),
      sounds: deepCloneJson(source.sounds),
    }],
    branchPoints: [],
  };
}

function getCheckpointTree(existingCheckpoint) {
  if (!existingCheckpoint) return null;
  if (existingCheckpoint.movieResourceList?.structureType ===
    BRANCHED_MOVIE_RESOURCE_LIST_STRUCTURE_TYPE) {
    return existingCheckpoint.movieResourceList;
  }
  if (existingCheckpoint.structureType === BRANCHED_MOVIE_RESOURCE_LIST_STRUCTURE_TYPE) {
    return existingCheckpoint;
  }
  throw buildBranchingError(
    'existingCheckpoint does not contain a branched movieResourceList.',
    'BRANCH_CHECKPOINT_INVALID',
    409,
  );
}

function assertCheckpointCompatible(tree, sourceMovieResourceList, numLevels, branchSceneIndices) {
  const errors = [];
  if (tree.schemaVersion !== BRANCHING_NARRATIVE_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${BRANCHING_NARRATIVE_SCHEMA_VERSION}.`);
  }
  if (tree.rootNodeId !== BRANCHING_ROOT_NODE_ID) errors.push('rootNodeId must be root.');
  if (tree.numLevels !== numLevels) errors.push('Checkpoint numLevels does not match the request.');
  if (tree.branchingFactor !== BRANCHING_FACTOR) {
    errors.push(`branchingFactor must be ${BRANCHING_FACTOR}.`);
  }
  if (!isDeepStrictEqual(tree.branchSceneIndices, branchSceneIndices)) {
    errors.push('Checkpoint branchSceneIndices do not match the deterministic schedule.');
  }
  if (!Array.isArray(tree.nodes) || !Array.isArray(tree.branchPoints)) {
    errors.push('Checkpoint nodes and branchPoints must be arrays.');
  }

  const rootNode = Array.isArray(tree.nodes)
    ? tree.nodes.find((node) => node?.nodeId === tree.rootNodeId)
    : null;
  if (!rootNode) {
    errors.push('Checkpoint root node is missing.');
  } else if (!isDeepStrictEqual(getNodeResourceList(rootNode), getResourceList(sourceMovieResourceList))) {
    errors.push('Checkpoint root resource list does not match the source snapshot.');
  }

  const nodeIds = Array.isArray(tree.nodes) ? tree.nodes.map((node) => node?.nodeId) : [];
  if (new Set(nodeIds).size !== nodeIds.length) errors.push('Checkpoint node IDs must be unique.');
  const branchPointParents = Array.isArray(tree.branchPoints)
    ? tree.branchPoints.map((branchPoint) => branchPoint?.parentNodeId)
    : [];
  if (new Set(branchPointParents).size !== branchPointParents.length) {
    errors.push('Checkpoint may contain only one branch point per parent node.');
  }

  if (errors.length > 0) {
    throw buildBranchingError(
      `Branching checkpoint is incompatible: ${errors.join(' ')}`,
      'BRANCH_CHECKPOINT_INVALID',
      409,
      { validationErrors: errors },
    );
  }
}

function findNode(tree, nodeId) {
  return tree.nodes.find((node) => node.nodeId === nodeId) || null;
}

function findBranchPoint(tree, parentNodeId) {
  return tree.branchPoints.find((branchPoint) => (
    branchPoint.parentNodeId === parentNodeId
  )) || null;
}

function buildDivergenceFromChoice(choice, divergenceSceneIndex) {
  return {
    divergenceSceneIndex,
    path_name: choice.path_name,
    path_description: choice.path_description,
  };
}

export function buildBranchingMeta(movieResourceList) {
  const tree = movieResourceList?.movieResourceList || movieResourceList;
  if (!tree || tree.structureType !== BRANCHED_MOVIE_RESOURCE_LIST_STRUCTURE_TYPE) {
    throw buildBranchingError(
      'A branched movieResourceList is required to build branching metadata.',
      'BRANCHING_TREE_INVALID',
      500,
    );
  }
  const nodes = Array.isArray(tree.nodes) ? tree.nodes : [];
  const leafNodeIds = nodes
    .filter((node) => node?.level === tree.numLevels)
    .map((node) => node.nodeId);
  return {
    schemaVersion: tree.schemaVersion,
    numLevels: tree.numLevels,
    branchingFactor: tree.branchingFactor,
    rootNodeId: tree.rootNodeId,
    branchSceneIndices: deepCloneJson(tree.branchSceneIndices || []),
    branchPoints: deepCloneJson(tree.branchPoints || []),
    leafNodeIds,
    nodeCount: nodes.length,
  };
}

function buildCheckpointPayload(tree, progress = null) {
  const movieResourceList = deepCloneJson(tree);
  return {
    movieResourceList,
    branchingMeta: buildBranchingMeta(movieResourceList),
    ...(progress ? { progress: deepCloneJson(progress) } : {}),
  };
}

async function emitCheckpoint(onCheckpoint, tree, progress) {
  if (typeof onCheckpoint !== 'function') return;
  await onCheckpoint(buildCheckpointPayload(tree, progress));
}

function validateNodeResourceSynchronously({
  node,
  validateMovieResourceList,
  videoGenerationModel,
  framesPerSecond,
  requestedDuration,
}) {
  const resourceList = getNodeResourceList(node);
  if (!resourceList) {
    return {
      errors: ['must include scenes and sounds arrays.'],
      narrativeJson: null,
    };
  }
  if (typeof validateMovieResourceList !== 'function') {
    return { errors: [], narrativeJson: deepCloneJson(resourceList) };
  }
  try {
    const result = validateMovieResourceList(
      resourceList,
      videoGenerationModel,
      framesPerSecond,
      { requestedDuration },
    );
    if (result && typeof result.then === 'function') {
      return {
        errors: ['validator must be synchronous during final tree validation.'],
        narrativeJson: null,
      };
    }
    const normalized = normalizeValidationResult(result, resourceList);
    return {
      errors: normalized.valid ? [] : normalized.errors,
      narrativeJson: normalized.valid
        ? deepCloneJson(normalized.narrativeJson)
        : null,
    };
  } catch (error) {
    return {
      errors: [error?.message || String(error)],
      narrativeJson: null,
    };
  }
}

export function validateBranchingNarrativeTree(movieResourceList, {
  videoGenerationModel = 'RUNWAYML',
  framesPerSecond = undefined,
  requestedDuration = null,
  maxLevels = null,
  includeNormalizedNodeResourceLists = false,
  validateMovieResourceList = defaultValidateTextToVideoNarrative,
} = {}) {
  const tree = movieResourceList?.movieResourceList || movieResourceList;
  const errors = [];
  if (!tree || typeof tree !== 'object' || Array.isArray(tree)) {
    return { valid: false, errors: ['Branched movieResourceList must be an object.'] };
  }
  if (tree.structureType !== BRANCHED_MOVIE_RESOURCE_LIST_STRUCTURE_TYPE) {
    errors.push(`structureType must be ${BRANCHED_MOVIE_RESOURCE_LIST_STRUCTURE_TYPE}.`);
  }
  if (tree.schemaVersion !== BRANCHING_NARRATIVE_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${BRANCHING_NARRATIVE_SCHEMA_VERSION}.`);
  }
  if (tree.branchingFactor !== BRANCHING_FACTOR) {
    errors.push(`branchingFactor must be ${BRANCHING_FACTOR}.`);
  }
  if (!Array.isArray(tree.nodes)) errors.push('nodes must be an array.');
  if (!Array.isArray(tree.branchPoints)) errors.push('branchPoints must be an array.');
  if (errors.length > 0 && !Array.isArray(tree.nodes)) return { valid: false, errors };

  let expectedBranchSceneIndices = [];
  try {
    const rootCandidate = tree.nodes.find((node) => node?.nodeId === tree.rootNodeId);
    const sceneCount = Array.isArray(rootCandidate?.scenes) ? rootCandidate.scenes.length : 0;
    const effectiveMaxLevels = Number.isInteger(maxLevels) && maxLevels > 0
      ? maxLevels
      : Math.max(MAX_BRANCHING_LEVELS, Number(tree.numLevels) || 0);
    expectedBranchSceneIndices = calculateBranchSceneIndices(
      sceneCount,
      tree.numLevels,
      { maxLevels: effectiveMaxLevels },
    );
    if (!isDeepStrictEqual(tree.branchSceneIndices, expectedBranchSceneIndices)) {
      errors.push('branchSceneIndices do not match the deterministic schedule.');
    }
  } catch (error) {
    errors.push(error?.message || String(error));
  }

  const nodes = tree.nodes || [];
  const nodeById = new Map();
  const normalizedNodeResourceLists = {};
  for (const node of nodes) {
    if (!normalizeString(node?.nodeId)) {
      errors.push('Every node must have a non-empty nodeId.');
      continue;
    }
    if (nodeById.has(node.nodeId)) errors.push(`Duplicate nodeId ${node.nodeId}.`);
    nodeById.set(node.nodeId, node);
  }

  const root = nodeById.get(tree.rootNodeId);
  if (!root) {
    errors.push('rootNodeId must reference an existing node.');
  } else {
    if (root.parentNodeId !== null) errors.push('Root parentNodeId must be null.');
    if (root.level !== 0) errors.push('Root level must be 0.');
    if (root.divergence !== null) errors.push('Root divergence must be null.');
  }

  const expectedNodeCount = Number.isInteger(tree.numLevels)
    ? (2 ** (tree.numLevels + 1)) - 1
    : null;
  if (expectedNodeCount !== null && nodes.length !== expectedNodeCount) {
    errors.push(`Tree must contain ${expectedNodeCount} nodes; found ${nodes.length}.`);
  }

  for (const node of nodes) {
    if (!Number.isInteger(node?.level) || node.level < 0 || node.level > tree.numLevels) {
      errors.push(`Node ${node?.nodeId || '<unknown>'} has an invalid level.`);
      continue;
    }
    const expectedLevelCount = 2 ** node.level;
    const actualLevelCount = nodes.filter((candidate) => candidate?.level === node.level).length;
    if (actualLevelCount !== expectedLevelCount) {
      const message = `Level ${node.level} must contain ${expectedLevelCount} nodes; found ${actualLevelCount}.`;
      if (!errors.includes(message)) errors.push(message);
    }
    const childNodeIds = Array.isArray(node.childNodeIds) ? node.childNodeIds : [];
    const expectedChildren = node.level < tree.numLevels ? BRANCHING_FACTOR : 0;
    if (childNodeIds.length !== expectedChildren) {
      errors.push(`Node ${node.nodeId} must contain ${expectedChildren} childNodeIds.`);
    }
    if (childNodeIds.length === BRANCHING_FACTOR) {
      const leftChild = nodeById.get(childNodeIds[0]);
      const rightChild = nodeById.get(childNodeIds[1]);
      if (leftChild && rightChild && isDeepStrictEqual(
        getNodeResourceList(leftChild),
        getNodeResourceList(rightChild),
      )) {
        errors.push(`Sibling branches under ${node.nodeId} must have distinct resource lists.`);
      }
    }

    const resourceValidation = validateNodeResourceSynchronously({
      node,
      validateMovieResourceList,
      videoGenerationModel,
      framesPerSecond,
      requestedDuration,
    });
    errors.push(...resourceValidation.errors.map(
      (message) => `Node ${node.nodeId}: ${message}`,
    ));
    if (resourceValidation.narrativeJson) {
      normalizedNodeResourceLists[node.nodeId] = resourceValidation.narrativeJson;
    }

    if (node.level === 0) continue;
    const parent = nodeById.get(node.parentNodeId);
    if (!parent) {
      errors.push(`Node ${node.nodeId} references a missing parent ${node.parentNodeId}.`);
      continue;
    }
    if (parent.level !== node.level - 1) {
      errors.push(`Node ${node.nodeId} must be exactly one level below its parent.`);
    }
    if (!Array.isArray(parent.childNodeIds) || !parent.childNodeIds.includes(node.nodeId)) {
      errors.push(`Parent ${parent.nodeId} does not reference child ${node.nodeId}.`);
    }
    if (!Number.isInteger(node.childIndex) || node.childIndex < 0 ||
      node.childIndex >= BRANCHING_FACTOR) {
      errors.push(`Node ${node.nodeId} has an invalid childIndex.`);
    } else if (buildBranchNodeId(parent.nodeId, node.childIndex) !== node.nodeId) {
      errors.push(`Node ${node.nodeId} does not use its deterministic path ID.`);
    }
    if (node.branchOrdinal !== node.childIndex + 1) {
      errors.push(`Node ${node.nodeId} has an invalid one-based branchOrdinal.`);
    }
    const divergenceSceneIndex = expectedBranchSceneIndices[node.level - 1];
    if (node.divergence?.divergenceSceneIndex !== divergenceSceneIndex) {
      errors.push(`Node ${node.nodeId} has an invalid divergenceSceneIndex.`);
    }
    if (!normalizeString(node.divergence?.path_name) ||
      !normalizeString(node.divergence?.path_description)) {
      errors.push(`Node ${node.nodeId} has incomplete divergence metadata.`);
    }
    errors.push(...getPrefixErrors(parent, node, divergenceSceneIndex).map(
      (message) => `Node ${node.nodeId}: ${message}`,
    ));
  }

  const branchPoints = tree.branchPoints || [];
  const expectedBranchPointCount = Number.isInteger(tree.numLevels)
    ? (2 ** tree.numLevels) - 1
    : null;
  if (expectedBranchPointCount !== null && branchPoints.length !== expectedBranchPointCount) {
    errors.push(
      `Tree must contain ${expectedBranchPointCount} branch points; found ${branchPoints.length}.`,
    );
  }
  const branchPointParents = new Set();
  for (const branchPoint of branchPoints) {
    if (branchPointParents.has(branchPoint?.parentNodeId)) {
      errors.push(`Parent ${branchPoint?.parentNodeId} has more than one branch point.`);
    }
    branchPointParents.add(branchPoint?.parentNodeId);
    const parent = nodeById.get(branchPoint?.parentNodeId);
    if (!parent) {
      errors.push(`Branch point ${branchPoint?.branchPointId || '<unknown>'} has no parent node.`);
      continue;
    }
    const expectedLevel = parent.level + 1;
    const expectedIndex = expectedBranchSceneIndices[expectedLevel - 1];
    if (branchPoint.branchPointId !== buildBranchPointId(parent.nodeId)) {
      errors.push(`Branch point for ${parent.nodeId} has an invalid branchPointId.`);
    }
    if (branchPoint.level !== expectedLevel) {
      errors.push(`Branch point for ${parent.nodeId} has an invalid level.`);
    }
    if (branchPoint.divergenceSceneIndex !== expectedIndex) {
      errors.push(`Branch point for ${parent.nodeId} has an invalid divergenceSceneIndex.`);
    }
    if (branchPoint.status !== 'COMPLETED') {
      errors.push(`Branch point for ${parent.nodeId} must be COMPLETED.`);
    }
    let paths;
    try {
      paths = normalizeDivergencePaths(branchPoint.divergencePaths);
    } catch (error) {
      errors.push(error.message);
      continue;
    }
    const choiceIds = branchPoint.divergencePaths.map((choice) => choice?.childNodeId);
    if (!isDeepStrictEqual(choiceIds, parent.childNodeIds)) {
      errors.push(`Branch point choices for ${parent.nodeId} must match childNodeIds in order.`);
    }
    paths.forEach((path, childIndex) => {
      const child = nodeById.get(choiceIds[childIndex]);
      if (!child) return;
      if (!isDeepStrictEqual(
        buildDivergenceFromChoice(path, expectedIndex),
        child.divergence,
      )) {
        errors.push(`Branch point choice ${childIndex} does not match child ${child.nodeId}.`);
      }
    });
  }

  const leafNodeIds = nodes
    .filter((node) => node?.level === tree.numLevels)
    .map((node) => node.nodeId);
  return {
    valid: errors.length === 0,
    errors,
    leafNodeIds,
    nodeCount: nodes.length,
    branchPointCount: branchPoints.length,
    ...(includeNormalizedNodeResourceLists ? { normalizedNodeResourceLists } : {}),
  };
}

export async function generateBranchingNarrativeTree({
  sourceMovieResourceList,
  themeJson,
  narrativeJson = null,
  prompt,
  originalPrompt = prompt,
  numLevels,
  maxLevels = MAX_BRANCHING_LEVELS,
  inferenceModel,
  videoGenerationModel = 'RUNWAYML',
  requestedDuration = null,
  externalRequestContext = null,
  requestKeyPrefix = 'narrative:create_branching',
  onInferenceResponse,
  onCheckpoint,
  existingCheckpoint = null,
  generateDivergencePaths = null,
  generateBranchMovieResourceList = null,
  dependencies = {},
} = {}) {
  const source = getResourceList(sourceMovieResourceList);
  if (!source) {
    throw buildBranchingError(
      'sourceMovieResourceList must include scenes and sounds arrays.',
      'BRANCH_SOURCE_MOVIE_RESOURCE_LIST_INVALID',
      400,
    );
  }
  const branchSceneIndices = calculateBranchSceneIndices(
    source.scenes.length,
    numLevels,
    { maxLevels },
  );
  const effectiveRequestedDuration = Number.isFinite(Number(requestedDuration)) &&
    Number(requestedDuration) > 0
    ? Number(requestedDuration)
    : getDurationFromScenes(source.scenes);
  const validateNarrative = dependencies.validateTextToVideoNarrative ||
    defaultValidateTextToVideoNarrative;
  const planDivergences = generateDivergencePaths ||
    dependencies.generateDivergencePaths ||
    defaultGenerateDivergencePaths;
  const generateChild = generateBranchMovieResourceList ||
    dependencies.generateBranchMovieResourceList ||
    defaultGenerateBranchMovieResourceList;

  if (typeof planDivergences !== 'function' || typeof generateChild !== 'function') {
    throw buildBranchingError(
      'Branching inference functions are unavailable.',
      'BRANCH_INFERENCE_UNAVAILABLE',
      500,
    );
  }

  await validateGeneratedResourceList({
    movieResourceList: source,
    validateTextToVideoNarrative: validateNarrative,
    videoGenerationModel,
    requestedDuration: effectiveRequestedDuration,
    errorCode: 'BRANCH_SOURCE_MOVIE_RESOURCE_LIST_INVALID',
    errorStatus: 400,
    nodeId: BRANCHING_ROOT_NODE_ID,
  });

  const checkpointTree = getCheckpointTree(existingCheckpoint);
  const tree = checkpointTree
    ? deepCloneJson(checkpointTree)
    : createRootTree({ sourceMovieResourceList: source, numLevels, branchSceneIndices });
  if (checkpointTree) {
    assertCheckpointCompatible(tree, source, numLevels, branchSceneIndices);
  }

  for (let level = 1; level <= numLevels; level += 1) {
    const divergenceSceneIndex = branchSceneIndices[level - 1];
    const parentNodes = tree.nodes
      .filter((node) => node.level === level - 1)
      .sort((left, right) => left.nodeId.localeCompare(right.nodeId));

    for (const parentNode of parentNodes) {
      const parentMovieResourceList = getNodeResourceList(parentNode);
      let branchPoint = findBranchPoint(tree, parentNode.nodeId);
      let divergencePaths;

      if (branchPoint) {
        if (branchPoint.level !== level ||
          branchPoint.divergenceSceneIndex !== divergenceSceneIndex) {
          throw buildBranchingError(
            `Checkpoint branch point for ${parentNode.nodeId} does not match level ${level}.`,
            'BRANCH_CHECKPOINT_INVALID',
            409,
          );
        }
        divergencePaths = normalizeDivergencePaths(branchPoint.divergencePaths);
      } else {
        const plannerRequestKey =
          `${requestKeyPrefix}:level-${level}:parent-${parentNode.nodeId}:divergence`;
        divergencePaths = normalizeDivergencePaths(await planDivergences({
          themeJson,
          parentMovieResourceList: deepCloneJson(parentMovieResourceList),
          narrativeJson,
          originalPrompt,
          divergenceSceneIndex,
          inferenceModel,
          externalRequestContext,
          requestKey: plannerRequestKey,
          onInferenceResponse,
        }));
        branchPoint = {
          branchPointId: buildBranchPointId(parentNode.nodeId),
          parentNodeId: parentNode.nodeId,
          level,
          divergenceSceneIndex,
          status: 'PLANNED',
          divergencePaths: divergencePaths.map((path, childIndex) => ({
            childNodeId: buildBranchNodeId(parentNode.nodeId, childIndex),
            ...path,
          })),
        };
        parentNode.childNodeIds = branchPoint.divergencePaths.map((path) => path.childNodeId);
        tree.branchPoints.push(branchPoint);
        await emitCheckpoint(onCheckpoint, tree, {
          stage: 'DIVERGENCES_PLANNED',
          level,
          parentNodeId: parentNode.nodeId,
        });
      }

      const expectedChildNodeIds = divergencePaths.map((_path, childIndex) => (
        buildBranchNodeId(parentNode.nodeId, childIndex)
      ));
      const branchPointChildNodeIds = branchPoint.divergencePaths.map(
        (choice) => choice.childNodeId,
      );
      if (!isDeepStrictEqual(branchPointChildNodeIds, expectedChildNodeIds)) {
        throw buildBranchingError(
          `Checkpoint child IDs for ${parentNode.nodeId} are not deterministic.`,
          'BRANCH_CHECKPOINT_INVALID',
          409,
        );
      }
      parentNode.childNodeIds = expectedChildNodeIds;

      for (let childIndex = 0; childIndex < BRANCHING_FACTOR; childIndex += 1) {
        const divergence = divergencePaths[childIndex];
        const childNodeId = expectedChildNodeIds[childIndex];
        const existingChild = findNode(tree, childNodeId);
        if (existingChild) {
          if (existingChild.parentNodeId !== parentNode.nodeId ||
            existingChild.level !== level ||
            existingChild.childIndex !== childIndex ||
            existingChild.branchOrdinal !== childIndex + 1) {
            throw buildBranchingError(
              `Checkpoint node ${childNodeId} has inconsistent ancestry metadata.`,
              'BRANCH_CHECKPOINT_INVALID',
              409,
            );
          }
          assertStrictParentPrefix(
            parentMovieResourceList,
            getNodeResourceList(existingChild),
            divergenceSceneIndex,
            childNodeId,
          );
          await validateGeneratedResourceList({
            movieResourceList: existingChild,
            validateTextToVideoNarrative: validateNarrative,
            videoGenerationModel,
            requestedDuration: effectiveRequestedDuration,
            errorCode: 'BRANCH_CHECKPOINT_INVALID',
            errorStatus: 409,
            nodeId: childNodeId,
          });
          continue;
        }

        const childRequestKey =
          `${requestKeyPrefix}:level-${level}:parent-${parentNode.nodeId}:child-${childIndex}`;
        const siblingNode = childIndex > 0
          ? findNode(tree, expectedChildNodeIds[0])
          : null;
        const generatedChild = getResourceList(await generateChild({
          themeJson,
          parentMovieResourceList: deepCloneJson(parentMovieResourceList),
          originalPrompt,
          divergenceSceneIndex,
          divergence: deepCloneJson(divergence),
          siblingMovieResourceList: siblingNode
            ? deepCloneJson(getNodeResourceList(siblingNode))
            : null,
          inferenceModel,
          videoGenerationModel,
          requestedDuration: effectiveRequestedDuration,
          externalRequestContext,
          requestKey: childRequestKey,
          onInferenceResponse,
        }));
        if (!generatedChild) {
          throw buildBranchingError(
            `Branch inference for ${childNodeId} did not return scenes and sounds.`,
            'BRANCH_MOVIE_RESOURCE_LIST_INVALID',
            502,
            { childNodeId },
          );
        }
        assertStrictParentPrefix(
          parentMovieResourceList,
          generatedChild,
          divergenceSceneIndex,
          childNodeId,
        );
        const validatedChild = await validateGeneratedResourceList({
          movieResourceList: generatedChild,
          validateTextToVideoNarrative: validateNarrative,
          videoGenerationModel,
          requestedDuration: effectiveRequestedDuration,
          errorCode: 'BRANCH_MOVIE_RESOURCE_LIST_VALIDATION_FAILED',
          nodeId: childNodeId,
        });
        assertStrictParentPrefix(
          parentMovieResourceList,
          validatedChild,
          divergenceSceneIndex,
          childNodeId,
        );
        tree.nodes.push({
          nodeId: childNodeId,
          parentNodeId: parentNode.nodeId,
          childNodeIds: [],
          level,
          childIndex,
          branchOrdinal: childIndex + 1,
          divergence: buildDivergenceFromChoice(divergence, divergenceSceneIndex),
          scenes: deepCloneJson(validatedChild.scenes),
          sounds: deepCloneJson(validatedChild.sounds),
        });
        await emitCheckpoint(onCheckpoint, tree, {
          stage: 'CHILD_GENERATED',
          level,
          parentNodeId: parentNode.nodeId,
          childNodeId,
        });
      }

      const completedChildren = expectedChildNodeIds.map((childNodeId) => (
        findNode(tree, childNodeId)
      ));
      if (completedChildren.every(Boolean) && isDeepStrictEqual(
        getNodeResourceList(completedChildren[0]),
        getNodeResourceList(completedChildren[1]),
      )) {
        throw buildBranchingError(
          `Sibling branches under ${parentNode.nodeId} returned identical resource lists.`,
          'BRANCH_SIBLINGS_NOT_DISTINCT',
          502,
          { parentNodeId: parentNode.nodeId },
        );
      }

      branchPoint.status = 'COMPLETED';
      await emitCheckpoint(onCheckpoint, tree, {
        stage: 'PARENT_EXPANDED',
        level,
        parentNodeId: parentNode.nodeId,
      });
    }
  }

  const validation = validateBranchingNarrativeTree(tree, {
    videoGenerationModel,
    requestedDuration: effectiveRequestedDuration,
    maxLevels,
    validateMovieResourceList: validateNarrative,
  });
  if (!validation.valid) {
    throw buildBranchingError(
      `Final branching tree validation failed: ${validation.errors.join(' ')}`,
      'BRANCHING_TREE_VALIDATION_FAILED',
      502,
      { validationErrors: validation.errors },
    );
  }

  const movieResourceList = deepCloneJson(tree);
  return {
    movieResourceList,
    branchingMeta: buildBranchingMeta(movieResourceList),
    validation,
  };
}
