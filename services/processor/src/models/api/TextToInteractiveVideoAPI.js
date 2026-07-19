import { createHash, randomUUID } from 'node:crypto';

import InteractiveVideoRequest from '../../schema/InteractiveVideoRequest.js';
import NarrativeRequest from '../../schema/NarrativeRequest.js';
import ExpressGenerationBuilderRequest from '../../schema/ExpressGenerationBuilderRequest.js';
import User from '../../schema/User.js';
import VideoSession from '../../schema/VideoSession.js';
import { getDBConnectionString } from '../DBString.js';
import { assertAPIKeyUsageLimitForDebit } from '../GenerationCredits.js';
import { upsertGlobalSessionMapping } from '../GlobalSession.js';
import { createNewBlankQuickSession } from '../QuickSession.js';
import {
  createBranchingNarrativeRequest,
  normalizeNarrativeBranchingLevelAliases,
  processCreateBranchingNarrativeRequest,
} from './BranchingNarrativeAPI.js';
import {
  NARRATIVE_BILLING_POLICIES,
  buildNarrativeRequestPayload,
  createSingleNarrativeRequest,
  normalizeCreateSingleNarrativePayload,
  normalizeNarrativeVideoModel,
  processCreateSingleNarrativeRequest,
} from './NarrativeAPI.js';
import {
  DEFAULT_BRANCHED_VIDEO_ASPECT_RATIO,
  createVideoFromNarrativeRequest,
  normalizeBranchedVideoAspectRatio,
} from './NarrativeToVideoAPI.js';
import {
  validateExpressImageModelKey,
} from './PromptUtils.js';
import { normalizeAPIKeyUsageContext } from './RequestAuthContext.js';

const WORKER_LEASE_MS = 30 * 60 * 1000;
const RECOVERY_INTERVAL_MS = 15 * 1000;
const RETRY_DELAY_MS = 5 * 1000;
const ADMISSION_CREDIT_FLOOR = 0.0001;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;
const queuedRequestIds = new Set();
let recoveryInterval = null;
let indexesPromise = null;

function buildError(message, statusCode = 400, code = null) {
  const error = new Error(message);
  error.status = statusCode;
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source || {}, key);
}

function getPayloadSource(payload = {}) {
  return isObject(payload?.input) ? payload.input : payload;
}

function readRequiredAlias(source, snakeKey, camelKey, label, code) {
  const hasSnakeKey = hasOwn(source, snakeKey);
  const hasCamelKey = hasOwn(source, camelKey);
  const snakeValue = hasSnakeKey ? normalizeString(source[snakeKey]) : '';
  const camelValue = hasCamelKey ? normalizeString(source[camelKey]) : '';
  if (!snakeValue && !camelValue) {
    throw buildError(`${label} is required.`, 400, code);
  }
  if ((hasSnakeKey && !snakeValue) || (hasCamelKey && !camelValue)) {
    throw buildError(`${label} must be a non-empty string.`, 400, code);
  }
  if (snakeValue && camelValue && snakeValue !== camelValue) {
    throw buildError(
      `${snakeKey} and ${camelKey} must match when both are provided.`,
      400,
      `CONFLICTING_${code.replace(/^INVALID_/, '')}`,
    );
  }
  return snakeValue || camelValue;
}

function readTextToInteractiveVideoSessionId(payload = {}) {
  const source = getPayloadSource(payload);
  const aliases = [
    'session_id',
    'sessionId',
    'sessionID',
    'request_id',
    'requestId',
    'requestID',
  ];
  const provided = aliases.filter((key) => hasOwn(source, key));
  if (provided.length === 0) return null;
  const values = provided.map((key) => normalizeString(source[key]));
  if (values.some((value) => !value)) {
    throw buildError(
      'session_id/request_id must be a non-empty string when provided.',
      400,
      'INVALID_SESSION_ID',
    );
  }
  if (new Set(values).size > 1) {
    throw buildError(
      'session_id and request_id aliases must match when provided together.',
      400,
      'CONFLICTING_SESSION_ID',
    );
  }
  if (values[0].length > 200) {
    throw buildError(
      'session_id/request_id must not exceed 200 characters.',
      400,
      'INVALID_SESSION_ID',
    );
  }
  return values[0];
}

