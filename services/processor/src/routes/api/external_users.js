import express from 'express';
import Stripe from 'stripe';
import mongoose from 'mongoose';

import ExternalUser from '../../schema/ExternalUser.js';
import User from '../../schema/User.js';
import GlobalSession from '../../schema/GlobalSession.js';
import VideoSession from '../../schema/VideoSession.js';
import { getDBConnectionString } from '../../models/DBString.js';
import {
  stripDeprecatedVideoModelSubtypeOptions,
  validateExpressImageModelKey,
  validateMovieInput,
} from '../../models/api/PromptUtils.js';
import {
  normalizeImageListFooterAnimationOptions,
  normalizeImageListExpressCtaGenerationOptions,
  normalizeImageListNarratorAvatarOptions,
  normalizeImageListInput,
  assertImageListToVideoUrlsAreFetchable,
  requestCreateVideo,
  requestCreateVideoFromImageListAndMetadata,
} from '../../models/api/MovieAPI.js';
import {
  createAssistantCompletion,
  setAssistantSystemPromptForUser,
} from '../../models/api/AssistantAPI.js';
import { createLoginTokenForUser } from '../../models/api/UserAPI.js';
import { chargeExternalUserUtilityUsage } from '../../models/api/ExternalUserUtilityAPI.js';
import { uploadImageDataList } from '../../models/api/ImageUploadAPI.js';
import { buildVideoStatusDetailedResponse } from '../../models/api/StatusAPI.js';
import { createEmbeddingsFromPlainText } from '../../models/embeddings/EmbeddingService.js';
import {
  normalizeOutroCtaImageFromPayload,
  normalizeOutroCtaImageTextFieldsFromPayload,
} from '../../utils/OutroCtaImagePayload.js';
import {
  getJoinVideosBillingPreview,
  joinVideoSessionsAndQueueGeneration,
} from '../../models/api/VideoSessionJoinAPI.js';
import {
  IMAGE_LIST_TO_VIDEO_VIDEO_MODEL_ERROR_MESSAGE,
  normalizeImageListToVideoModel,
} from '../../consts/ImageListToVideoModels.js';
import {
  getTranslateVideoBillingPreview,
  translateVideoSessionAndQueueGeneration,
} from '../../models/api/VideoSessionTranslateAPI.js';
import {
  ADD_OUTRO_IMAGE_CREDITS,
  UPDATE_FOOTER_IMAGE_CREDITS,
  UPDATE_OUTRO_IMAGE_CREDITS,
  addOutroImageAndQueueRender,
  updateFooterImageAndQueueRender,
  updateOutroImageAndQueueRender,
} from '../../models/api/VideoSessionOutroAPI.js';
import { purchaseCreditsForUser } from '../../models/Payment.js';
import {
  archiveExternalUserRequest,
  buildExternalStatusResponse,
  createExternalLoginTokenForUser,
  createExternalPaymentRecord,
  createExternalRequestRecord,
  ensureInternalMappedExternalUser,
  ensureExternalUserApiKey,
  createExternalAssistantSession,
  findExternalPaymentForInternalUser,
  findExternalRequestForInternalUser,
  findExternalRequestsForInternalUser,
  formatExternalUser,
  listExternalUserRequests,
  getExternalCreditsBalance,
  grantExternalUserCredits,
  linkExternalRequestToSession,
  markExternalPaymentResolved,
  markExternalRequestAccepted,
  markExternalRequestFailed,
  publishExternalUserRequest,
  refundExternalRequestCredits,
  reserveExternalRequestCredits,
  resolveExternalUserFromAuthHeaders,
  resolveInternalUserIdFromAuthHeaders,
  resolveRequestActorFromAuthHeaders,
  sanitizeExternalFacingPayload,
  syncExternalRequestWithUpstreamStatus,
  normalizeExternalUserPayload,
  upsertExternalUser,
} from '../../models/external/User.js';

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const EXTERNAL_RECHARGE_ENDPOINT = '/v1/external_users/credits/recharge';

const INSUFFICIENT_CREDITS_MESSAGE =
  `Insufficient credits or no credits remaining for this external user. Please call ${EXTERNAL_RECHARGE_ENDPOINT} ` +
  'to purchase more credits.';

function normalizeInputPayload(req) {
  return req.body?.input ?? req.body ?? {};
}

function getFieldOptionsFromBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }

  return (
    body.field_options ||
    body.fieldOptions ||
    body.field_config ||
    body.fieldConfig ||
    body.field_flags ||
    body.fieldFlags ||
    body.column_types ||
    body.columnTypes
  );
}

function getEmbeddingTtlMinutesFromBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }

  const rawValue = body.ttl_minutes ?? body.ttlMinutes;
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return null;
  }

  const parsed = typeof rawValue === 'string' ? Number(rawValue.trim()) : Number(rawValue);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    const error = new Error('ttl_minutes must be a positive integer number of minutes.');
    error.statusCode = 400;
    throw error;
  }

  return parsed;
}

function getPlainTextDataFromBody(body) {
  if (typeof body === 'string' || Array.isArray(body)) {
    return body;
  }

  if (!body || typeof body !== 'object') {
    return null;
  }

  const candidate =
    body.plain_text ??
    body.plainText ??
    body.plain_texts ??
    body.plainTexts ??
    body.texts ??
    body.documents ??
    body.items ??
    body.entries;

  if (candidate !== undefined && candidate !== null) {
    return candidate;
  }

  if (
    typeof body.content === 'string' ||
    typeof body.text === 'string' ||
    typeof body.markdown === 'string' ||
    typeof body.cleaned_text === 'string' ||
    typeof body.cleanedText === 'string'
  ) {
    return body;
  }

  return null;
}

function getEnableSubtitlesOption(payload) {
  if (!payload || typeof payload !== 'object') {
    return { value: false, provided: false };
  }

  const provided = Object.prototype.hasOwnProperty.call(payload, 'enable_subtitles')
    || Object.prototype.hasOwnProperty.call(payload, 'enableSubtitles')
    || Object.prototype.hasOwnProperty.call(payload, 'add_subtitles')
    || Object.prototype.hasOwnProperty.call(payload, 'addSubtitles');
  if (!provided) {
    return { value: false, provided: false };
  }

  const value =
    payload.enable_subtitles ??
    payload.enableSubtitles ??
    payload.add_subtitles ??
    payload.addSubtitles;
  if (typeof value !== 'boolean') {
    return { error: 'enable_subtitles/add_subtitles must be a boolean.' };
  }

  return { value, provided: true };
}

function normalizeOptionalString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeOptionalPayloadString(value, fieldName) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    const error = new Error(`${fieldName} must be a string when provided.`);
    error.status = 400;
    throw error;
  }
  return normalizeOptionalString(value);
}

function isHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return false;
  }
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function hasExternalUserRouteSignal(req) {
  return Boolean(
    req.externalUser ||
    req.body?.external_user ||
    req.body?.externalUser ||
    req.body?.input?.external_user ||
    req.body?.input?.externalUser,
  );
}

function getSourceSessionIdFromRequestPayload(requestPayload = {}) {
  return (
    normalizeOptionalString(requestPayload.source_request_id) ||
    normalizeOptionalString(requestPayload.sourceRequestId) ||
    normalizeOptionalString(requestPayload.request_id) ||
    normalizeOptionalString(requestPayload.requestId) ||
    normalizeOptionalString(requestPayload.external_request_id) ||
    normalizeOptionalString(requestPayload.externalRequestId) ||
    normalizeOptionalString(requestPayload.external_session_id) ||
    normalizeOptionalString(requestPayload.externalSessionId) ||
    normalizeOptionalString(requestPayload.video_session_id) ||
    normalizeOptionalString(requestPayload.videoSessionId) ||
    normalizeOptionalString(requestPayload.session_id) ||
    normalizeOptionalString(requestPayload.sessionId)
  );
}

async function findOwnedInternalVideoSession(userId, sessionId) {
  const normalizedSessionId = normalizeOptionalString(sessionId);
  if (!normalizedSessionId) {
    return null;
  }

  await getDBConnectionString();
  const globalSession = await GlobalSession.findOne({
    sessionType: 'video',
    userId: userId?.toString?.() || userId,
    $or: [
      { sessionId: normalizedSessionId },
      { requestId: normalizedSessionId },
      { apiSessionId: normalizedSessionId },
    ],
  })
    .select('sessionId')
    .lean();
  const upstreamSessionId = globalSession?.sessionId || normalizedSessionId;

  if (!upstreamSessionId || !mongoose.Types.ObjectId.isValid(upstreamSessionId)) {
    return null;
  }

  return VideoSession.findOne({
    _id: upstreamSessionId,
    userId: userId?.toString?.() || userId,
  })
    .select('_id externalRequestId externalRequestUserId isExternalUserRequest')
    .lean();
}

function isExternalOwnedVideoSession(sessionDoc) {
  return Boolean(
    sessionDoc?.externalRequestId ||
    sessionDoc?.externalRequestUserId ||
    sessionDoc?.isExternalUserRequest,
  );
}

async function shouldUseInternalVideoSessionRoute(req, sessionId) {
  if (hasExternalUserRouteSignal(req)) {
    return false;
  }

  const normalizedSessionId = normalizeOptionalString(sessionId);
  if (!normalizedSessionId) {
    return false;
  }

  const externalRequest = await findExternalRequestForInternalUser({
    internalUserId: req.userId?.toString?.() || req.userId,
    requestId: normalizedSessionId,
    externalUserId: null,
  });
  if (externalRequest) {
    return false;
  }

  const sessionDoc = await findOwnedInternalVideoSession(req.userId, sessionId);
  if (!sessionDoc || isExternalOwnedVideoSession(sessionDoc)) {
    return false;
  }

  const upstreamExternalRequest = await findExternalRequestForInternalUser({
    internalUserId: req.userId?.toString?.() || req.userId,
    requestId: sessionDoc._id?.toString?.() || sessionDoc._id,
    externalUserId: null,
  });
  return !upstreamExternalRequest;
}

async function shouldUseInternalVideoSessionsRoute(req, sessionIds = []) {
  if (hasExternalUserRouteSignal(req)) {
    return false;
  }

  const normalizedSessionIds = Array.isArray(sessionIds)
    ? sessionIds.map((value) => normalizeOptionalString(value)).filter(Boolean)
    : [];

  if (!normalizedSessionIds.length) {
    return false;
  }

  const externalRequests = await findExternalRequestsForInternalUser({
    internalUserId: req.userId?.toString?.() || req.userId,
    requestIds: normalizedSessionIds,
    externalUserId: null,
  });
  if (externalRequests.length > 0) {
    return false;
  }

  const sessionDocs = await Promise.all(
    normalizedSessionIds.map((sessionId) => findOwnedInternalVideoSession(req.userId, sessionId)),
  );
  if (!sessionDocs.every((sessionDoc) => sessionDoc && !isExternalOwnedVideoSession(sessionDoc))) {
    return false;
  }

  const upstreamSessionIds = sessionDocs
    .map((sessionDoc) => sessionDoc._id?.toString?.() || sessionDoc._id)
    .filter(Boolean);
  const upstreamExternalRequests = await findExternalRequestsForInternalUser({
    internalUserId: req.userId?.toString?.() || req.userId,
    requestIds: upstreamSessionIds,
    externalUserId: null,
  });
  return upstreamExternalRequests.length === 0;
}

function setGenerationCreditHeaders(res, response) {
  if (response?.creditsCharged !== undefined) {
    res.set('x-credits-charged', response.creditsCharged.toString());
  }
  if (response?.remainingCredits !== undefined && response?.remainingCredits !== null) {
    res.set('x-credits-remaining', response.remainingCredits.toString());
  }
}

