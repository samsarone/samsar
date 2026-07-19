import mongoose from 'mongoose';

import {
  TEXT_TO_VIDEO_VIDEO_MODEL_KEYS,
} from '../../consts/ExpressVideoModelOptions.js';
import NarrativeRequest from '../../schema/NarrativeRequest.js';
import User from '../../schema/User.js';
import { getDBConnectionString } from '../DBString.js';
import { validateTextToVideoNarrative } from '../movie_session/utils/TranscriptUtils.js';
import {
  buildBranchingMeta,
  validateBranchingNarrativeTree,
} from '../movie_session/branching/BranchingNarrativeTree.js';
import * as MovieAPI from './MovieAPI.js';
import { validateExpressImageModelKey } from './PromptUtils.js';
import { getCurrentAPIKeyUsageContext } from './RequestAuthContext.js';

const DEFAULT_IMAGE_MODEL = 'GPTIMAGE2';
const DEFAULT_VIDEO_MODEL = 'RUNWAYML';
const NARRATIVE_ASPECT_RATIO = '1:1';
const SETTLED_NARRATIVE_BILLING_STATUSES = new Set(['CHARGED', 'WAIVED']);

function buildError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.statusCode = status;
  error.code = code;
  return error;
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function deepCloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source || {}, key);
}

function getPayloadSource(payload = {}) {
  return hasOwn(payload, 'input') ? payload.input : payload;
}

function assertFieldIsNotProvided(payload, source, field) {
  if (hasOwn(payload, field) || (source !== payload && hasOwn(source, field))) {
    throw buildError(
      `${field} is not accepted. It is inherited from the source NarrativeRequest.`,
      400,
      'SOURCE_NARRATIVE_FIELD_OVERRIDE_NOT_ALLOWED',
    );
  }
}

function readOptionalModelAlias(source, snakeKey, camelKey, label) {
  const hasSnakeKey = hasOwn(source, snakeKey);
  const hasCamelKey = hasOwn(source, camelKey);
  if (!hasSnakeKey && !hasCamelKey) return null;

  const snakeValue = hasSnakeKey ? normalizeString(source[snakeKey]) : '';
  const camelValue = hasCamelKey ? normalizeString(source[camelKey]) : '';
  if ((hasSnakeKey && !snakeValue) || (hasCamelKey && !camelValue)) {
    throw buildError(
      `${label} must be a non-empty string when provided.`,
      400,
      `INVALID_${label.toUpperCase().replaceAll(' ', '_')}`,
    );
  }
  if (snakeValue && camelValue && snakeValue !== camelValue) {
    throw buildError(
      `${snakeKey} and ${camelKey} must match when both are provided.`,
      400,
      `CONFLICTING_${label.toUpperCase().replaceAll(' ', '_')}`,
    );
  }

  return snakeValue || camelValue;
}

export function normalizeNarrativeToVideoPayload(payload = {}) {
  if (!isObject(payload)) {
    throw buildError('Request payload must be a JSON object.', 400, 'INVALID_REQUEST_PAYLOAD');
  }
  const source = getPayloadSource(payload);
  if (!isObject(source)) {
    throw buildError('input must be a JSON object.', 400, 'INVALID_REQUEST_PAYLOAD');
  }

  assertFieldIsNotProvided(payload, source, 'prompt');
  assertFieldIsNotProvided(payload, source, 'duration');

  const requestIdAliases = [
    'narrative_request_id',
    'narrativeRequestId',
    'session_id',
    'sessionId',
    'request_id',
    'requestId',
  ];
  const suppliedRequestIds = requestIdAliases
    .filter((key) => hasOwn(source, key))
    .map((key) => ({ key, value: normalizeString(source[key]) }));
  if (suppliedRequestIds.some(({ value }) => !value)) {
    throw buildError(
      'NarrativeRequest id aliases must be non-empty strings when provided.',
      400,
      'INVALID_NARRATIVE_REQUEST_ID',
    );
  }
  const distinctRequestIds = [...new Set(suppliedRequestIds.map(({ value }) => value))];
  if (distinctRequestIds.length > 1) {
    throw buildError(
      'NarrativeRequest id aliases must match when more than one is provided.',
      400,
      'CONFLICTING_NARRATIVE_REQUEST_ID',
    );
  }
  const sourceRequestId = distinctRequestIds[0] || '';
  if (!mongoose.Types.ObjectId.isValid(sourceRequestId)) {
    throw buildError(
      'A valid narrative_request_id is required.',
      400,
      'INVALID_NARRATIVE_REQUEST_ID',
    );
  }

  return {
    sourceRequestId,
    imageModel: readOptionalModelAlias(source, 'image_model', 'imageModel', 'image model'),
    videoModel: readOptionalModelAlias(source, 'video_model', 'videoModel', 'video model'),
  };
}