export function normalizeTextToInteractiveVideoPayload(payload = {}) {
  if (!isObject(payload)) {
    throw buildError('Request payload must be a JSON object.', 400, 'INVALID_REQUEST_PAYLOAD');
  }
  const source = getPayloadSource(payload);
  if (!isObject(source)) {
    throw buildError('input must be a JSON object.', 400, 'INVALID_REQUEST_PAYLOAD');
  }

  const singularPayload = normalizeCreateSingleNarrativePayload(payload);
  const videoModelWasProvided = hasOwn(source, 'video_model') || hasOwn(source, 'videoModel');
  if (!videoModelWasProvided) {
    throw buildError('video_model is required.', 400, 'INVALID_VIDEO_MODEL');
  }
  const videoModel = normalizeNarrativeVideoModel(source, {
    required: true,
    fallback: null,
  });
  const imageModelInput = readRequiredAlias(
    source,
    'image_model',
    'imageModel',
    'image_model',
    'INVALID_IMAGE_MODEL',
  );
  const imageModelValidation = validateExpressImageModelKey(imageModelInput);
  if (!imageModelValidation.status) {
    throw buildError(
      imageModelValidation.message || 'Invalid image model.',
      400,
      'INVALID_IMAGE_MODEL',
    );
  }
  const numLevels = normalizeNarrativeBranchingLevelAliases(source);
  const sessionId = readTextToInteractiveVideoSessionId(payload);

  return {
    prompt: singularPayload.prompt,
    duration: singularPayload.duration,
    inferenceModel: singularPayload.inferenceModel,
    imageModel: imageModelValidation.imageModel,
    videoModel,
    numLevels,
    aspectRatio: normalizeBranchedVideoAspectRatio(source),
    ...(sessionId ? { sessionId } : {}),
  };
}

function normalizeIdempotencyKey(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  if (normalized.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw buildError(
      `Idempotency key must not exceed ${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`,
      400,
      'INVALID_IDEMPOTENCY_KEY',
    );
  }
  return normalized;
}

function buildPayloadHash(payload, webhookUrl) {
  return createHash('sha256')
    .update(JSON.stringify({ payload, webhookUrl: webhookUrl || null }))
    .digest('hex');
}