async function resolveExternalRouteSourceRequest({
  req,
  requestId,
}) {
  const explicitExternalUser = hasExternalUserRouteSignal(req)
    ? await resolveExternalUserContext(req)
    : null;

  if (explicitExternalUser) {
    return resolveExternalSourceRequest({
      internalUserId: req.userId,
      externalUser: explicitExternalUser,
      requestId,
    }).then((resolved) => ({
      ...resolved,
      externalUser: explicitExternalUser,
    }));
  }

  if (req.authType === 'customer_sub_account_api_key') {
    const scopedExternalUser = await resolveExternalUserContext(req);
    return resolveExternalSourceRequest({
      internalUserId: req.userId,
      externalUser: scopedExternalUser,
      requestId,
    }).then((resolved) => ({
      ...resolved,
      externalUser: scopedExternalUser,
    }));
  }

  const sourceRequest = await findExternalRequestForInternalUser({
    internalUserId: req.userId,
    requestId,
    externalUserId: null,
  });

  if (!sourceRequest) {
    const error = new Error('Source video was not found for this external user.');
    error.status = 404;
    throw error;
  }

  const externalUser = sourceRequest.externalUserId;
  if (!externalUser?._id) {
    const error = new Error('Source video is missing its external user mapping.');
    error.status = 409;
    throw error;
  }

  const sourceSessionId =
    normalizeOptionalString(sourceRequest.upstreamSessionId) ||
    normalizeOptionalString(sourceRequest.upstreamRequestId);
  if (!sourceSessionId) {
    const error = new Error('Source video is missing its upstream session mapping.');
    error.status = 409;
    throw error;
  }

  return {
    externalUser,
    sourceRequest,
    sourceSessionId,
  };
}

async function resolveExternalRouteSourceRequests({
  req,
  requestIds,
}) {
  const explicitExternalUser = hasExternalUserRouteSignal(req)
    ? await resolveExternalUserContext(req)
    : null;

  if (explicitExternalUser) {
    const resolved = await resolveExternalSourceRequests({
      internalUserId: req.userId,
      externalUser: explicitExternalUser,
      requestIds,
    });
    return {
      ...resolved,
      externalUser: explicitExternalUser,
    };
  }

  if (req.authType === 'customer_sub_account_api_key') {
    const scopedExternalUser = await resolveExternalUserContext(req);
    const resolved = await resolveExternalSourceRequests({
      internalUserId: req.userId,
      externalUser: scopedExternalUser,
      requestIds,
    });
    return {
      ...resolved,
      externalUser: scopedExternalUser,
    };
  }

  const normalizedRequestIds = Array.isArray(requestIds)
    ? requestIds.map((value) => normalizeOptionalString(value)).filter(Boolean)
    : [];
  const { sourceRequests, sourceSessionIds } = await resolveExternalSourceRequests({
    internalUserId: req.userId,
    externalUser: null,
    requestIds: normalizedRequestIds,
  });
  const externalUsers = sourceRequests
    .map((sourceRequest) => sourceRequest.externalUserId)
    .filter((externalUser) => externalUser?._id);
  const externalUserIds = new Set(externalUsers.map((externalUser) => externalUser._id.toString()));

  if (externalUserIds.size !== 1) {
    const error = new Error('session_ids must belong to the same external user.');
    error.status = 400;
    throw error;
  }

  return {
    normalizedRequestIds,
    sourceRequests,
    sourceSessionIds,
    externalUser: externalUsers[0],
  };
}

function hasExplicitExternalIdentityPayload(payloadSource = {}) {
  const normalized = normalizeExternalUserPayload(payloadSource);
  return Boolean(normalized.provider && normalized.externalUserId);
}

function buildAcceptedExternalResponse({
  externalRequestId,
  upstreamResponse,
  creditsCharged,
}) {
  const sanitizedUpstreamResponse = sanitizeExternalFacingPayload(upstreamResponse);
  const sanitizedUpstreamResponseObject =
    sanitizedUpstreamResponse &&
    typeof sanitizedUpstreamResponse === 'object' &&
    !Array.isArray(sanitizedUpstreamResponse)
      ? sanitizedUpstreamResponse
      : {};

  return {
    ...sanitizedUpstreamResponseObject,
    request_id: externalRequestId,
    session_id: externalRequestId,
    external_request_id: externalRequestId,
    external_session_id: externalRequestId,
    status_endpoint: `/v1/external_users/status?request_id=${encodeURIComponent(externalRequestId)}`,
    creditsCharged,
  };
}

function setCreditHeaders(res, creditsCharged, remainingCredits) {
  if (creditsCharged !== undefined && creditsCharged !== null) {
    res.set('x-credits-charged', String(creditsCharged));
  }
  if (remainingCredits !== undefined && remainingCredits !== null) {
    res.set('x-credits-remaining', String(remainingCredits));
  }
}

function buildInsufficientCreditsPayload() {
  return {
    code: 'insufficient_credits',
    message: INSUFFICIENT_CREDITS_MESSAGE,
    creditsRemaining: 0,
    rechargeEndpoint: EXTERNAL_RECHARGE_ENDPOINT,
  };
}

function respondInsufficientCredits(res) {
  setCreditHeaders(res, 0, 0);
  return res.status(402).json(buildInsufficientCreditsPayload());
}

async function loadExternalCreditState(externalUser) {
  const refreshedExternalUser = externalUser?._id
    ? await ExternalUser.findById(externalUser._id)
    : null;
  const resolvedExternalUser = refreshedExternalUser ?? externalUser ?? null;

  return {
    externalUser: resolvedExternalUser,
    remainingCredits:
      resolvedExternalUser?.generationCredits === undefined ||
      resolvedExternalUser?.generationCredits === null
        ? null
        : Number(resolvedExternalUser.generationCredits) || 0,
  };
}

function normalizePaymentStatusPayload(payloadSource = {}) {
  return {
    externalPaymentId:
      normalizeOptionalString(payloadSource.external_payment_id) ||
      normalizeOptionalString(payloadSource.externalPaymentId),
    checkoutSessionId:
      normalizeOptionalString(payloadSource.checkoutSessionId) ||
      normalizeOptionalString(payloadSource.checkout_session_id),
    paymentIntentId:
      normalizeOptionalString(payloadSource.paymentIntentId) ||
      normalizeOptionalString(payloadSource.payment_intent_id),
    setupIntentId:
      normalizeOptionalString(payloadSource.setupIntentId) ||
      normalizeOptionalString(payloadSource.setup_intent_id),
  };
}

async function resolveExternalSourceRequest({
  internalUserId,
  externalUser,
  requestId,
}) {
  const sourceRequest = await findExternalRequestForInternalUser({
    internalUserId,
    requestId,
    externalUserId: externalUser?._id ?? null,
  });

  if (!sourceRequest) {
    const error = new Error('Source video was not found for this external user.');
    error.status = 404;
    throw error;
  }

  const sourceSessionId =
    normalizeOptionalString(sourceRequest.upstreamSessionId) ||
    normalizeOptionalString(sourceRequest.upstreamRequestId);
  if (!sourceSessionId) {
    const error = new Error('Source video is missing its upstream session mapping.');
    error.status = 409;
    throw error;
  }

  return {
    sourceRequest,
    sourceSessionId,
  };
}

async function resolveExternalSourceRequests({
  internalUserId,
  externalUser,
  requestIds,
}) {
  const normalizedRequestIds = Array.isArray(requestIds)
    ? requestIds
      .map((value) => normalizeOptionalString(value))
      .filter(Boolean)
    : [];

  if (normalizedRequestIds.length < 2) {
    const error = new Error('session_ids must contain at least 2 non-empty values.');
    error.status = 400;
    throw error;
  }

  if (new Set(normalizedRequestIds).size !== normalizedRequestIds.length) {
    const error = new Error('session_ids must not contain duplicates.');
    error.status = 400;
    throw error;
  }

  const requestRecords = await findExternalRequestsForInternalUser({
    internalUserId,
    requestIds: normalizedRequestIds,
    externalUserId: externalUser?._id ?? null,
  });
  const requestLookup = new Map();

  for (const requestRecord of requestRecords) {
    const externalRequestId = normalizeOptionalString(requestRecord.externalRequestId);
    const keys = [
      externalRequestId,
      externalRequestId?.startsWith('extreq_') ? externalRequestId.slice('extreq_'.length) : null,
      normalizeOptionalString(requestRecord.upstreamRequestId),
      normalizeOptionalString(requestRecord.upstreamSessionId),
    ].filter(Boolean);

    for (const key of keys) {
      if (!requestLookup.has(key)) {
        requestLookup.set(key, requestRecord);
      }
    }
  }

  const unresolvedRequestIds = normalizedRequestIds.filter((requestId) => !requestLookup.has(requestId));
  if (unresolvedRequestIds.length) {
    await getDBConnectionString();
    const unresolvedObjectIds = unresolvedRequestIds.filter((requestId) => mongoose.Types.ObjectId.isValid(requestId));
    const externalRequestLookupIds = [
      ...new Set(unresolvedRequestIds.flatMap((requestId) => {
        const normalized = normalizeOptionalString(requestId);
        return [
          normalized,
          normalized?.startsWith('extreq_') ? normalized.slice('extreq_'.length) : null,
        ].filter(Boolean);
      })),
    ];
    const fallbackSessionQuery = {
      userId: internalUserId?.toString?.() || internalUserId,
      isExternalUserRequest: true,
      ...(externalUser?._id ? { externalRequestUserId: externalUser._id.toString() } : {}),
      $or: [
        ...(unresolvedObjectIds.length ? [{ _id: { $in: unresolvedObjectIds } }] : []),
        { externalRequestId: { $in: externalRequestLookupIds } },
      ],
    };
    const fallbackSessions = fallbackSessionQuery.$or.length
      ? await VideoSession.find(fallbackSessionQuery)
        .select('_id externalRequestId externalRequestUserId externalRequestIdentityKey')
        .lean()
      : [];
    const fallbackExternalUserIds = [
      ...new Set(
        fallbackSessions
          .map((sessionDoc) => normalizeOptionalString(sessionDoc.externalRequestUserId))
          .filter(Boolean),
      ),
    ];
    const fallbackExternalUsers = externalUser?._id
      ? [externalUser]
      : await ExternalUser.find({ _id: { $in: fallbackExternalUserIds } }).lean();
    const fallbackExternalUserLookup = new Map(
      fallbackExternalUsers.map((fallbackExternalUser) => [
        fallbackExternalUser._id?.toString?.() || fallbackExternalUser._id,
        fallbackExternalUser,
      ]),
    );

    for (const sessionDoc of fallbackSessions) {
      const externalRequestId = normalizeOptionalString(sessionDoc.externalRequestId);
      const upstreamSessionId = sessionDoc._id?.toString?.() || sessionDoc._id;
      const fallbackRecord = {
        externalRequestId: externalRequestId || upstreamSessionId,
        upstreamRequestId: upstreamSessionId,
        upstreamSessionId,
        externalUserId:
          fallbackExternalUserLookup.get(normalizeOptionalString(sessionDoc.externalRequestUserId)) ||
          externalUser ||
          null,
      };
      const keys = [
        externalRequestId,
        externalRequestId?.startsWith('extreq_') ? externalRequestId.slice('extreq_'.length) : null,
        upstreamSessionId,
      ].filter(Boolean);

      for (const key of keys) {
        if (!requestLookup.has(key)) {
          requestLookup.set(key, fallbackRecord);
        }
      }
    }
  }

  const orderedSourceRequests = normalizedRequestIds.map((requestId) => requestLookup.get(requestId));
  if (orderedSourceRequests.some((requestRecord) => !requestRecord)) {
    const error = new Error('One or more source videos were not found for this external user.');
    error.status = 404;
    throw error;
  }

  const resolved = orderedSourceRequests.map((sourceRequest) => ({
    sourceRequest,
    sourceSessionId:
      normalizeOptionalString(sourceRequest.upstreamSessionId) ||
      normalizeOptionalString(sourceRequest.upstreamRequestId),
  }));

  if (resolved.some((entry) => !entry.sourceSessionId)) {
    const error = new Error('One or more source videos are missing their upstream session mapping.');
    error.status = 409;
    throw error;
  }

  const sourceSessionIds = resolved.map((entry) => entry.sourceSessionId);
  if (new Set(sourceSessionIds).size !== sourceSessionIds.length) {
    const error = new Error('session_ids must resolve to distinct source videos.');
    error.status = 400;
    throw error;
  }

  return {
    normalizedRequestIds,
    sourceRequests: resolved.map((entry) => entry.sourceRequest),
    sourceSessionIds,
  };
}