function isValidExpressImageModel(model) {
  return validateExpressImageModelKey(model).status === true;
}

function isValidExpressVideoModel(model) {
  return TEXT_TO_VIDEO_VIDEO_MODEL_KEYS.includes(model);
}

function assertProvidedModelIsValid(model, validator, label, code) {
  if (model && !validator(model)) {
    throw buildError(`Invalid ${label}.`, 400, code);
  }
}

export function resolveNarrativeToVideoModels({
  requestedImageModel = null,
  requestedVideoModel = null,
  user = {},
} = {}) {
  assertProvidedModelIsValid(
    requestedImageModel,
    isValidExpressImageModel,
    'image model',
    'INVALID_IMAGE_MODEL',
  );
  assertProvidedModelIsValid(
    requestedVideoModel,
    isValidExpressVideoModel,
    'video model',
    'INVALID_VIDEO_MODEL',
  );

  const userImageModel = normalizeString(user?.agentImageModel);
  const userVideoModel = normalizeString(user?.agentVideoModel);
  const imageModel = requestedImageModel || (
    isValidExpressImageModel(userImageModel) ? userImageModel : DEFAULT_IMAGE_MODEL
  );
  const videoModel = requestedVideoModel || (
    isValidExpressVideoModel(userVideoModel) ? userVideoModel : DEFAULT_VIDEO_MODEL
  );

  return { imageModel, videoModel };
}

export function validateNarrativeToVideoSourceRequest(source) {
  if (!source) {
    throw buildError('Narrative request not found.', 404, 'NOT_FOUND');
  }

  const narrativeType = source.narrativeType || (
    source.requestType === 'create_single' ? 'singular' : null
  );
  const isSingularSource = source.requestType === 'create_single' && narrativeType === 'singular';
  const isBranchedSource = source.requestType === 'create_branching' && narrativeType === 'branched';
  if (!isSingularSource && !isBranchedSource) {
    throw buildError(
      'The source must be a singular create_single or branched create_branching NarrativeRequest.',
      422,
      'SOURCE_NARRATIVE_TYPE_INVALID',
    );
  }
  if (source.status !== 'COMPLETED') {
    throw buildError(
      'The source NarrativeRequest must be completed before creating a video.',
      409,
      'SOURCE_NARRATIVE_NOT_COMPLETED',
    );
  }
  if (source.generationOutcome !== 'SUCCEEDED') {
    throw buildError(
      'The source NarrativeRequest must have a successful generation outcome.',
      422,
      'SOURCE_NARRATIVE_GENERATION_INVALID',
    );
  }
  if (!SETTLED_NARRATIVE_BILLING_STATUSES.has(source.billingStatus)) {
    throw buildError(
      'The source NarrativeRequest billing must be settled before creating a video.',
      409,
      'SOURCE_NARRATIVE_BILLING_NOT_SETTLED',
    );
  }

  const duration = Number(source.duration);
  if (
    !normalizeString(source.prompt) ||
    !Number.isFinite(duration) ||
    duration < 10 ||
    duration > 240 ||
    !normalizeString(source.inferenceModel) ||
    !isObject(source.themeJson) ||
    !isObject(source.narrativeJson) ||
    !Array.isArray(source.narrativeJson.scenes) ||
    !Array.isArray(source.narrativeJson.sounds) ||
    !isObject(source.movieResourceList)
  ) {
    throw buildError(
      'The source NarrativeRequest does not contain complete narrative artifacts.',
      422,
      'SOURCE_NARRATIVE_ARTIFACTS_INVALID',
    );
  }

  const validation = isBranchedSource
    ? validateBranchingNarrativeTree(deepCloneJson(source.movieResourceList), {
      videoGenerationModel: source.videoGenerationModel || DEFAULT_VIDEO_MODEL,
      requestedDuration: duration,
    })
    : validateTextToVideoNarrative(
      deepCloneJson(source.movieResourceList),
      source.videoGenerationModel || DEFAULT_VIDEO_MODEL,
      undefined,
      { requestedDuration: duration },
    );
  if (!validation.valid) {
    throw buildError(
      `The source movieResourceList is invalid: ${validation.errors.join(', ')}`,
      422,
      'SOURCE_MOVIE_RESOURCE_LIST_INVALID',
    );
  }
  if (isBranchedSource) {
    const expectedMeta = buildBranchingMeta(source.movieResourceList);
    const suppliedLeafIds = Array.isArray(source.branchingMeta?.leafNodeIds)
      ? [...source.branchingMeta.leafNodeIds].sort()
      : [];
    const expectedLeafIds = [...expectedMeta.leafNodeIds].sort();
    if (
      !isObject(source.branchingMeta) ||
      source.branchingMeta.schemaVersion !== expectedMeta.schemaVersion ||
      source.branchingMeta.numLevels !== expectedMeta.numLevels ||
      source.branchingMeta.branchingFactor !== expectedMeta.branchingFactor ||
      source.branchingMeta.rootNodeId !== expectedMeta.rootNodeId ||
      JSON.stringify(suppliedLeafIds) !== JSON.stringify(expectedLeafIds)
    ) {
      throw buildError(
        'The source NarrativeRequest branchingMeta does not match its movieResourceList.',
        422,
        'SOURCE_BRANCHING_META_INVALID',
      );
    }
  }

  return source;
}