function getErrorStatus(error) {
  if (error?.code === 'INSUFFICIENT_CREDITS' ||
    error?.code === 'API_KEY_USAGE_LIMIT_EXCEEDED') {
    return 402;
  }
  const status = Number(error?.statusCode ?? error?.status ?? error?.response?.status);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

async function ensureIndexes() {
  if (!indexesPromise) {
    indexesPromise = Promise.resolve()
      .then(() => Promise.all([
        InteractiveVideoRequest.createIndexes(),
        NarrativeRequest.createIndexes(),
      ]))
      .catch((error) => {
        indexesPromise = null;
        throw buildError(
          `Interactive video indexes are unavailable: ${error?.message || String(error)}`,
          503,
          'INTERACTIVE_VIDEO_INDEXES_UNAVAILABLE',
        );
      });
  }
  return indexesPromise;
}

export function buildTextToInteractiveVideoResponse(request) {
  const requestId = request?._id?.toString?.() || request?._id;
  const sessionId = request?.sessionId?.toString?.() || request?.sessionId;
  const failed = request?.status === 'FAILED';
  return {
    request_id: sessionId,
    session_id: sessionId,
    status: failed ? 'FAILED' : 'PENDING',
    narrative_type: 'branched',
    interactive_video_request_id: requestId,
    workflow_status: request?.status || 'PENDING',
    workflow_stage: request?.stage || 'SINGULAR_NARRATIVE',
    ...(request?.singularNarrativeRequestId
      ? {
        singular_narrative_request_id:
          request.singularNarrativeRequestId.toString(),
      }
      : {}),
    ...(request?.branchedNarrativeRequestId
      ? {
        branched_narrative_request_id:
          request.branchedNarrativeRequestId.toString(),
      }
      : {}),
    status_url: `/v2/status_detailed?request_id=${encodeURIComponent(sessionId)}`,
    ...(failed
      ? {
        error: {
          message: request.errorMessage || 'Interactive video generation failed.',
          code: request.errorCode || null,
          status: Number(request.errorStatus) || 500,
        },
      }
      : {}),
  };
}

function assertIdempotentPayloadMatches(existing, payloadHash) {
  if (existing?.payloadHash === payloadHash) return existing;
  throw buildError(
    'The idempotency key was already used with a different request payload.',
    409,
    'IDEMPOTENCY_KEY_CONFLICT',
  );
}

async function initializeVideoSession(
  { sessionId, userId, requestId, payload },
  {
    videoSessionModel = VideoSession,
    upsertSessionMapping = upsertGlobalSessionMapping,
  } = {},
) {
  const initialStatus = {
    prompt_generation: 'PENDING',
    image_generation: 'INIT',
    audio_generation: 'INIT',
    frame_generation: 'INIT',
    video_generation: 'INIT',
    ai_video_generation: 'INIT',
    speech_generation: 'INIT',
    music_generation: 'INIT',
    delete_reflow: 'INIT',
    timeline_reflowed: 'INIT',
  };
  await videoSessionModel.findByIdAndUpdate(sessionId, {
    $set: {
      interactiveVideoRequestId: requestId,
      narrativeType: 'branched',
      sourceNarrativeType: 'branched',
      isExpressGeneration: true,
      expressGenerationPending: true,
      expressGenerationFailed: false,
      videoGenerationPending: true,
      expressGenerationStatus: initialStatus,
      expressGenerationType: 'TEXT_TO_VIDEO',
      expressGenerativeVideoModel: payload.videoModel,
      expressGenerationImageModel: payload.imageModel,
      expressGenerationInferenceModel: payload.inferenceModel || null,
      builderRouteType: 'text_to_interactive_video',
      builderStatus: 'QUEUED',
      builderSessionSubType: 'interactive_video_create',
      inputPrompt: payload.prompt,
      expressInputPrompt: payload.prompt,
      totalDuration: payload.duration,
      aspectRatio: payload.aspectRatio || DEFAULT_BRANCHED_VIDEO_ASPECT_RATIO,
    },
  });
  await upsertSessionMapping({
    sessionId,
    sessionType: 'video',
    requestId: sessionId,
    provider: payload.videoModel,
    userId,
    status: 'PENDING',
    requestType: 'API',
    sessionSubType: 'interactive_video_create',
    metadata: {
      interactiveVideoRequestId: requestId?.toString?.() || requestId,
      narrativeType: 'branched',
    },
  });
}

export async function createTextToInteractiveVideoDraftSession({
  userId,
  dependencies = {},
} = {}) {
  if (!userId) throw buildError('User ID is required.', 401, 'UNAUTHORIZED');
  await getDBConnectionString();

  const createBlankSession = dependencies.createNewBlankQuickSession ||
    createNewBlankQuickSession;
  const videoSessionModel = dependencies.videoSessionModel || VideoSession;
  const upsertSessionMapping = dependencies.upsertGlobalSessionMapping ||
    upsertGlobalSessionMapping;
  const sessionId = await createBlankSession(userId);
  const defaults = {
    duration: 30,
    imageModel: 'NANOBANANA2',
    videoModel: 'COSMOS3SUPERI2V',
    numLevels: 2,
    aspectRatio: DEFAULT_BRANCHED_VIDEO_ASPECT_RATIO,
  };

  await videoSessionModel.findByIdAndUpdate(sessionId, {
    $set: {
      narrativeType: 'branched',
      sourceNarrativeType: 'branched',
      sessionType: 'video',
      isExpressGeneration: true,
      expressGenerationPending: false,
      videoGenerationPending: false,
      builderRouteType: 'text_to_interactive_video',
      builderStatus: 'DRAFT',
      builderSessionSubType: 'interactive_video_draft',
      totalDuration: defaults.duration,
      aspectRatio: defaults.aspectRatio,
      expressGenerationImageModel: defaults.imageModel,
      expressGenerativeVideoModel: defaults.videoModel,
      interactiveVideoDraftConfig: defaults,
    },
  });
  await upsertSessionMapping({
    sessionId,
    sessionType: 'video',
    requestId: sessionId,
    provider: defaults.videoModel,
    userId,
    status: 'DRAFT',
    requestType: 'CREATOR',
    sessionSubType: 'interactive_video_draft',
    metadata: {
      narrativeType: 'branched',
      source: 'tmochi',
      defaults,
    },
  });

  return {
    request_id: sessionId,
    session_id: sessionId,
    status: 'DRAFT',
    narrative_type: 'branched',
    defaults,
  };
}

export async function validateTextToInteractiveVideoSessionInput({
  userId,
  payload = {},
  dependencies = {},
} = {}) {
  if (!userId) throw buildError('User ID is required.', 401, 'UNAUTHORIZED');
  const requestedSessionId = readTextToInteractiveVideoSessionId(payload);
  if (!requestedSessionId) {
    return {
      normalizedPayload: normalizeTextToInteractiveVideoPayload(payload),
      draftSession: null,
    };
  }

  const videoSessionModel = dependencies.videoSessionModel || VideoSession;
  const draftSession = await videoSessionModel.findOne({
    _id: requestedSessionId,
    userId,
    narrativeType: 'branched',
    builderStatus: 'DRAFT',
    builderSessionSubType: 'interactive_video_draft',
    interactiveVideoRequestId: null,
  }).lean();
  if (!draftSession) {
    throw buildError(
      'The interactive video draft session is unavailable or has already been submitted.',
      409,
      'INTERACTIVE_VIDEO_DRAFT_UNAVAILABLE',
    );
  }

  const source = getPayloadSource(payload);
  const defaults = isObject(draftSession.interactiveVideoDraftConfig)
    ? draftSession.interactiveVideoDraftConfig
    : {};
  const mergedPayload = {
    ...source,
    duration: source.duration ?? defaults.duration ?? draftSession.totalDuration,
    image_model:
      source.image_model ?? source.imageModel ??
      defaults.imageModel ?? draftSession.expressGenerationImageModel,
    video_model:
      source.video_model ?? source.videoModel ??
      defaults.videoModel ?? draftSession.expressGenerativeVideoModel,
    num_levels:
      source.num_levels ?? source.numLevels ??
      defaults.numLevels ?? 2,
    aspect_ratio:
      source.aspect_ratio ?? source.aspectRatio ??
      defaults.aspectRatio ?? draftSession.aspectRatio ??
      DEFAULT_BRANCHED_VIDEO_ASPECT_RATIO,
    session_id: requestedSessionId,
  };

  return {
    normalizedPayload: normalizeTextToInteractiveVideoPayload({ input: mergedPayload }),
    draftSession,
  };
}

export async function createTextToInteractiveVideoRequest({
  userId,
  payload = {},
  authContext = null,
  webhookUrl = null,
  idempotencyKey = null,
  dependencies = {},
} = {}) {
  if (!userId) throw buildError('User ID is required.', 401, 'UNAUTHORIZED');
  const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);
  const normalizedWebhookUrl = normalizeString(webhookUrl) || null;
  const apiKeyUsage = normalizeAPIKeyUsageContext(authContext);

  await getDBConnectionString();
  await ensureIndexes();
  if (normalizedIdempotencyKey) {
    const existing = await InteractiveVideoRequest.findOne({
      userId: userId?.toString?.() || String(userId),
      idempotencyKey: normalizedIdempotencyKey,
    }).lean();
    if (existing) {
      const suppliedSessionId = readTextToInteractiveVideoSessionId(payload);
      if (suppliedSessionId && suppliedSessionId !== existing.sessionId?.toString?.()) {
        throw buildError(
          'The idempotency key is already associated with a different session.',
          409,
          'IDEMPOTENCY_KEY_CONFLICT',
        );
      }
      const replaySource = getPayloadSource(payload);
      const replayPayload = normalizeTextToInteractiveVideoPayload({
        input: {
          ...existing.payload,
          ...replaySource,
          ...(existing.payload?.sessionId
            ? { session_id: existing.payload.sessionId }
            : {}),
        },
      });
      return buildTextToInteractiveVideoResponse(
        assertIdempotentPayloadMatches(
          existing,
          buildPayloadHash(replayPayload, normalizedWebhookUrl),
        ),
      );
    }
  }
  const { normalizedPayload, draftSession } =
    await validateTextToInteractiveVideoSessionInput({
      userId,
      payload,
      dependencies,
    });
  const payloadHash = buildPayloadHash(normalizedPayload, normalizedWebhookUrl);

  const user = await User.findById(userId).select('generationCredits').lean();
  if (!user) throw buildError('User not found.', 404, 'USER_NOT_FOUND');
  if (!(Number(user.generationCredits) > 0)) {
    throw buildError('Insufficient credits', 402, 'INSUFFICIENT_CREDITS');
  }
  if (apiKeyUsage?.apiKeyId) {
    await assertAPIKeyUsageLimitForDebit(
      userId,
      ADMISSION_CREDIT_FLOOR,
      { apiKeyId: apiKeyUsage.apiKeyId },
    );
  }

  const createBlankSession = dependencies.createNewBlankQuickSession ||
    createNewBlankQuickSession;
  const requestedSessionId = normalizedPayload.sessionId || null;
  let sessionId = requestedSessionId;
  let createdBlankSession = false;
  if (requestedSessionId) {
    sessionId = draftSession._id?.toString?.() || requestedSessionId;
  } else {
    sessionId = await createBlankSession(userId);
    createdBlankSession = true;
  }
  let created;
  try {
    created = await InteractiveVideoRequest.create({
      userId: userId?.toString?.() || String(userId),
      sessionId,
      idempotencyKey: normalizedIdempotencyKey,
      payloadHash,
      payload: normalizedPayload,
      apiKeyUsage,
      webhookUrl: normalizedWebhookUrl,
      status: 'PENDING',
      stage: 'SINGULAR_NARRATIVE',
    });
  } catch (error) {
    if (error?.code !== 11000 || !normalizedIdempotencyKey) throw error;
    // Every contender owns a newly created, still-empty session. If another
    // request won the idempotency-key insert, remove only this losing session
    // so retries cannot accumulate orphaned VideoSession rows.
    if (createdBlankSession) {
      await VideoSession.deleteOne({
        _id: sessionId,
        userId,
        sourceNarrativeRequestId: null,
      }).catch((cleanupError) => {
        console.error('[text_to_interactive_video] blank session cleanup failed', {
          sessionId,
          message: cleanupError?.message || String(cleanupError),
        });
      });
    }
    const existing = await InteractiveVideoRequest.findOne({
      userId: userId?.toString?.() || String(userId),
      idempotencyKey: normalizedIdempotencyKey,
    }).lean();
    if (!existing) throw error;
    return buildTextToInteractiveVideoResponse(
      assertIdempotentPayloadMatches(existing, payloadHash),
    );
  }

  const request = created.toObject();
  await initializeVideoSession({
    sessionId,
    userId,
    requestId: request._id,
    payload: normalizedPayload,
  });
  const queueRequest = dependencies.queueTextToInteractiveVideoRequest ||
    queueTextToInteractiveVideoRequest;
  queueRequest(request._id.toString());
  return buildTextToInteractiveVideoResponse(request);
}