async function authenticateExternalRequest(req, res, next) {
  try {
    const authContext = await resolveRequestActorFromAuthHeaders(req.headers);
    req.userId = authContext.internalUserId;
    req.authType = authContext.authType;
    req.customerSubAccount = authContext.customerSubAccount || null;
    req.externalUser =
      authContext.externalUser
      || await resolveExternalUserFromAuthHeaders({
        internalUserId: authContext.internalUserId,
        headers: req.headers,
      });
    next();
  } catch (error) {
    if (
      error?.code === 'API_KEY_EXPIRED' ||
      error?.code === 'CUSTOMER_SUB_ACCOUNT_API_KEY_EXPIRED' ||
      error?.code === 'APP_KEY_EXPIRED'
    ) {
      return res.status(401).json({ message: error.message });
    }

    return res.status(error?.status || 500).json({
      message: error?.message || 'Internal server error while validating API key, auth token, or APP_KEY.',
    });
  }
}

async function resolveExternalUserContext(req, { allowCreate = true } = {}) {
  const externalUserFromHeaders = req.externalUser || await resolveExternalUserFromAuthHeaders({
    internalUserId: req.userId,
    headers: req.headers,
  });

  if (externalUserFromHeaders) {
    return externalUserFromHeaders;
  }

  const payloadSource = req.body ?? req.query ?? {};
  if (
    req.authType === 'customer_sub_account_api_key' &&
    !hasExplicitExternalIdentityPayload(payloadSource)
  ) {
    const error = new Error('external_user is required when using a customer sub-account internal API key.');
    error.status = 400;
    throw error;
  }

  if (req.authType === 'auth_token' && !hasExplicitExternalIdentityPayload(payloadSource)) {
    return ensureInternalMappedExternalUser({
      internalUserId: req.userId,
      externalUserPayload: payloadSource,
    });
  }

  if (!allowCreate) {
    const error = new Error('External user API key is required for this request.');
    error.status = 401;
    throw error;
  }

  return upsertExternalUser({
    internalUserId: req.userId,
    externalUserPayload: req.body ?? req.query ?? {},
    customerSubAccount: req.customerSubAccount || null,
  });
}

async function maybeResolveExternalUserFromHeaders(req) {
  return req.externalUser || resolveExternalUserFromAuthHeaders({
    internalUserId: req.userId,
    headers: req.headers,
  });
}

router.post('/session', authenticateExternalRequest, async (req, res) => {
  try {
    const payload = normalizeInputPayload(req);
    const externalUser = await resolveExternalUserContext(req);
    const shouldIssueExternalApiKey =
      req.authType !== 'customer_sub_account_api_key' &&
      (req.authType !== 'auth_token' || hasExplicitExternalIdentityPayload(payload));
    const externalUserWithApiKey =
      shouldIssueExternalApiKey
        ? await ensureExternalUserApiKey(externalUser)
        : externalUser;
    const responsePayload = await getExternalCreditsBalance({
      externalUser: externalUserWithApiKey,
    });

    if (responsePayload.remainingCredits !== undefined && responsePayload.remainingCredits !== null) {
      res.set('x-credits-remaining', responsePayload.remainingCredits.toString());
    }

    return res.status(200).json({
      external_api_key: externalUserWithApiKey?.externalApiKey ?? null,
      external_user: formatExternalUser(externalUserWithApiKey),
      ...responsePayload,
    });
  } catch (error) {
    return res.status(error?.status || 500).json({
      message: error?.message || 'Internal server error while creating external user session.',
    });
  }
});

router.post('/create_login_token', authenticateExternalRequest, async (req, res) => {
  try {
    const externalUser = await resolveExternalUserContext(req);
    const clientAppBase = (process.env.CLIENT_APP || 'https://app.samsar.one').replace(/\/$/, '');
    const redirectPathRaw = normalizeOptionalString(req.body?.redirect || req.body?.input?.redirect);
    const redirectPath = redirectPathRaw && redirectPathRaw.startsWith('/') && !redirectPathRaw.startsWith('//')
      ? redirectPathRaw
      : req.authType === 'auth_token'
        ? '/'
        : '/external/studio';
    const loginTokenData = req.authType === 'auth_token'
      ? createLoginTokenForUser(req.userId)
      : createExternalLoginTokenForUser(externalUser);
    const loginUrl = `${clientAppBase}/verify?loginToken=${encodeURIComponent(loginTokenData.loginToken)}&redirect=${encodeURIComponent(redirectPath)}`;

    return res.status(200).json({
      ...loginTokenData,
      loginUrl,
      external_user: formatExternalUser(externalUser),
    });
  } catch (error) {
    return res.status(error?.status || 500).json({
      message: error?.message || 'Internal server error while creating external user login token.',
    });
  }
});

router.post('/assistant/set_system_prompt', authenticateExternalRequest, async (req, res) => {
  try {
    const externalUser = await resolveExternalUserContext(req);
    const responsePayload = await setAssistantSystemPromptForUser(
      req.userId,
      req.body || {},
      { externalUser },
    );

    return res.status(200).json({
      ...responsePayload,
      external_user: formatExternalUser(externalUser),
    });
  } catch (error) {
    return res.status(error?.statusCode || error?.status || 500).json({
      message: error?.message || 'Internal server error while updating external user assistant system prompt.',
    });
  }
});

router.post('/assistant/completion', authenticateExternalRequest, async (req, res) => {
  try {
    const externalUser = await resolveExternalUserContext(req);
    const requestPayload = { ...(req.body || {}) };
    const requestedSessionId =
      normalizeOptionalString(requestPayload.session_id) ||
      normalizeOptionalString(requestPayload.sessionId) ||
      normalizeOptionalString(requestPayload.request_id) ||
      normalizeOptionalString(requestPayload.requestId) ||
      normalizeOptionalString(requestPayload.external_session_id) ||
      normalizeOptionalString(requestPayload.externalSessionId) ||
      normalizeOptionalString(requestPayload.external_request_id) ||
      normalizeOptionalString(requestPayload.externalRequestId) ||
      normalizeOptionalString(requestPayload.id);

    if (!requestedSessionId) {
      return res.status(400).json({
        message: 'session_id is required.',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(requestedSessionId)) {
      const { sourceSessionId } = await resolveExternalSourceRequest({
        internalUserId: req.userId,
        externalUser,
        requestId: requestedSessionId,
      });
      requestPayload.session_id = sourceSessionId;
    }

    const result = await createAssistantCompletion(
      req.userId,
      requestPayload,
      { externalUser },
    );
    const externalCreditState = await loadExternalCreditState(externalUser);
    setCreditHeaders(res, result.creditsCharged, externalCreditState.remainingCredits);
    return res.status(200).json(result.openaiResponse);
  } catch (error) {
    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return respondInsufficientCredits(res);
    }

    return res.status(error?.statusCode || error?.status || error?.response?.status || 500).json({
      message: error?.message || 'Internal server error while creating external user assistant completion.',
    });
  }
});

router.post('/utils/assistant_session', authenticateExternalRequest, async (req, res) => {
  try {
    const externalUser = await resolveExternalUserContext(req);
    const payload = normalizeInputPayload(req);
    const responsePayload = await createExternalAssistantSession({
      externalUser,
      sessionName:
        normalizeOptionalString(payload.session_name) ||
        normalizeOptionalString(payload.sessionName),
      metadata:
        payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
          ? payload.metadata
          : null,
    });

    return res.status(200).json(responsePayload);
  } catch (error) {
    return res.status(error?.status || 500).json({
      message: error?.message || 'Internal server error while creating external user assistant session.',
    });
  }
});

router.post('/utils/usage_charge', authenticateExternalRequest, async (req, res) => {
  try {
    const externalUser = await resolveExternalUserContext(req, { allowCreate: false });
    const payload = normalizeInputPayload(req);
    const responsePayload = await chargeExternalUserUtilityUsage({
      externalUser,
      payload,
    });
    const externalCreditState = await loadExternalCreditState(externalUser);
    const sanitizedResponsePayload = sanitizeExternalFacingPayload(responsePayload) || {};

    setCreditHeaders(
      res,
      responsePayload.creditsCharged,
      externalCreditState.remainingCredits,
    );
    return res.status(200).json({
      ...sanitizedResponsePayload,
      remainingCredits: externalCreditState.remainingCredits,
      external_user: formatExternalUser(externalCreditState.externalUser),
      externalUser: formatExternalUser(externalCreditState.externalUser),
    });
  } catch (error) {
    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return respondInsufficientCredits(res);
    }

    return res.status(error?.status || 500).json({
      message: error?.message || 'Internal server error while charging external utility usage.',
    });
  }
});

router.post('/credits/grant', authenticateExternalRequest, async (req, res) => {
  try {
    if (req.authType === 'customer_sub_account_api_key') {
      return res.status(403).json({
        message: 'Customer sub-account API keys cannot grant credits. Purchase Samsar credits on the customer account and send user requests with external_user for audit.',
      });
    }

    const externalUser = await resolveExternalUserContext(req);
    const payload = normalizeInputPayload(req);
    const creditsRaw =
      payload.credits ?? payload.credits_to_grant ?? payload.creditsToGrant;
    const credits = Number(creditsRaw);

    if (!Number.isFinite(credits) || credits <= 0 || !Number.isInteger(credits)) {
      return res.status(400).json({
        message: 'credits is required and must be a positive integer.',
      });
    }

    const grantResult = await grantExternalUserCredits({
      internalUserId: req.userId,
      externalUser,
      credits,
      source: 'manual_grant',
      metadata: {
        route: 'external_users/credits/grant',
      },
    });

    res.set('x-credits-remaining', String(grantResult.remainingCredits));

    return res.status(200).json(grantResult);
  } catch (error) {
    return res.status(error?.status || 500).json({
      message: error?.message || 'Internal server error while granting external user credits.',
    });
  }
});

router.get('/credits', authenticateExternalRequest, async (req, res) => {
  try {
    const externalUser = await resolveExternalUserContext(req);
    const responsePayload = await getExternalCreditsBalance({
      externalUser,
    });

    if (responsePayload.remainingCredits !== undefined && responsePayload.remainingCredits !== null) {
      res.set('x-credits-remaining', responsePayload.remainingCredits.toString());
    }

    return res.status(200).json(responsePayload);
  } catch (error) {
    return res.status(error?.status || 500).json({
      message: error?.message || 'Internal server error while fetching external user credits.',
    });
  }
});

router.get('/requests', authenticateExternalRequest, async (req, res) => {
  try {
    const externalUser = await resolveExternalUserContext(req);
    const limit = Number(req.query.limit);
    const requests = await listExternalUserRequests({
      externalUser,
      limit,
      req,
    });

    return res.status(200).json({
      requests,
      external_user: formatExternalUser(externalUser),
    });
  } catch (error) {
    return res.status(error?.status || 500).json({
      message: error?.message || 'Internal server error while fetching external user requests.',
    });
  }
});

router.post('/archive', authenticateExternalRequest, async (req, res) => {
  try {
    const externalUser = await resolveExternalUserContext(req);
    const payload = normalizeInputPayload(req);
    const requestId =
      normalizeOptionalString(payload.request_id) ||
      normalizeOptionalString(payload.session_id) ||
      normalizeOptionalString(payload.external_request_id);

    if (!requestId) {
      return res.status(400).json({
        message: 'request_id is required.',
      });
    }

    const archiveResult = await archiveExternalUserRequest({
      internalUserId: req.userId,
      externalUser,
      requestId,
    });

    return res.status(200).json(archiveResult);
  } catch (error) {
    return res.status(error?.status || 500).json({
      message: error?.message || 'Internal server error while archiving external user video.',
    });
  }
});

router.post('/publish', authenticateExternalRequest, async (req, res) => {
  try {
    const externalUser = await resolveExternalUserContext(req);
    const payload = normalizeInputPayload(req);
    const requestId =
      normalizeOptionalString(payload.request_id) ||
      normalizeOptionalString(payload.session_id) ||
      normalizeOptionalString(payload.external_request_id);

    if (!requestId) {
      return res.status(400).json({
        message: 'request_id is required.',
      });
    }

    const publishResult = await publishExternalUserRequest({
      internalUserId: req.userId,
      externalUser,
      requestId,
      payload,
    });

    return res.status(200).json(publishResult);
  } catch (error) {
    return res.status(error?.status || 500).json({
      message: error?.message || 'Internal server error while publishing external user video.',
    });
  }
});