export async function createVideoFromNarrativeRequest({
  userId,
  payload = {},
  webhookUrl = null,
  dependencies = {},
} = {}) {
  if (!userId) {
    throw buildError('User ID is required.', 401, 'UNAUTHORIZED');
  }
  const normalizedPayload = normalizeNarrativeToVideoPayload(payload);

  await getDBConnectionString();
  const normalizedUserId = userId?.toString?.() || String(userId);
  const [source, user] = await Promise.all([
    NarrativeRequest.findOne({
      _id: normalizedPayload.sourceRequestId,
      userId: normalizedUserId,
    }).lean(),
    User.findById(userId)
      .select('agentImageModel agentVideoModel')
      .lean(),
  ]);

  if (!user) {
    throw buildError('User not found.', 404, 'USER_NOT_FOUND');
  }
  validateNarrativeToVideoSourceRequest(source);
  const { imageModel, videoModel } = resolveNarrativeToVideoModels({
    requestedImageModel: normalizedPayload.imageModel,
    requestedVideoModel: normalizedPayload.videoModel,
    user,
  });

  const requestCreateVideoFromNarrativeArtifacts =
    dependencies.requestCreateVideoFromNarrativeArtifacts ||
    MovieAPI.requestCreateVideoFromNarrativeArtifacts;
  if (typeof requestCreateVideoFromNarrativeArtifacts !== 'function') {
    throw buildError(
      'Narrative-to-video pipeline is unavailable.',
      500,
      'NARRATIVE_TO_VIDEO_PIPELINE_UNAVAILABLE',
    );
  }

  const sourceNarrativeRequestId = source._id?.toString?.() || normalizedPayload.sourceRequestId;
  const narrativeType = source.narrativeType || 'singular';
  const inferenceModel = normalizeString(source.inferenceModel);
  const aspectRatio = NARRATIVE_ASPECT_RATIO;
  const preparedPayload = {
    sourceNarrativeRequestId,
    narrativeRequestId: sourceNarrativeRequestId,
    sourceNarrativeType: narrativeType,
    narrativeType,
    prompt: normalizeString(source.prompt),
    duration: Number(source.duration),
    inference_model: inferenceModel,
    inferenceModel,
    videoTone: normalizeString(source.videoTone) || 'grounded',
    tone: normalizeString(source.videoTone) || 'grounded',
    speakerOptions: deepCloneJson(source.speakerOptions ?? null),
    themeJson: deepCloneJson(source.themeJson),
    narrativeJson: deepCloneJson(source.narrativeJson),
    movieResourceList: deepCloneJson(source.movieResourceList),
    branchingMeta: deepCloneJson(source.branchingMeta ?? null),
    image_model: imageModel,
    imageModel,
    video_model: videoModel,
    videoGenerationModel: videoModel,
    aspect_ratio: aspectRatio,
    aspectRatio,
    language: 'auto',
    requestType: 'API',
    creditSource: 'narrative_to_video',
    apiKeyUsage: getCurrentAPIKeyUsageContext(),
  };

  const response = await requestCreateVideoFromNarrativeArtifacts(
    userId,
    preparedPayload,
    webhookUrl,
  );
  return {
    ...(isObject(response) ? response : {}),
    source_narrative_request_id: sourceNarrativeRequestId,
    status: normalizeString(response?.status) || 'PENDING',
  };
}

export const __testOnly__ = {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_VIDEO_MODEL,
  NARRATIVE_ASPECT_RATIO,
  deepCloneJson,
};