function buildOwnedFilter(requestId, workerLeaseId, extra = {}) {
  return {
    _id: requestId,
    status: 'PROCESSING',
    workerLeaseId,
    ...extra,
  };
}

function isTerminalNarrativeStatus(status) {
  return status === 'COMPLETED' || status === 'FAILED';
}

function throwNarrativeFailure(result, stageLabel) {
  const message = result?.error?.message || `${stageLabel} failed.`;
  const error = buildError(
    message,
    Number(result?.error?.status) || 500,
    result?.error?.code || 'INTERACTIVE_VIDEO_NARRATIVE_FAILED',
  );
  error.narrativeResult = result;
  throw error;
}

async function findNarrativeChild(job, requestType, fieldName) {
  const linkedId = job?.[fieldName];
  if (linkedId) {
    return NarrativeRequest.findOne({
      _id: linkedId,
      userId: job.userId,
      requestType,
    }).lean();
  }
  return NarrativeRequest.findOne({
    interactiveVideoRequestId: job._id,
    userId: job.userId,
    requestType,
  }).sort({ createdAt: 1 }).lean();
}

async function persistChildId(job, workerLeaseId, fieldName, childId) {
  const result = await InteractiveVideoRequest.updateOne(
    buildOwnedFilter(job._id, workerLeaseId),
    { $set: { [fieldName]: childId } },
  );
  if (Number(result?.matchedCount ?? result?.n) === 0) {
    throw buildError(
      'Interactive video request ownership changed while persisting a child request.',
      409,
      'INTERACTIVE_VIDEO_LEASE_LOST',
    );
  }
  job[fieldName] = childId;
}