router.post('/credits/recharge', authenticateExternalRequest, async (req, res) => {
  try {
    if (req.authType === 'customer_sub_account_api_key') {
      return res.status(403).json({
        message: 'Customer sub-account API keys cannot create per-user credit recharges. Purchase Samsar credits on the parent customer account.',
      });
    }

    const externalUser = await resolveExternalUserContext(req);
    const payload = normalizeInputPayload(req);
    const creditsRaw =
      payload.credits ?? payload.credits_to_recharge ?? payload.creditsToRecharge;
    const parsedCredits = Number(creditsRaw);

    if (!Number.isFinite(parsedCredits) || parsedCredits <= 0) {
      return res.status(400).json({
        message: 'credits is required and must be a positive number.',
      });
    }

    if (!Number.isInteger(parsedCredits)) {
      return res.status(400).json({
        message: 'credits must be an integer.',
      });
    }

    const amountCents = Math.round(parsedCredits);
    const amountUsd = Number((amountCents / 100).toFixed(2));

    const session = await purchaseCreditsForUser(req.userId, {
      amount: amountUsd,
      amountCents,
      productSummary: `Purchase ${amountCents} credits`,
      metadata: {
        billingScope: 'external_user',
        creditsRequested: amountCents,
        externalIdentityKey: externalUser.externalIdentityKey,
        externalProvider: externalUser.provider,
        externalUserId: externalUser._id.toString(),
        externalUserExternalId: externalUser.externalUserId,
      },
    });

    const responsePayload = {
      url: session.url,
      checkoutSessionId: session.checkoutSessionId || session.sessionId || session.id || null,
      paymentIntentId: session.paymentIntentId || null,
      paymentStatusEndpoint: '/v1/external_users/payment_status',
      credits: amountCents,
      amountUsd,
      amountCents,
      currency: 'USD',
    };

    const paymentRecord = await createExternalPaymentRecord({
      externalUser,
      creditsRequested: amountCents,
      amountCents,
      amountUsd,
      checkoutSessionId: responsePayload.checkoutSessionId,
      paymentIntentId: responsePayload.paymentIntentId,
      responsePayload,
      metadata: {
        productSummary: `Purchase ${amountCents} credits`,
      },
    });

    return res.status(200).json({
      ...responsePayload,
      external_payment_id: paymentRecord.externalPaymentId,
      external_user: formatExternalUser(externalUser),
    });
  } catch (error) {
    const statusCode = error?.statusCode || error?.status || error?.response?.status;
    return res.status(statusCode || 500).json({
      message: error?.message || 'Internal server error while creating recharge link.',
    });
  }
});

async function handleExternalPaymentStatus(req, res) {
  try {
    const scopedExternalUser = await maybeResolveExternalUserFromHeaders(req);
    const payloadSource = req.method === 'GET'
      ? req.query
      : (req.body?.input ?? req.body ?? {});
    const {
      externalPaymentId,
      checkoutSessionId,
      paymentIntentId,
      setupIntentId,
    } = normalizePaymentStatusPayload(payloadSource);

    if (!externalPaymentId && !checkoutSessionId && !paymentIntentId && !setupIntentId) {
      return res.status(400).json({
        message: 'external_payment_id or checkoutSessionId (or paymentIntentId/setupIntentId) is required.',
      });
    }

    const externalPayment = await findExternalPaymentForInternalUser({
      internalUserId: req.userId,
      externalPaymentId,
      checkoutSessionId,
      paymentIntentId,
      setupIntentId,
      externalUserId: scopedExternalUser?._id ?? null,
    });

    if (!externalPayment) {
      return res.status(404).json({
        message: 'External payment not found.',
      });
    }

    const user = await User.findById(req.userId).select('stripeCustomerId').lean();
    if (!user || !user.stripeCustomerId) {
      return res.status(404).json({ message: 'Stripe customer not found for user.' });
    }

    let responsePayload = {};

    if (externalPayment.checkoutSessionId) {
      const session = await stripe.checkout.sessions.retrieve(externalPayment.checkoutSessionId, {
        expand: ['payment_intent', 'setup_intent'],
      });

      if (session?.customer && session.customer !== user.stripeCustomerId) {
        return res.status(403).json({ message: 'Checkout session does not belong to this user.' });
      }

      const paymentIntent = session.payment_intent;
      const setupIntent = session.setup_intent;

      const paymentIntentIdResolved =
        typeof paymentIntent === 'string' ? paymentIntent : paymentIntent?.id || null;
      const paymentIntentStatus =
        typeof paymentIntent === 'string' ? null : paymentIntent?.status || null;

      const setupIntentIdResolved =
        typeof setupIntent === 'string' ? setupIntent : setupIntent?.id || null;
      const setupIntentStatus =
        typeof setupIntent === 'string' ? null : setupIntent?.status || null;

      const mode = session.mode || null;
      const sessionStatus = session.status || null;
      const paymentStatus = session.payment_status || null;

      let status = 'pending';
      if (mode === 'payment') {
        if (paymentStatus === 'paid' || paymentIntentStatus === 'succeeded') {
          status = 'succeeded';
        } else if (sessionStatus === 'expired' || paymentIntentStatus === 'canceled') {
          status = 'failed';
        }
      } else if (mode === 'setup') {
        if (setupIntentStatus === 'succeeded') {
          status = 'succeeded';
        } else if (setupIntentStatus === 'canceled' || sessionStatus === 'expired') {
          status = 'failed';
        }
      }

      responsePayload = {
        status,
        mode,
        checkoutSessionId: session.id,
        sessionStatus,
        paymentStatus,
        paymentIntentId: paymentIntentIdResolved,
        paymentIntentStatus,
        setupIntentId: setupIntentIdResolved,
        setupIntentStatus,
        amountCents: session.amount_total ?? null,
        currency: session.currency ?? null,
      };
    } else if (externalPayment.paymentIntentId) {
      const paymentIntent = await stripe.paymentIntents.retrieve(externalPayment.paymentIntentId);
      if (paymentIntent?.customer && paymentIntent.customer !== user.stripeCustomerId) {
        return res.status(403).json({ message: 'Payment intent does not belong to this user.' });
      }

      let status = 'pending';
      if (paymentIntent.status === 'succeeded') {
        status = 'succeeded';
      } else if (paymentIntent.status === 'canceled') {
        status = 'failed';
      }

      responsePayload = {
        status,
        mode: 'payment',
        paymentIntentId: paymentIntent.id,
        paymentIntentStatus: paymentIntent.status,
        amountCents: paymentIntent.amount ?? null,
        currency: paymentIntent.currency ?? null,
      };
    } else if (externalPayment.setupIntentId) {
      const setupIntent = await stripe.setupIntents.retrieve(externalPayment.setupIntentId);
      if (setupIntent?.customer && setupIntent.customer !== user.stripeCustomerId) {
        return res.status(403).json({ message: 'Setup intent does not belong to this user.' });
      }

      let status = 'pending';
      if (setupIntent.status === 'succeeded') {
        status = 'succeeded';
      } else if (setupIntent.status === 'canceled') {
        status = 'failed';
      }

      responsePayload = {
        status,
        mode: 'setup',
        setupIntentId: setupIntent.id,
        setupIntentStatus: setupIntent.status,
      };
    }

    await markExternalPaymentResolved({
      internalUserId: req.userId,
      externalPaymentId: externalPayment.externalPaymentId,
      checkoutSessionId: responsePayload.checkoutSessionId,
      paymentIntentId: responsePayload.paymentIntentId,
      setupIntentId: responsePayload.setupIntentId,
      status: responsePayload.status,
      creditsApplied:
        responsePayload.status === 'succeeded'
          ? (externalPayment.creditsRequested || responsePayload.amountCents || 0)
          : 0,
      responsePayload,
    });

    const resolvedExternalUser = scopedExternalUser?._id
      ? await resolveExternalUserContext(req, { allowCreate: false })
      : await ExternalUser.findById(
        externalPayment.externalUserId?._id || externalPayment.externalUserId,
      );
    const creditsSnapshot = await getExternalCreditsBalance({
      externalUser: resolvedExternalUser,
    });

    if (
      creditsSnapshot.remainingCredits !== undefined &&
      creditsSnapshot.remainingCredits !== null
    ) {
      res.set('x-credits-remaining', String(creditsSnapshot.remainingCredits));
    }

    return res.status(200).json({
      ...responsePayload,
      external_payment_id: externalPayment.externalPaymentId,
      remainingCredits: creditsSnapshot.remainingCredits,
      lastTopUp: creditsSnapshot.lastTopUp,
      external_user: creditsSnapshot.externalUser ?? formatExternalUser(externalPayment.externalUserId),
    });
  } catch (error) {
    const statusCode = error?.statusCode || error?.status || error?.response?.status;
    return res.status(statusCode || 500).json({
      message: error?.message || 'Internal server error while fetching payment status.',
    });
  }
}

router.get('/payment_status', authenticateExternalRequest, handleExternalPaymentStatus);
router.post('/payment_status', authenticateExternalRequest, handleExternalPaymentStatus);

router.post('/upload_image_data', authenticateExternalRequest, async (req, res) => {
  try {
    await resolveExternalUserContext(req);
    const payload = normalizeInputPayload(req);
    const { image_data } = payload;

    if (
      !Array.isArray(image_data) ||
      image_data.length === 0 ||
      image_data.some((data) => typeof data !== 'string' || data.trim() === '')
    ) {
      return res.status(400).json({
        message: 'image_data must be a non-empty array of data URL strings.',
      });
    }

    const uploadedUrls = await uploadImageDataList(req.userId, image_data);
    return res.status(200).json({ image_urls: uploadedUrls });
  } catch (error) {
    return res.status(error?.status || 500).json({
      message: error?.message || 'Internal server error while uploading image data.',
    });
  }
});

router.post('/generate_embeddings_from_plain_text', authenticateExternalRequest, async (req, res) => {
  try {
    const externalUser = await resolveExternalUserContext(req);
    const payload = normalizeInputPayload(req);
    const plainTextData = getPlainTextDataFromBody(payload);

    if (plainTextData === null || plainTextData === undefined) {
      return res.status(400).json({
        message: 'plain_text must contain at least one cleaned plain text entry.',
      });
    }

    const fieldOptions = getFieldOptionsFromBody(payload);
    const ttlMinutes = getEmbeddingTtlMinutesFromBody(payload);
    const name =
      payload?.name ||
      payload?.embedding_name ||
      payload?.template_name ||
      null;

    const result = await createEmbeddingsFromPlainText({
      userId: req.userId,
      externalUser,
      name,
      plainTextData,
      fieldOptions,
      ttlMinutes,
    });
    const externalCreditState = await loadExternalCreditState(externalUser);

    setCreditHeaders(res, result.creditsCharged, externalCreditState.remainingCredits);
    const responsePayload = {
      template_id: result.templateId,
      template_hash: result.templateHash,
      hash_link: result.hashLink,
      record_count: result.recordCount,
      structured_fields: result.structuredFields,
      unstructured_fields: result.unstructuredFields,
      external_user: formatExternalUser(externalCreditState.externalUser),
    };
    if (result.ttlMinutes !== null && result.ttlMinutes !== undefined) {
      responsePayload.ttl_minutes = result.ttlMinutes;
      responsePayload.expires_at = result.expiresAt;
    }
    return res.status(200).json(responsePayload);
  } catch (error) {
    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return respondInsufficientCredits(res);
    }

    const statusCode = error?.statusCode || error?.status || error?.response?.status || 500;
    return res.status(statusCode).json({
      message: error?.message || 'Internal server error while creating embeddings from plain text.',
    });
  }
});