async function ensureSingularNarrative(job, workerLeaseId, dependencies) {
  let child = await findNarrativeChild(job, 'create_single', 'singularNarrativeRequestId');
  if (!child) {
    const createSingle = dependencies.createSingleNarrativeRequest ||
      createSingleNarrativeRequest;
    let created;
    try {
      created = await createSingle({
        userId: job.userId,
        payload: {
          prompt: job.payload.prompt,
          duration: job.payload.duration,
          inference_model: job.payload.inferenceModel,
          video_model: job.payload.videoModel,
        },
        authContext: job.apiKeyUsage,
        billingPolicy: NARRATIVE_BILLING_POLICIES.INCLUDED_IN_INTERACTIVE_VIDEO_RATE,
        interactiveVideoRequestId: job._id,
        dependencies: {
          queueCreateSingleNarrativeRequest: () => true,
        },
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
    child = created
      ? { _id: created.request_id, status: created.status }
      : await findNarrativeChild(job, 'create_single', 'singularNarrativeRequestId');
    if (!child) {
      throw buildError(
        'Unable to create the singular narrative stage.',
        500,
        'SINGULAR_NARRATIVE_CREATE_FAILED',
      );
    }
  }
  const childId = child._id?.toString?.() || child._id;
  if (!job.singularNarrativeRequestId) {
    await persistChildId(job, workerLeaseId, 'singularNarrativeRequestId', childId);
  }
  if (isTerminalNarrativeStatus(child.status)) {
    const result = child.request_id ? child : buildNarrativeRequestPayload(child);
    if (result.status === 'FAILED') throwNarrativeFailure(result, 'Singular narrative generation');
    return result;
  }
  const processSingle = dependencies.processCreateSingleNarrativeRequest ||
    processCreateSingleNarrativeRequest;
  const result = await processSingle(childId);
  if (result?.status === 'FAILED') throwNarrativeFailure(result, 'Singular narrative generation');
  return result?.status === 'COMPLETED' ? result : null;
}

async function ensureBranchedNarrative(job, workerLeaseId, dependencies) {
  let child = await findNarrativeChild(job, 'create_branching', 'branchedNarrativeRequestId');
  if (!child) {
    const createBranching = dependencies.createBranchingNarrativeRequest ||
      createBranchingNarrativeRequest;
    let created;
    try {
      created = await createBranching({
        userId: job.userId,
        payload: {
          narrative_request_id: job.singularNarrativeRequestId.toString(),
          num_levels: job.payload.numLevels,
          video_model: job.payload.videoModel,
        },
        authContext: job.apiKeyUsage,
        billingPolicy: NARRATIVE_BILLING_POLICIES.INCLUDED_IN_INTERACTIVE_VIDEO_RATE,
        interactiveVideoRequestId: job._id,
        dependencies: {
          queueCreateBranchingNarrativeRequest: () => true,
        },
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
    child = created
      ? { _id: created.request_id, status: created.status }
      : await findNarrativeChild(job, 'create_branching', 'branchedNarrativeRequestId');
    if (!child) {
      throw buildError(
        'Unable to create the branched narrative stage.',
        500,
        'BRANCHED_NARRATIVE_CREATE_FAILED',
      );
    }
  }
  const childId = child._id?.toString?.() || child._id;
  if (!job.branchedNarrativeRequestId) {
    await persistChildId(job, workerLeaseId, 'branchedNarrativeRequestId', childId);
  }
  if (isTerminalNarrativeStatus(child.status)) {
    const result = child.request_id ? child : buildNarrativeRequestPayload(child);
    if (result.status === 'FAILED') throwNarrativeFailure(result, 'Branched narrative generation');
    return result;
  }
  const processBranching = dependencies.processCreateBranchingNarrativeRequest ||
    processCreateBranchingNarrativeRequest;
  const result = await processBranching(childId);
  if (result?.status === 'FAILED') throwNarrativeFailure(result, 'Branched narrative generation');
  return result?.status === 'COMPLETED' ? result : null;
}

async function releaseForRetry(job, workerLeaseId) {
  await InteractiveVideoRequest.updateOne(
    buildOwnedFilter(job._id, workerLeaseId),
    {
      $set: {
        status: 'WAITING',
        nextAttemptAt: new Date(Date.now() + RETRY_DELAY_MS),
        workerLeaseId: null,
        workerLeaseExpiresAt: null,
      },
    },
  );
}

async function updateStage(job, workerLeaseId, stage) {
  const result = await InteractiveVideoRequest.updateOne(
    buildOwnedFilter(job._id, workerLeaseId),
    { $set: { stage, nextAttemptAt: null } },
  );
  if (Number(result?.matchedCount ?? result?.n) === 0) {
    throw buildError(
      'Interactive video request ownership changed between stages.',
      409,
      'INTERACTIVE_VIDEO_LEASE_LOST',
    );
  }
  job.stage = stage;
}

async function isVideoSessionAlreadyScheduled(job) {
  const [session, builderRequest] = await Promise.all([
    VideoSession.findById(job.sessionId)
      .select('sourceNarrativeRequestId builderSessionSubType expressGenerationNarrativeReused')
      .lean(),
    ExpressGenerationBuilderRequest.findOne({
      sessionId: job.sessionId.toString(),
      userId: job.userId.toString(),
      routeType: 'text_to_video',
      sessionSubType: 'narrative_video_create',
    })
      .select('status error')
      .lean(),
  ]);
  if (!builderRequest) return false;
  if (builderRequest.status === 'FAILED') {
    throw buildError(
      builderRequest.error?.message || 'The interactive video render builder failed.',
      Number(builderRequest.error?.status) || 500,
      builderRequest.error?.code || 'INTERACTIVE_VIDEO_RENDER_BUILDER_FAILED',
    );
  }
  const sourceId = session?.sourceNarrativeRequestId?.toString?.() ||
    session?.sourceNarrativeRequestId;
  return sourceId === job.branchedNarrativeRequestId?.toString?.() &&
    (session?.expressGenerationNarrativeReused === true ||
      session?.builderSessionSubType === 'narrative_video_create');
}

async function scheduleVideoSession(job, dependencies) {
  if (await isVideoSessionAlreadyScheduled(job)) {
    return { request_id: job.sessionId, session_id: job.sessionId, status: 'PENDING' };
  }
  const createVideo = dependencies.createVideoFromNarrativeRequest ||
    createVideoFromNarrativeRequest;
  return createVideo({
    userId: job.userId,
    payload: {
      narrative_request_id: job.branchedNarrativeRequestId.toString(),
      image_model: job.payload.imageModel,
      video_model: job.payload.videoModel,
      aspectRatio: normalizeBranchedVideoAspectRatio({
        aspectRatio: job.payload.aspectRatio || DEFAULT_BRANCHED_VIDEO_ASPECT_RATIO,
      }),
    },
    webhookUrl: job.webhookUrl,
    destinationSessionId: job.sessionId,
    authContext: job.apiKeyUsage,
  });
}

async function markFailed(job, workerLeaseId, error) {
  const errorStatus = getErrorStatus(error);
  const errorMessage = normalizeString(error?.message).slice(0, 2000) ||
    'Interactive video generation failed.';
  const ownedUpdate = await InteractiveVideoRequest.updateOne(
    buildOwnedFilter(job._id, workerLeaseId),
    {
      $set: {
        status: 'FAILED',
        stage: 'FAILED',
        failedAt: new Date(),
        errorMessage,
        errorCode: normalizeString(error?.code) || null,
        errorStatus,
        workerLeaseId: null,
        workerLeaseExpiresAt: null,
        nextAttemptAt: null,
      },
    },
  );
  if (Number(ownedUpdate?.matchedCount ?? ownedUpdate?.n) === 0) {
    return false;
  }
  await VideoSession.findByIdAndUpdate(job.sessionId, {
    $set: {
      expressGenerationPending: false,
      expressGenerationFailed: true,
      videoGenerationPending: false,
      expressGenerationError: errorMessage,
      builderStatus: 'FAILED',
      'expressGenerationStatus.status': 'FAILED',
      'expressGenerationStatus.prompt_generation': 'FAILED',
    },
  });
  await upsertGlobalSessionMapping({
    sessionId: job.sessionId,
    sessionType: 'video',
    requestId: job.sessionId,
    provider: job.payload.videoModel,
    userId: job.userId,
    status: 'FAILED',
    errorMessage,
    requestType: 'API',
    sessionSubType: 'interactive_video_create',
  });
  return true;
}

export async function processTextToInteractiveVideoRequest(requestId, dependencies = {}) {
  await getDBConnectionString();
  const now = new Date();
  const workerLeaseId = randomUUID();
  const job = await InteractiveVideoRequest.findOneAndUpdate(
    {
      _id: requestId,
      $or: [
        { status: 'PENDING' },
        {
          status: 'WAITING',
          $or: [
            { nextAttemptAt: null },
            { nextAttemptAt: { $lte: now } },
          ],
        },
        {
          status: 'PROCESSING',
          $or: [
            { workerLeaseExpiresAt: null },
            { workerLeaseExpiresAt: { $lte: now } },
          ],
        },
      ],
    },
    {
      $set: {
        status: 'PROCESSING',
        workerLeaseId,
        workerLeaseExpiresAt: new Date(now.getTime() + WORKER_LEASE_MS),
        startedAt: now,
        nextAttemptAt: null,
        errorMessage: null,
        errorCode: null,
        errorStatus: null,
      },
      $inc: { processingAttempts: 1 },
    },
    { new: true },
  ).lean();
  if (!job) return null;

  const heartbeat = setInterval(() => {
    void InteractiveVideoRequest.updateOne(
      buildOwnedFilter(job._id, workerLeaseId),
      {
        $set: {
          workerLeaseExpiresAt: new Date(Date.now() + WORKER_LEASE_MS),
        },
      },
    ).catch((error) => {
      console.error('[text_to_interactive_video] heartbeat failed', {
        requestId,
        message: error?.message || String(error),
      });
    });
  }, Math.floor(WORKER_LEASE_MS / 3));
  heartbeat.unref?.();

  try {
    if (job.stage === 'SINGULAR_NARRATIVE') {
      const singular = await ensureSingularNarrative(job, workerLeaseId, dependencies);
      if (!singular) {
        await releaseForRetry(job, workerLeaseId);
        return null;
      }
      await updateStage(job, workerLeaseId, 'BRANCHED_NARRATIVE');
    }

    if (job.stage === 'BRANCHED_NARRATIVE') {
      const branched = await ensureBranchedNarrative(job, workerLeaseId, dependencies);
      if (!branched) {
        await releaseForRetry(job, workerLeaseId);
        return null;
      }
      await updateStage(job, workerLeaseId, 'VIDEO_SESSION');
    }

    if (job.stage === 'VIDEO_SESSION') {
      const videoResult = await scheduleVideoSession(job, dependencies);
      const returnedSessionId = videoResult?.session_id || videoResult?.request_id;
      if (returnedSessionId && returnedSessionId.toString() !== job.sessionId.toString()) {
        throw buildError(
          'The interactive workflow created an unexpected destination video session.',
          500,
          'INTERACTIVE_VIDEO_SESSION_MISMATCH',
        );
      }
    }

    const completed = await InteractiveVideoRequest.findOneAndUpdate(
      buildOwnedFilter(job._id, workerLeaseId),
      {
        $set: {
          status: 'COMPLETED',
          stage: 'COMPLETED',
          completedAt: new Date(),
          workerLeaseId: null,
          workerLeaseExpiresAt: null,
          nextAttemptAt: null,
          errorMessage: null,
          errorCode: null,
          errorStatus: null,
        },
      },
      { new: true },
    ).lean();
    await VideoSession.findByIdAndUpdate(job.sessionId, {
      $set: {
        interactiveVideoRequestId: job._id,
        sourceSingularNarrativeRequestId: job.singularNarrativeRequestId,
        builderRouteType: 'text_to_interactive_video',
      },
    });
    return completed ? buildTextToInteractiveVideoResponse(completed) : null;
  } catch (error) {
    if (error?.code === 'INTERACTIVE_VIDEO_LEASE_LOST') return null;
    await markFailed(job, workerLeaseId, error);
    return null;
  } finally {
    clearInterval(heartbeat);
  }
}

function deferRequest(requestId, delayMs = 0) {
  const start = () => {
    void processTextToInteractiveVideoRequest(requestId)
      .catch((error) => {
        console.error('[text_to_interactive_video] async worker failed', {
          requestId,
          message: error?.message || String(error),
        });
      })
      .finally(() => {
        queuedRequestIds.delete(requestId);
      });
  };
  if (delayMs > 0) {
    const timeout = setTimeout(start, delayMs);
    timeout.unref?.();
    return;
  }
  setImmediate(start);
}

export function queueTextToInteractiveVideoRequest(requestId, { delayMs = 0 } = {}) {
  const normalizedRequestId = requestId?.toString?.() || String(requestId);
  if (queuedRequestIds.has(normalizedRequestId)) return false;
  queuedRequestIds.add(normalizedRequestId);
  deferRequest(normalizedRequestId, delayMs);
  return true;
}

export async function recoverTextToInteractiveVideoRequests({ limit = 20 } = {}) {
  await getDBConnectionString();
  await ensureIndexes();
  const now = new Date();
  const requests = await InteractiveVideoRequest.find({
    $or: [
      { status: 'PENDING' },
      {
        status: 'WAITING',
        $or: [
          { nextAttemptAt: null },
          { nextAttemptAt: { $lte: now } },
        ],
      },
      {
        status: 'PROCESSING',
        $or: [
          { workerLeaseExpiresAt: null },
          { workerLeaseExpiresAt: { $lte: now } },
        ],
      },
    ],
  })
    .select('_id')
    .sort({ createdAt: 1 })
    .limit(limit)
    .lean();
  for (const request of requests) {
    queueTextToInteractiveVideoRequest(request._id.toString());
  }
  return requests.length;
}

export function startTextToInteractiveVideoRecovery() {
  if (recoveryInterval) return () => {};
  const recover = () => {
    void recoverTextToInteractiveVideoRequests().catch((error) => {
      console.error('[text_to_interactive_video] recovery scan failed', {
        message: error?.message || String(error),
      });
    });
  };
  recover();
  recoveryInterval = setInterval(recover, RECOVERY_INTERVAL_MS);
  recoveryInterval.unref?.();
  return () => {
    clearInterval(recoveryInterval);
    recoveryInterval = null;
  };
}

export const __testOnly__ = {
  ADMISSION_CREDIT_FLOOR,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  RECOVERY_INTERVAL_MS,
  RETRY_DELAY_MS,
  WORKER_LEASE_MS,
  buildPayloadHash,
  initializeVideoSession,
  isVideoSessionAlreadyScheduled,
  markFailed,
  queuedRequestIds,
};