router.post('/text_to_video', authenticateExternalRequest, async (req, res) => {
  let requestRecord = null;
  let reservedCredits = 0;
  try {
    const externalUser = await resolveExternalUserContext(req);
    const { webhookUrl, session_id } = req.body || {};
    const requestPayload = { ...(normalizeInputPayload(req) || {}) };
    if (session_id && !requestPayload.session_id) {
      requestPayload.session_id = session_id;
    }
    stripDeprecatedVideoModelSubtypeOptions(requestPayload);

    const enableSubtitlesOption = getEnableSubtitlesOption(requestPayload);
    if (enableSubtitlesOption.error) {
      return res.status(400).json({ message: enableSubtitlesOption.error });
    }
    requestPayload.enable_subtitles = enableSubtitlesOption.value;
    try {
      const footerAnimationOptions = normalizeImageListFooterAnimationOptions(requestPayload, 0);
      requestPayload.add_footer_animation = footerAnimationOptions.add_footer_animation;
      requestPayload.footer_metadata = footerAnimationOptions.footer_metadata;
    } catch (validationError) {
      return res.status(validationError?.status || 400).json({
        message: validationError?.message || 'Invalid footer animation options.',
      });
    }

    const isValidMoviePrompt = validateMovieInput(requestPayload);
    if (!isValidMoviePrompt.status) {
      return res.status(400).json({ message: isValidMoviePrompt.message });
    }

    requestRecord = await createExternalRequestRecord({
      externalUser,
      routeKey: 'text_to_video',
      requestPayload,
      webhookUrl: normalizeOptionalString(webhookUrl),
    });
    requestPayload.isExternalUserRequest = true;
    requestPayload.externalRequestId = requestRecord.externalRequestId;
    requestPayload.externalRequestUserId = externalUser._id.toString();
    requestPayload.externalRequestIdentityKey = externalUser.externalIdentityKey;

    const upstreamResponse = await requestCreateVideo(req.userId, requestPayload, webhookUrl);
    const sanitizedUpstreamResponse = sanitizeExternalFacingPayload(upstreamResponse);
    const upstreamSessionId = upstreamResponse?.session_id || upstreamResponse?.request_id;

    const acceptedRequestRecord = await markExternalRequestAccepted({
      externalRequestId: requestRecord.externalRequestId,
      upstreamRequestId: upstreamSessionId,
      upstreamSessionId,
      responsePayload: sanitizedUpstreamResponse,
      creditsCharged: null,
    });
    const acceptedCreditsCharged = Number(acceptedRequestRecord?.creditsCharged) || 0;
    await linkExternalRequestToSession({
      externalRequestId: requestRecord.externalRequestId,
      upstreamSessionId,
      externalUser,
    });
    if (acceptedCreditsCharged > 0) {
      res.set('x-credits-charged', String(acceptedCreditsCharged));
    }

    return res.status(200).json(
      buildAcceptedExternalResponse({
        externalRequestId: requestRecord.externalRequestId,
        upstreamResponse: sanitizedUpstreamResponse,
        creditsCharged: acceptedCreditsCharged,
      }),
    );
  } catch (error) {
    if (requestRecord) {
      if (reservedCredits > 0) {
        await refundExternalRequestCredits({
          externalRequestId: requestRecord.externalRequestId,
          creditsToRefund: reservedCredits,
          reason: error?.message,
        });
      } else {
        await markExternalRequestFailed({
          externalRequestId: requestRecord.externalRequestId,
          errorMessage: error?.message,
        });
      }
    }

    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return respondInsufficientCredits(res);
    }

    const statusCode = error?.status || error?.response?.status || 500;
    const message =
      statusCode >= 400 && statusCode < 500 && error?.message
        ? error.message
        : 'Internal server error while creating external user video.';
    return res.status(statusCode).json({ message });
  }
});

router.post('/image_list_to_video', authenticateExternalRequest, async (req, res) => {
  let requestRecord = null;
  let reservedCredits = 0;
  try {
    const externalUser = await resolveExternalUserContext(req);
    const { webhookUrl, session_id } = req.body || {};
    const requestPayload = { ...(normalizeInputPayload(req) || {}) };
    if (session_id && !requestPayload.session_id) {
      requestPayload.session_id = session_id;
    }
    stripDeprecatedVideoModelSubtypeOptions(requestPayload);

    const enableSubtitlesOption = getEnableSubtitlesOption(requestPayload);
    if (enableSubtitlesOption.error) {
      return res.status(400).json({ message: enableSubtitlesOption.error });
    }
    requestPayload.enable_subtitles = enableSubtitlesOption.value;

    let expressCtaGenerationOptions;
    try {
      expressCtaGenerationOptions = normalizeImageListExpressCtaGenerationOptions(requestPayload);
    } catch (validationError) {
      return res.status(validationError?.status || 400).json({
        message: validationError?.message || 'Invalid express CTA generation options.',
      });
    }
    if (expressCtaGenerationOptions.express_cta_generation) {
      requestPayload.express_cta_generation = true;
      requestPayload.cta_url = expressCtaGenerationOptions.cta_url;
      requestPayload.generate_outro_image = true;
      if (requestPayload.add_outro_animation === undefined && requestPayload.addOutroAnimation === undefined) {
        requestPayload.add_outro_animation = true;
      }
      requestPayload.add_footer_animation = true;
    }

    if (!Array.isArray(requestPayload.image_urls) || requestPayload.image_urls.length === 0) {
      return res.status(400).json({
        message: 'image_urls must be a non-empty array.',
      });
    }

    const isInvalidEntry = requestPayload.image_urls.some((item) => {
      if (typeof item === 'string') {
        return item.trim() === '';
      }
      if (!item || typeof item !== 'object') {
        return true;
      }
      const candidates = [
        item.image_url,
        item.imageUrl,
        item.url,
        item.src,
        item.enhanced_url,
        item.enhancedUrl,
      ];
      return !candidates.some((value) => typeof value === 'string' && value.trim().length > 0);
    });

    if (isInvalidEntry) {
      return res.status(400).json({
        message: 'image_urls entries must be strings or objects containing a non-empty image_url (or enhanced_url).',
      });
    }

    try {
      assertImageListToVideoUrlsAreFetchable(normalizeImageListInput(requestPayload.image_urls).imageUrls);
    } catch (validationError) {
      return res.status(validationError?.status || 400).json({
        message: validationError?.message || 'Invalid image_urls.',
      });
    }

    const requestedVideoModel = normalizeImageListToVideoModel(requestPayload.video_model);
    if (!requestedVideoModel) {
      return res.status(400).json({
        message: IMAGE_LIST_TO_VIDEO_VIDEO_MODEL_ERROR_MESSAGE,
      });
    }
    requestPayload.video_model = requestedVideoModel;
    const imageModelValidation = validateExpressImageModelKey(
      requestPayload.image_model ?? requestPayload.imageModel,
      { required: false },
    );
    if (!imageModelValidation.status) {
      return res.status(400).json({
        message: imageModelValidation.message,
      });
    }
    if (imageModelValidation.imageModel) {
      requestPayload.image_model = imageModelValidation.imageModel;
      delete requestPayload.imageModel;
    }
    requestPayload.aspect_ratio = normalizeOptionalString(requestPayload.aspect_ratio)
      || normalizeOptionalString(requestPayload.aspectRatio)
      || '16:9';

    try {
      const footerAnimationOptions = normalizeImageListFooterAnimationOptions(
        requestPayload,
        requestPayload.image_urls.length,
      );
      const narratorAvatarOptions = normalizeImageListNarratorAvatarOptions(requestPayload);
      requestPayload.add_footer_animation = footerAnimationOptions.add_footer_animation;
      requestPayload.footer_metadata = footerAnimationOptions.footer_metadata;
      requestPayload.limit_single_narrator = narratorAvatarOptions.limit_single_narrator;
      requestPayload.add_narrator_avatar = narratorAvatarOptions.add_narrator_avatar;
    } catch (validationError) {
      return res.status(validationError?.status || 400).json({
        message: validationError?.message || 'Invalid footer animation options.',
      });
    }

    requestRecord = await createExternalRequestRecord({
      externalUser,
      routeKey: 'image_list_to_video',
      requestPayload,
      webhookUrl: normalizeOptionalString(webhookUrl),
    });
    requestPayload.isExternalUserRequest = true;
    requestPayload.externalRequestId = requestRecord.externalRequestId;
    requestPayload.externalRequestUserId = externalUser._id.toString();
    requestPayload.externalRequestIdentityKey = externalUser.externalIdentityKey;

    const upstreamResponse = await requestCreateVideoFromImageListAndMetadata(
      req.userId,
      requestPayload,
      webhookUrl,
    );
    const sanitizedUpstreamResponse = sanitizeExternalFacingPayload(upstreamResponse);
    const upstreamSessionId = upstreamResponse?.session_id || upstreamResponse?.request_id;
    const acceptedRequestRecord = await markExternalRequestAccepted({
      externalRequestId: requestRecord.externalRequestId,
      upstreamRequestId: upstreamSessionId,
      upstreamSessionId,
      responsePayload: sanitizedUpstreamResponse,
      creditsCharged: null,
    });
    const creditsCharged = Number(acceptedRequestRecord?.creditsCharged) || 0;
    await linkExternalRequestToSession({
      externalRequestId: requestRecord.externalRequestId,
      upstreamSessionId,
      externalUser,
    });
    if (creditsCharged > 0) {
      res.set('x-credits-charged', String(creditsCharged));
    }

    return res.status(200).json(
      buildAcceptedExternalResponse({
        externalRequestId: requestRecord.externalRequestId,
        upstreamResponse: sanitizedUpstreamResponse,
        creditsCharged,
      }),
    );
  } catch (error) {
    if (requestRecord) {
      if (reservedCredits > 0) {
        await refundExternalRequestCredits({
          externalRequestId: requestRecord.externalRequestId,
          creditsToRefund: reservedCredits,
          reason: error?.message,
        });
      } else {
        await markExternalRequestFailed({
          externalRequestId: requestRecord.externalRequestId,
          errorMessage: error?.message,
        });
      }
    }

    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return respondInsufficientCredits(res);
    }

    const statusCode = error?.status || error?.response?.status || 500;
    return res.status(statusCode).json({
      message:
        error?.message || 'Internal server error while creating external user image-list video.',
    });
  }
});

router.post('/translate_video', authenticateExternalRequest, async (req, res) => {
  let requestRecord = null;
  let reservedCredits = 0;
  try {
    const { webhookUrl } = req.body || {};
    const requestPayload = { ...(normalizeInputPayload(req) || {}) };
    const resolvedWebhookUrl = normalizeOptionalString(webhookUrl)
      || normalizeOptionalString(requestPayload.webhookUrl);
    const sourceRequestId = getSourceSessionIdFromRequestPayload(requestPayload);

    if (!sourceRequestId) {
      return res.status(400).json({
        message: 'request_id (or session_id) is required.',
      });
    }

    if (await shouldUseInternalVideoSessionRoute(req, sourceRequestId)) {
      const response = await translateVideoSessionAndQueueGeneration(req.userId, {
        ...requestPayload,
        videoSessionId: sourceRequestId,
        session_id: sourceRequestId,
        webhookUrl: resolvedWebhookUrl || undefined,
      });
      setGenerationCreditHeaders(res, response);
      return res.status(200).json(response);
    }

    const { externalUser, sourceRequest, sourceSessionId } = await resolveExternalRouteSourceRequest({
      req,
      requestId: sourceRequestId,
    });

    requestPayload.source_request_id = sourceRequest.externalRequestId;
    requestPayload.source_session_id = sourceSessionId;
    requestPayload.video_session_id = sourceSessionId;
    requestPayload.session_id = sourceSessionId;

    const billingPreview = await getTranslateVideoBillingPreview(req.userId, requestPayload);
    requestPayload.language = billingPreview.normalizedLanguageCode;
    requestPayload.target_language = billingPreview.normalizedLanguageCode;
    requestPayload.enable_subtitles = billingPreview.enableSubtitles;
    requestPayload.translate_outro = billingPreview.translateOutro;
    requestPayload.translate_footer = billingPreview.translateFooter;

    requestRecord = await createExternalRequestRecord({
      externalUser,
      routeKey: 'translate_video',
      requestPayload,
      webhookUrl: resolvedWebhookUrl,
    });

    reservedCredits = billingPreview.creditsToCharge;
    if (reservedCredits > 0) {
      requestRecord = await reserveExternalRequestCredits({
        externalRequestId: requestRecord.externalRequestId,
        creditsToReserve: reservedCredits,
      });
    }

    const upstreamResponse = await translateVideoSessionAndQueueGeneration(req.userId, {
      ...requestPayload,
      videoSessionId: sourceSessionId,
      session_id: sourceSessionId,
      language: billingPreview.normalizedLanguageCode,
      skipCreditDeduction: true,
      webhookUrl: resolvedWebhookUrl || undefined,
    });
    const sanitizedUpstreamResponse = sanitizeExternalFacingPayload(upstreamResponse);
    const upstreamSessionId = upstreamResponse?.session_id || upstreamResponse?.request_id;
    const acceptedCreditsCharged =
      Number(upstreamResponse?.creditsCharged) > 0
        ? Number(upstreamResponse.creditsCharged)
        : reservedCredits;

    await markExternalRequestAccepted({
      externalRequestId: requestRecord.externalRequestId,
      upstreamRequestId: upstreamSessionId,
      upstreamSessionId,
      responsePayload: sanitizedUpstreamResponse,
      creditsCharged: acceptedCreditsCharged,
    });
    await linkExternalRequestToSession({
      externalRequestId: requestRecord.externalRequestId,
      upstreamSessionId,
      externalUser,
    });
    if (acceptedCreditsCharged > 0) {
      res.set('x-credits-charged', String(acceptedCreditsCharged));
    }

    return res.status(200).json(
      buildAcceptedExternalResponse({
        externalRequestId: requestRecord.externalRequestId,
        upstreamResponse: sanitizedUpstreamResponse,
        creditsCharged: acceptedCreditsCharged,
      }),
    );
  } catch (error) {
    if (requestRecord) {
      if (reservedCredits > 0) {
        await refundExternalRequestCredits({
          externalRequestId: requestRecord.externalRequestId,
          creditsToRefund: reservedCredits,
          reason: error?.message,
        });
      } else {
        await markExternalRequestFailed({
          externalRequestId: requestRecord.externalRequestId,
          errorMessage: error?.message,
        });
      }
    }

    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return respondInsufficientCredits(res);
    }

    const statusCode = error?.status || error?.response?.status || 500;
    return res.status(statusCode).json({
      message: error?.message || 'Internal server error while retranslating external user video.',
    });
  }
});

router.post('/add_outro_image', authenticateExternalRequest, async (req, res) => {
  let requestRecord = null;
  let reservedCredits = 0;
  try {
    const { webhookUrl } = req.body || {};
    const requestPayload = { ...(normalizeInputPayload(req) || {}) };
    const resolvedWebhookUrl = normalizeOptionalString(webhookUrl)
      || normalizeOptionalString(requestPayload.webhookUrl);
    const sourceRequestId = getSourceSessionIdFromRequestPayload(requestPayload);

    if (!sourceRequestId) {
      return res.status(400).json({
        message: 'request_id (or session_id) is required.',
      });
    }

    const rawOutroUrl =
      requestPayload.outro_image_url ??
      requestPayload.outroImageUrl ??
      requestPayload.new_outro_image_url ??
      requestPayload.newOutroImageUrl;
    const outroImageUrl = normalizeOptionalPayloadString(rawOutroUrl, 'outro_image_url');

    const rawGenerateOutroImage =
      requestPayload.generate_outro_image ??
      requestPayload.generateOutroImage;
    if (rawGenerateOutroImage !== undefined && typeof rawGenerateOutroImage !== 'boolean') {
      return res.status(400).json({
        message: 'generate_outro_image must be a boolean.',
      });
    }

    const rawAddOutroAnimation =
      requestPayload.add_outro_animation ??
      requestPayload.addOutroAnimation;
    if (rawAddOutroAnimation !== undefined && typeof rawAddOutroAnimation !== 'boolean') {
      return res.status(400).json({
        message: 'add_outro_animation must be a boolean.',
      });
    }

    const rawAddOutroFocusArea =
      requestPayload.add_outro_focus_area ??
      requestPayload.addOutroFocusArea;
    if (rawAddOutroFocusArea !== undefined && typeof rawAddOutroFocusArea !== 'boolean') {
      return res.status(400).json({
        message: 'add_outro_focus_area must be a boolean.',
      });
    }

    const rawOutroFocusArea =
      requestPayload.outro_focust_area ??
      requestPayload.outro_focus_area ??
      requestPayload.outroFocustArea ??
      requestPayload.outroFocusArea;
    const ctaUrl = normalizeOptionalPayloadString(
      requestPayload.cta_url ?? requestPayload.ctaUrl,
      'cta_url',
    );
    const normalizedCtaTextTop = normalizeOptionalPayloadString(
      requestPayload.cta_text_top ?? requestPayload.ctaTextTop,
      'cta_text_top',
    );
    const normalizedCtaTextBottom = normalizeOptionalPayloadString(
      requestPayload.cta_text_bottom ?? requestPayload.ctaTextBottom,
      'cta_text_bottom',
    );
    const ctaLogo = normalizeOptionalPayloadString(
      requestPayload.cta_logo ?? requestPayload.ctaLogo,
      'cta_logo',
    );
    let outroCtaImage = null;
    let outroCtaImageTextFields = { ctaTextTop: null, ctaTextBottom: null };
    try {
      outroCtaImage = normalizeOutroCtaImageFromPayload(requestPayload);
      outroCtaImageTextFields = normalizeOutroCtaImageTextFieldsFromPayload(requestPayload);
    } catch (validationError) {
      return res.status(validationError?.status || 400).json({
        message: validationError?.message || 'Invalid outro_cta_image.',
      });
    }
    const ctaTextTop = normalizedCtaTextTop || outroCtaImageTextFields.ctaTextTop;
    const ctaTextBottom = normalizedCtaTextBottom || outroCtaImageTextFields.ctaTextBottom;
    const generateOutroImage = rawGenerateOutroImage === true ||
      (rawGenerateOutroImage === undefined && !outroImageUrl && (Boolean(ctaUrl) || Boolean(outroCtaImage)));

    if ((generateOutroImage || outroCtaImage) && outroImageUrl) {
      return res.status(400).json({
        message: 'Use either generate_outro_image with cta_url/outro_cta_image or outro_image_url, not both.',
      });
    }

    if (!generateOutroImage && !outroImageUrl) {
      return res.status(400).json({
        message: 'outro_image_url (or outroImageUrl/new_outro_image_url) is required unless generate_outro_image is true.',
      });
    }

    if (generateOutroImage) {
      if (!ctaUrl && !outroCtaImage) {
        return res.status(400).json({
          message: 'cta_url or outro_cta_image is required when generate_outro_image is true.',
        });
      }
      if (ctaUrl && !isHttpUrl(ctaUrl)) {
        return res.status(400).json({
          message: 'cta_url must be an http or https URL.',
        });
      }
    }

    if (!generateOutroImage && rawAddOutroFocusArea === true) {
      if (rawAddOutroAnimation !== true) {
        return res.status(400).json({
          message: 'add_outro_focus_area requires add_outro_animation to be true.',
        });
      }

      if (!rawOutroFocusArea) {
        return res.status(400).json({
          message: 'outro_focust_area is required when add_outro_focus_area is true.',
        });
      }

      if (typeof rawOutroFocusArea !== 'object' || Array.isArray(rawOutroFocusArea)) {
        return res.status(400).json({
          message: 'outro_focust_area must be an object with x, y, width, height.',
        });
      }

      const { x, y, width, height } = rawOutroFocusArea;
      const hasInvalidNumber = [x, y, width, height].some(
        (value) => typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value),
      );

      if (hasInvalidNumber) {
        return res.status(400).json({
          message: 'outro_focust_area x, y, width, height must be valid numbers.',
        });
      }
    }

    if (await shouldUseInternalVideoSessionRoute(req, sourceRequestId)) {
      const response = await addOutroImageAndQueueRender(req.userId, {
        ...requestPayload,
        videoSessionId: sourceRequestId,
        session_id: sourceRequestId,
        ...(outroImageUrl ? { outroImageUrl } : {}),
        generateOutroImage,
        ...(generateOutroImage ? {
          ...(ctaUrl ? { ctaUrl } : {}),
          ...(outroCtaImage ? { outroCtaImage } : {}),
          ...(ctaTextTop ? { ctaTextTop } : {}),
          ...(ctaTextBottom ? { ctaTextBottom } : {}),
          ...(ctaLogo ? { ctaLogo } : {}),
        } : {}),
        ...(!generateOutroImage && rawAddOutroAnimation !== undefined ? { addOutroAnimation: rawAddOutroAnimation === true } : {}),
        ...(!generateOutroImage && rawAddOutroFocusArea !== undefined ? { addOutroFocusArea: rawAddOutroFocusArea === true } : {}),
        ...(!generateOutroImage && rawOutroFocusArea !== undefined && rawOutroFocusArea !== null ? { outroFocustArea: rawOutroFocusArea } : {}),
        webhookUrl: resolvedWebhookUrl || undefined,
      });
      setGenerationCreditHeaders(res, response);
      return res.status(200).json(response);
    }

    const { externalUser, sourceRequest, sourceSessionId } = await resolveExternalRouteSourceRequest({
      req,
      requestId: sourceRequestId,
    });

    requestPayload.source_request_id = sourceRequest.externalRequestId;
    requestPayload.source_session_id = sourceSessionId;
    requestPayload.video_session_id = sourceSessionId;
    requestPayload.session_id = sourceSessionId;

    requestRecord = await createExternalRequestRecord({
      externalUser,
      routeKey: 'add_outro_image',
      requestPayload,
      webhookUrl: resolvedWebhookUrl,
    });

    reservedCredits = ADD_OUTRO_IMAGE_CREDITS;
    if (reservedCredits > 0) {
      requestRecord = await reserveExternalRequestCredits({
        externalRequestId: requestRecord.externalRequestId,
        creditsToReserve: reservedCredits,
      });
    }

    const upstreamResponse = await addOutroImageAndQueueRender(req.userId, {
      ...requestPayload,
      videoSessionId: sourceSessionId,
      session_id: sourceSessionId,
      ...(outroImageUrl ? { outroImageUrl } : {}),
      generateOutroImage,
      ...(generateOutroImage ? {
        ...(ctaUrl ? { ctaUrl } : {}),
        ...(outroCtaImage ? { outroCtaImage } : {}),
        ...(ctaTextTop ? { ctaTextTop } : {}),
        ...(ctaTextBottom ? { ctaTextBottom } : {}),
        ...(ctaLogo ? { ctaLogo } : {}),
      } : {}),
      ...(!generateOutroImage && rawAddOutroAnimation !== undefined ? { addOutroAnimation: rawAddOutroAnimation === true } : {}),
      ...(!generateOutroImage && rawAddOutroFocusArea !== undefined ? { addOutroFocusArea: rawAddOutroFocusArea === true } : {}),
      ...(!generateOutroImage && rawOutroFocusArea !== undefined && rawOutroFocusArea !== null ? { outroFocustArea: rawOutroFocusArea } : {}),
      skipCreditDeduction: true,
      webhookUrl: resolvedWebhookUrl || undefined,
    });
    const sanitizedUpstreamResponse = sanitizeExternalFacingPayload(upstreamResponse);
    const upstreamSessionId = upstreamResponse?.session_id || upstreamResponse?.request_id;
    const acceptedCreditsCharged =
      Number(upstreamResponse?.creditsCharged) > 0
        ? Number(upstreamResponse.creditsCharged)
        : reservedCredits;

    await markExternalRequestAccepted({
      externalRequestId: requestRecord.externalRequestId,
      upstreamRequestId: upstreamSessionId,
      upstreamSessionId,
      responsePayload: sanitizedUpstreamResponse,
      creditsCharged: acceptedCreditsCharged,
    });
    await linkExternalRequestToSession({
      externalRequestId: requestRecord.externalRequestId,
      upstreamSessionId,
      externalUser,
    });
    if (acceptedCreditsCharged > 0) {
      res.set('x-credits-charged', String(acceptedCreditsCharged));
    }

    return res.status(200).json(
      buildAcceptedExternalResponse({
        externalRequestId: requestRecord.externalRequestId,
        upstreamResponse: sanitizedUpstreamResponse,
        creditsCharged: acceptedCreditsCharged,
      }),
    );
  } catch (error) {
    if (requestRecord) {
      if (reservedCredits > 0) {
        await refundExternalRequestCredits({
          externalRequestId: requestRecord.externalRequestId,
          creditsToRefund: reservedCredits,
          reason: error?.message,
        });
      } else {
        await markExternalRequestFailed({
          externalRequestId: requestRecord.externalRequestId,
          errorMessage: error?.message,
        });
      }
    }

    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return respondInsufficientCredits(res);
    }

    const statusCode = error?.status || error?.response?.status || 500;
    return res.status(statusCode).json({
      message: error?.publicMessage || error?.message || 'Internal server error while adding external user outro image.',
    });
  }
});

router.post('/update_outro_image', authenticateExternalRequest, async (req, res) => {
  let requestRecord = null;
  let reservedCredits = 0;
  try {
    const { webhookUrl } = req.body || {};
    const requestPayload = { ...(normalizeInputPayload(req) || {}) };
    const resolvedWebhookUrl = normalizeOptionalString(webhookUrl)
      || normalizeOptionalString(requestPayload.webhookUrl);
    const sourceRequestId = getSourceSessionIdFromRequestPayload(requestPayload);

    if (!sourceRequestId) {
      return res.status(400).json({
        message: 'request_id (or session_id) is required.',
      });
    }

    const rawOutroUrl =
      requestPayload.outro_image_url ??
      requestPayload.outroImageUrl ??
      requestPayload.new_outro_image_url ??
      requestPayload.newOutroImageUrl;
    const outroImageUrl = normalizeOptionalPayloadString(rawOutroUrl, 'outro_image_url');

    const rawGenerateOutroImage =
      requestPayload.generate_outro_image ??
      requestPayload.generateOutroImage;
    if (rawGenerateOutroImage !== undefined && typeof rawGenerateOutroImage !== 'boolean') {
      return res.status(400).json({
        message: 'generate_outro_image must be a boolean.',
      });
    }

    const rawAddOutroAnimation =
      requestPayload.add_outro_animation ??
      requestPayload.addOutroAnimation;
    if (rawAddOutroAnimation !== undefined && typeof rawAddOutroAnimation !== 'boolean') {
      return res.status(400).json({
        message: 'add_outro_animation must be a boolean.',
      });
    }

    const rawAddOutroFocusArea =
      requestPayload.add_outro_focus_area ??
      requestPayload.addOutroFocusArea;
    if (rawAddOutroFocusArea !== undefined && typeof rawAddOutroFocusArea !== 'boolean') {
      return res.status(400).json({
        message: 'add_outro_focus_area must be a boolean.',
      });
    }

    const rawOutroFocusArea =
      requestPayload.outro_focust_area ??
      requestPayload.outro_focus_area ??
      requestPayload.outroFocustArea ??
      requestPayload.outroFocusArea;
    const ctaUrl = normalizeOptionalPayloadString(
      requestPayload.cta_url ?? requestPayload.ctaUrl,
      'cta_url',
    );
    const normalizedCtaTextTop = normalizeOptionalPayloadString(
      requestPayload.cta_text_top ?? requestPayload.ctaTextTop,
      'cta_text_top',
    );
    const normalizedCtaTextBottom = normalizeOptionalPayloadString(
      requestPayload.cta_text_bottom ?? requestPayload.ctaTextBottom,
      'cta_text_bottom',
    );
    const ctaLogo = normalizeOptionalPayloadString(
      requestPayload.cta_logo ?? requestPayload.ctaLogo,
      'cta_logo',
    );
    let outroCtaImage = null;
    let outroCtaImageTextFields = { ctaTextTop: null, ctaTextBottom: null };
    try {
      outroCtaImage = normalizeOutroCtaImageFromPayload(requestPayload);
      outroCtaImageTextFields = normalizeOutroCtaImageTextFieldsFromPayload(requestPayload);
    } catch (validationError) {
      return res.status(validationError?.status || 400).json({
        message: validationError?.message || 'Invalid outro_cta_image.',
      });
    }
    const ctaTextTop = normalizedCtaTextTop || outroCtaImageTextFields.ctaTextTop;
    const ctaTextBottom = normalizedCtaTextBottom || outroCtaImageTextFields.ctaTextBottom;
    const generateOutroImage = rawGenerateOutroImage === true ||
      (rawGenerateOutroImage === undefined && !outroImageUrl && (Boolean(ctaUrl) || Boolean(outroCtaImage)));

    if ((generateOutroImage || outroCtaImage) && outroImageUrl) {
      return res.status(400).json({
        message: 'Use either generate_outro_image with cta_url/outro_cta_image or outro_image_url, not both.',
      });
    }

    if (!generateOutroImage && !outroImageUrl) {
      return res.status(400).json({
        message: 'outro_image_url (or outroImageUrl/new_outro_image_url) is required unless generate_outro_image is true.',
      });
    }

    if (generateOutroImage) {
      if (!ctaUrl && !outroCtaImage) {
        return res.status(400).json({
          message: 'cta_url or outro_cta_image is required when generate_outro_image is true.',
        });
      }
      if (ctaUrl && !isHttpUrl(ctaUrl)) {
        return res.status(400).json({
          message: 'cta_url must be an http or https URL.',
        });
      }
    }

    if (!generateOutroImage && rawAddOutroFocusArea === true) {
      if (rawAddOutroAnimation !== true) {
        return res.status(400).json({
          message: 'add_outro_focus_area requires add_outro_animation to be true.',
        });
      }

      if (!rawOutroFocusArea) {
        return res.status(400).json({
          message: 'outro_focust_area is required when add_outro_focus_area is true.',
        });
      }

      if (typeof rawOutroFocusArea !== 'object' || Array.isArray(rawOutroFocusArea)) {
        return res.status(400).json({
          message: 'outro_focust_area must be an object with x, y, width, height.',
        });
      }

      const { x, y, width, height } = rawOutroFocusArea;
      const hasInvalidNumber = [x, y, width, height].some(
        (value) => typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value),
      );

      if (hasInvalidNumber) {
        return res.status(400).json({
          message: 'outro_focust_area x, y, width, height must be valid numbers.',
        });
      }
    }

    if (await shouldUseInternalVideoSessionRoute(req, sourceRequestId)) {
      const response = await updateOutroImageAndQueueRender(req.userId, {
        ...requestPayload,
        videoSessionId: sourceRequestId,
        session_id: sourceRequestId,
        ...(outroImageUrl ? { outroImageUrl } : {}),
        generateOutroImage,
        ...(generateOutroImage ? {
          ...(ctaUrl ? { ctaUrl } : {}),
          ...(outroCtaImage ? { outroCtaImage } : {}),
          ...(ctaTextTop ? { ctaTextTop } : {}),
          ...(ctaTextBottom ? { ctaTextBottom } : {}),
          ...(ctaLogo ? { ctaLogo } : {}),
        } : {}),
        ...(rawAddOutroAnimation !== undefined ? { addOutroAnimation: rawAddOutroAnimation === true } : {}),
        ...(rawAddOutroFocusArea !== undefined ? { addOutroFocusArea: rawAddOutroFocusArea === true } : {}),
        ...(rawOutroFocusArea !== undefined && rawOutroFocusArea !== null ? { outroFocustArea: rawOutroFocusArea } : {}),
        webhookUrl: resolvedWebhookUrl || undefined,
      });
      setGenerationCreditHeaders(res, response);
      return res.status(200).json(response);
    }

    const { externalUser, sourceRequest, sourceSessionId } = await resolveExternalRouteSourceRequest({
      req,
      requestId: sourceRequestId,
    });

    requestPayload.source_request_id = sourceRequest.externalRequestId;
    requestPayload.source_session_id = sourceSessionId;
    requestPayload.video_session_id = sourceSessionId;
    requestPayload.session_id = sourceSessionId;

    requestRecord = await createExternalRequestRecord({
      externalUser,
      routeKey: 'update_outro_image',
      requestPayload,
      webhookUrl: resolvedWebhookUrl,
    });

    reservedCredits = UPDATE_OUTRO_IMAGE_CREDITS;
    if (reservedCredits > 0) {
      requestRecord = await reserveExternalRequestCredits({
        externalRequestId: requestRecord.externalRequestId,
        creditsToReserve: reservedCredits,
      });
    }

    const upstreamResponse = await updateOutroImageAndQueueRender(req.userId, {
      ...requestPayload,
      videoSessionId: sourceSessionId,
      session_id: sourceSessionId,
      ...(outroImageUrl ? { outroImageUrl } : {}),
      generateOutroImage,
      ...(generateOutroImage ? {
        ...(ctaUrl ? { ctaUrl } : {}),
        ...(outroCtaImage ? { outroCtaImage } : {}),
        ...(ctaTextTop ? { ctaTextTop } : {}),
        ...(ctaTextBottom ? { ctaTextBottom } : {}),
        ...(ctaLogo ? { ctaLogo } : {}),
      } : {}),
      ...(rawAddOutroAnimation !== undefined ? { addOutroAnimation: rawAddOutroAnimation === true } : {}),
      ...(rawAddOutroFocusArea !== undefined ? { addOutroFocusArea: rawAddOutroFocusArea === true } : {}),
      ...(rawOutroFocusArea !== undefined && rawOutroFocusArea !== null ? { outroFocustArea: rawOutroFocusArea } : {}),
      skipCreditDeduction: true,
      webhookUrl: resolvedWebhookUrl || undefined,
    });
    const sanitizedUpstreamResponse = sanitizeExternalFacingPayload(upstreamResponse);
    const upstreamSessionId = upstreamResponse?.session_id || upstreamResponse?.request_id;
    const acceptedCreditsCharged =
      Number(upstreamResponse?.creditsCharged) > 0
        ? Number(upstreamResponse.creditsCharged)
        : reservedCredits;

    await markExternalRequestAccepted({
      externalRequestId: requestRecord.externalRequestId,
      upstreamRequestId: upstreamSessionId,
      upstreamSessionId,
      responsePayload: sanitizedUpstreamResponse,
      creditsCharged: acceptedCreditsCharged,
    });
    await linkExternalRequestToSession({
      externalRequestId: requestRecord.externalRequestId,
      upstreamSessionId,
      externalUser,
    });
    if (acceptedCreditsCharged > 0) {
      res.set('x-credits-charged', String(acceptedCreditsCharged));
    }

    return res.status(200).json(
      buildAcceptedExternalResponse({
        externalRequestId: requestRecord.externalRequestId,
        upstreamResponse: sanitizedUpstreamResponse,
        creditsCharged: acceptedCreditsCharged,
      }),
    );
  } catch (error) {
    if (requestRecord) {
      if (reservedCredits > 0) {
        await refundExternalRequestCredits({
          externalRequestId: requestRecord.externalRequestId,
          creditsToRefund: reservedCredits,
          reason: error?.message,
        });
      } else {
        await markExternalRequestFailed({
          externalRequestId: requestRecord.externalRequestId,
          errorMessage: error?.message,
        });
      }
    }

    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return respondInsufficientCredits(res);
    }

    const statusCode = error?.status || error?.response?.status || 500;
    return res.status(statusCode).json({
      message: error?.publicMessage || error?.message || 'Internal server error while updating external user outro image.',
    });
  }
});

router.post('/update_footer_image', authenticateExternalRequest, async (req, res) => {
  let requestRecord = null;
  let reservedCredits = 0;
  try {
    const { webhookUrl } = req.body || {};
    const requestPayload = { ...(normalizeInputPayload(req) || {}) };
    const resolvedWebhookUrl = normalizeOptionalString(webhookUrl)
      || normalizeOptionalString(requestPayload.webhookUrl);
    const sourceRequestId = getSourceSessionIdFromRequestPayload(requestPayload);

    if (!sourceRequestId) {
      return res.status(400).json({
        message: 'request_id (or session_id) is required.',
      });
    }

    const rawRemoveFooter =
      requestPayload.remove_footer ??
      requestPayload.removeFooter;
    if (rawRemoveFooter !== undefined && typeof rawRemoveFooter !== 'boolean') {
      return res.status(400).json({
        message: 'remove_footer must be a boolean.',
      });
    }

    const removeFooter = rawRemoveFooter === true;
    const ctaText = normalizeOptionalPayloadString(
      requestPayload.cta_text ?? requestPayload.ctaText,
      'cta_text',
    );
    const ctaLogo = normalizeOptionalPayloadString(
      requestPayload.cta_logo ?? requestPayload.ctaLogo,
      'cta_logo',
    );
    const ctaUrl = normalizeOptionalPayloadString(
      requestPayload.cta_url ?? requestPayload.ctaUrl,
      'cta_url',
    );

    if (ctaUrl && !isHttpUrl(ctaUrl)) {
      return res.status(400).json({
        message: 'cta_url must be an http or https URL.',
      });
    }

    if (!removeFooter && !ctaText && !ctaLogo && !ctaUrl) {
      return res.status(400).json({
        message: 'At least one of cta_text, cta_logo, or cta_url is required unless remove_footer is true.',
      });
    }

    if (await shouldUseInternalVideoSessionRoute(req, sourceRequestId)) {
      const response = await updateFooterImageAndQueueRender(req.userId, {
        ...requestPayload,
        videoSessionId: sourceRequestId,
        session_id: sourceRequestId,
        removeFooter,
        ...(ctaText ? { ctaText } : {}),
        ...(ctaLogo ? { ctaLogo } : {}),
        ...(ctaUrl ? { ctaUrl } : {}),
        webhookUrl: resolvedWebhookUrl || undefined,
      });
      setGenerationCreditHeaders(res, response);
      return res.status(200).json(response);
    }

    const { externalUser, sourceRequest, sourceSessionId } = await resolveExternalRouteSourceRequest({
      req,
      requestId: sourceRequestId,
    });

    requestPayload.source_request_id = sourceRequest.externalRequestId;
    requestPayload.source_session_id = sourceSessionId;
    requestPayload.video_session_id = sourceSessionId;
    requestPayload.session_id = sourceSessionId;

    requestRecord = await createExternalRequestRecord({
      externalUser,
      routeKey: 'update_footer_image',
      requestPayload,
      webhookUrl: resolvedWebhookUrl,
    });

    reservedCredits = UPDATE_FOOTER_IMAGE_CREDITS;
    if (reservedCredits > 0) {
      requestRecord = await reserveExternalRequestCredits({
        externalRequestId: requestRecord.externalRequestId,
        creditsToReserve: reservedCredits,
      });
    }

    const upstreamResponse = await updateFooterImageAndQueueRender(req.userId, {
      ...requestPayload,
      videoSessionId: sourceSessionId,
      session_id: sourceSessionId,
      removeFooter,
      ...(ctaText ? { ctaText } : {}),
      ...(ctaLogo ? { ctaLogo } : {}),
      ...(ctaUrl ? { ctaUrl } : {}),
      skipCreditDeduction: true,
      webhookUrl: resolvedWebhookUrl || undefined,
    });
    const sanitizedUpstreamResponse = sanitizeExternalFacingPayload(upstreamResponse);
    const upstreamSessionId = upstreamResponse?.session_id || upstreamResponse?.request_id;
    const acceptedCreditsCharged =
      Number(upstreamResponse?.creditsCharged) > 0
        ? Number(upstreamResponse.creditsCharged)
        : reservedCredits;

    await markExternalRequestAccepted({
      externalRequestId: requestRecord.externalRequestId,
      upstreamRequestId: upstreamSessionId,
      upstreamSessionId,
      responsePayload: sanitizedUpstreamResponse,
      creditsCharged: acceptedCreditsCharged,
    });
    await linkExternalRequestToSession({
      externalRequestId: requestRecord.externalRequestId,
      upstreamSessionId,
      externalUser,
    });
    if (acceptedCreditsCharged > 0) {
      res.set('x-credits-charged', String(acceptedCreditsCharged));
    }

    return res.status(200).json(
      buildAcceptedExternalResponse({
        externalRequestId: requestRecord.externalRequestId,
        upstreamResponse: sanitizedUpstreamResponse,
        creditsCharged: acceptedCreditsCharged,
      }),
    );
  } catch (error) {
    if (requestRecord) {
      if (reservedCredits > 0) {
        await refundExternalRequestCredits({
          externalRequestId: requestRecord.externalRequestId,
          creditsToRefund: reservedCredits,
          reason: error?.message,
        });
      } else {
        await markExternalRequestFailed({
          externalRequestId: requestRecord.externalRequestId,
          errorMessage: error?.message,
        });
      }
    }

    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return respondInsufficientCredits(res);
    }

    const statusCode = error?.status || error?.response?.status || 500;
    return res.status(statusCode).json({
      message: error?.message || 'Internal server error while updating external user footer image.',
    });
  }
});

router.post('/join_videos', authenticateExternalRequest, async (req, res) => {
  let requestRecord = null;
  let reservedCredits = 0;
  try {
    const { webhookUrl } = req.body || {};
    const requestPayload = { ...(normalizeInputPayload(req) || {}) };
    const resolvedWebhookUrl = normalizeOptionalString(webhookUrl)
      || normalizeOptionalString(requestPayload.webhookUrl);
    const rawSourceRequestIds =
      requestPayload.source_request_ids ||
      requestPayload.request_ids ||
      requestPayload.session_ids ||
      requestPayload.sessionIds ||
      requestPayload.video_session_ids ||
      requestPayload.videoSessionIds;

    if (!Array.isArray(rawSourceRequestIds) || rawSourceRequestIds.length < 2) {
      return res.status(400).json({
        message: 'session_ids must be an array of at least 2 values.',
      });
    }

    if (await shouldUseInternalVideoSessionsRoute(req, rawSourceRequestIds)) {
      const response = await joinVideoSessionsAndQueueGeneration(req.userId, {
        ...requestPayload,
        session_ids: rawSourceRequestIds,
        webhookUrl: resolvedWebhookUrl || undefined,
      });
      setGenerationCreditHeaders(res, response);
      return res.status(200).json(response);
    }

    const {
      externalUser,
      normalizedRequestIds,
      sourceRequests,
      sourceSessionIds,
    } = await resolveExternalRouteSourceRequests({
      req,
      requestIds: rawSourceRequestIds,
    });

    requestPayload.source_request_ids = sourceRequests.map((sourceRequest) => sourceRequest.externalRequestId);
    requestPayload.source_session_ids = sourceSessionIds;
    requestPayload.request_ids = normalizedRequestIds;
    requestPayload.session_ids = sourceSessionIds;

    const billingPreview = await getJoinVideosBillingPreview(req.userId, requestPayload);

    requestRecord = await createExternalRequestRecord({
      externalUser,
      routeKey: 'join_videos',
      requestPayload,
      webhookUrl: resolvedWebhookUrl,
    });

    reservedCredits = billingPreview.creditsToCharge;
    if (reservedCredits > 0) {
      requestRecord = await reserveExternalRequestCredits({
        externalRequestId: requestRecord.externalRequestId,
        creditsToReserve: reservedCredits,
      });
    }

    const upstreamResponse = await joinVideoSessionsAndQueueGeneration(req.userId, {
      ...requestPayload,
      session_ids: sourceSessionIds,
      skipCreditDeduction: true,
      webhookUrl: resolvedWebhookUrl || undefined,
    });
    const sanitizedUpstreamResponse = sanitizeExternalFacingPayload(upstreamResponse);
    const upstreamSessionId = upstreamResponse?.session_id || upstreamResponse?.request_id;
    const acceptedCreditsCharged =
      Number(upstreamResponse?.creditsCharged) > 0
        ? Number(upstreamResponse.creditsCharged)
        : reservedCredits;

    await markExternalRequestAccepted({
      externalRequestId: requestRecord.externalRequestId,
      upstreamRequestId: upstreamSessionId,
      upstreamSessionId,
      responsePayload: sanitizedUpstreamResponse,
      creditsCharged: acceptedCreditsCharged,
    });
    await linkExternalRequestToSession({
      externalRequestId: requestRecord.externalRequestId,
      upstreamSessionId,
      externalUser,
    });
    if (acceptedCreditsCharged > 0) {
      res.set('x-credits-charged', String(acceptedCreditsCharged));
    }

    return res.status(200).json(
      buildAcceptedExternalResponse({
        externalRequestId: requestRecord.externalRequestId,
        upstreamResponse: sanitizedUpstreamResponse,
        creditsCharged: acceptedCreditsCharged,
      }),
    );
  } catch (error) {
    if (requestRecord) {
      if (reservedCredits > 0) {
        await refundExternalRequestCredits({
          externalRequestId: requestRecord.externalRequestId,
          creditsToRefund: reservedCredits,
          reason: error?.message,
        });
      } else {
        await markExternalRequestFailed({
          externalRequestId: requestRecord.externalRequestId,
          errorMessage: error?.message,
        });
      }
    }

    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return respondInsufficientCredits(res);
    }

    const statusCode = error?.status || error?.response?.status || 500;
    return res.status(statusCode).json({
      message: error?.message || 'Internal server error while joining external user videos.',
    });
  }
});

router.get('/status', authenticateExternalRequest, async (req, res) => {
  try {
    const scopedExternalUser = await maybeResolveExternalUserFromHeaders(req);
    const requestId = normalizeOptionalString(req.query.request_id || req.query.session_id);
    if (!requestId) {
      return res.status(400).json({
        message: 'request_id (or session_id) is required.',
      });
    }

    const externalRequest = await findExternalRequestForInternalUser({
      internalUserId: req.userId,
      requestId,
      externalUserId: scopedExternalUser?._id ?? null,
    });

    if (!externalRequest) {
      return res.status(404).json({ message: 'Request not found.' });
    }

    const { externalRequest: latestExternalRequest, upstreamStatus } =
      await syncExternalRequestWithUpstreamStatus({
        requestRecord: externalRequest,
        req,
      });

    if (!upstreamStatus) {
      return res.status(404).json({ message: 'Request not found.' });
    }

    return res.status(200).json(
      buildExternalStatusResponse({
        externalRequest: latestExternalRequest || externalRequest,
        upstreamStatus,
      }),
    );
  } catch (error) {
    return res.status(error?.status || 500).json({
      message: error?.message || 'Internal server error while fetching external request status.',
    });
  }
});

async function handleExternalDetailedStatus(req, res) {
  try {
    const scopedExternalUser = await maybeResolveExternalUserFromHeaders(req);
    const statusRequestPayload = normalizeInputPayload(req);
    const requestId =
      normalizeOptionalString(req.query.request_id || req.query.session_id) ||
      normalizeOptionalString(statusRequestPayload.request_id) ||
      normalizeOptionalString(statusRequestPayload.requestId) ||
      normalizeOptionalString(statusRequestPayload.session_id) ||
      normalizeOptionalString(statusRequestPayload.sessionId);
    if (!requestId) {
      return res.status(400).json({
        message: 'request_id (or session_id) is required.',
      });
    }

    const externalRequest = await findExternalRequestForInternalUser({
      internalUserId: req.userId,
      requestId,
      externalUserId: scopedExternalUser?._id ?? null,
    });

    if (!externalRequest) {
      return res.status(404).json({ message: 'Request not found.' });
    }

    const { externalRequest: latestExternalRequest, upstreamStatus } =
      await syncExternalRequestWithUpstreamStatus({
        requestRecord: externalRequest,
        req,
      });

    const requestRecord = latestExternalRequest || externalRequest;
    const requestPayload = requestRecord?.toObject?.() || requestRecord || {};
    const sessionId = normalizeOptionalString(requestPayload.upstreamSessionId) ||
      normalizeOptionalString(requestPayload.upstreamRequestId);
    const upstreamRequestId = normalizeOptionalString(requestPayload.upstreamRequestId) ||
      normalizeOptionalString(requestPayload.upstreamSessionId);

    if (!sessionId) {
      return res.status(404).json({ message: 'Request not found.' });
    }

    const detailedUpstreamStatus = await buildVideoStatusDetailedResponse({
      sessionId,
      requestId: upstreamRequestId || sessionId,
      provider: null,
      req,
      defaultResultUrl:
        normalizeOptionalString(requestPayload.resultUrl) ||
        normalizeOptionalString(requestPayload?.responsePayload?.result_url) ||
        undefined,
      defaultResultUrls: Array.isArray(requestPayload?.responsePayload?.result_urls)
        ? requestPayload.responsePayload.result_urls
        : undefined,
    });

    if (!detailedUpstreamStatus && !upstreamStatus) {
      return res.status(404).json({ message: 'Request not found.' });
    }

    const externalStatus = buildExternalStatusResponse({
      externalRequest: requestRecord,
      upstreamStatus: detailedUpstreamStatus || upstreamStatus,
    });
    if (externalStatus.session && typeof externalStatus.session === 'object') {
      externalStatus.session.id = requestPayload.externalRequestId;
      externalStatus.session.requestId = requestPayload.externalRequestId;
    }

    return res.status(200).json(externalStatus);
  } catch (error) {
    return res.status(error?.status || 500).json({
      message: error?.message || 'Internal server error while fetching detailed external request status.',
    });
  }
}

router.get('/status_detailed', authenticateExternalRequest, handleExternalDetailedStatus);
router.post('/status_detailed', authenticateExternalRequest, handleExternalDetailedStatus);

export default router;
