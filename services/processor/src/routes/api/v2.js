import express from 'express';
import mongoose from 'mongoose';

import apiIndexRouter from './index.js';
import assistantApiRouter from './assistant.js';
import chatApiRouter from './chat.js';
import externalUsersApiRouter from './external_users.js';
import imageApiRouter from './image.js';
import videoApiRouter from './video.js';
import externalApiRouter from '../external/api.js';
import { getDBConnectionString } from '../../models/DBString.js';
import { deductGenerationCredits } from '../../models/GenerationCredits.js';
import { createPublicationForSessionVideo, unpublishSessionVideo } from '../../models/Publication.js';
import { createNewBlankQuickSession } from '../../models/QuickSession.js';
import { calculateExternalUserUtilityCharge } from '../../models/api/ExternalUserUtilityAPI.js';
import {
  createAppKeyForUser,
  getActiveAppKeyForUser,
  getAppKeyCredentialsFromAuthHeaders,
  refreshAppKey,
  revokeAppKeyForUser,
} from '../../models/api/AppKeyAPI.js';
import {
  stripDeprecatedVideoModelSubtypeOptions,
  validateMovieInput,
} from '../../models/api/PromptUtils.js';
import {
  buildExternalVideoDetailedStatus,
  buildExternalVideoStatus,
  requestExternalImageToVideo,
  requestExternalLipSyncVideo,
  requestExternalSoundEffectVideo,
  requestExternalTextToVideo,
} from '../../models/api/ExternalVideoAPI.js';
import {
  buildStepVideoDetailedStatus,
  buildStepVideoStatus,
  getStepVideoSessionIdFromRequest,
  processNextStepVideoStage,
  requestStepImageToVideo,
  requestStepLipSyncVideo,
  requestStepSoundEffectVideo,
  requestStepTextToVideo,
} from '../../models/api/StepVideoAPI.js';
import { buildVideoStatusDetailedResponse } from '../../models/api/StatusAPI.js';
import {
  createV2UserRechargeCheckoutSession,
  refreshProgrammaticAuthToken,
} from '../../models/api/UserRechargeAPI.js';
import {
  buildExternalIdentityKey,
  findExternalRequestsForInternalUser,
  formatExternalUser,
  normalizeExternalUserPayload,
  resolveExternalUserFromAuthHeaders,
  resolveRequestActorFromAuthHeaders,
  upsertExternalUser,
} from '../../models/external/User.js';
import { getUserUsageLogs } from '../../models/Usage.js';
import ExternalUser from '../../schema/ExternalUser.js';
import GlobalSession from '../../schema/GlobalSession.js';
import User from '../../schema/User.js';
import VideoSession from '../../schema/VideoSession.js';

const router = express.Router();
const DEFAULT_V2_EXTERNAL_USER_PROVIDER = 'samsar_v2';

function normalizeOptionalString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeInputPayload(req) {
  if (req.body?.input && typeof req.body.input === 'object' && !Array.isArray(req.body.input)) {
    const inputPayload = req.body.input;
    const routeConfig =
      req.body.configuration ??
      req.body.config ??
      req.body.model_config ??
      req.body.modelConfig ??
      req.body.custom_model_config ??
      req.body.customModelConfig ??
      req.body.custom_models ??
      req.body.customModels;
    if (routeConfig !== undefined && inputPayload.configuration === undefined) {
      inputPayload.configuration = routeConfig;
    }
    return inputPayload;
  }
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  return {};
}

function hasExplicitExternalUserPayload(req) {
  const body = req.body || {};
  const input = body.input || {};
  const query = req.query || {};

  return Boolean(
    body.external_user ||
    body.externalUser ||
    input.external_user ||
    input.externalUser ||
    query.external_user ||
    query.externalUser ||
    query.external_user_id ||
    query.externalUserId ||
    query.unique_key ||
    query.uniqueKey ||
    query.external_app_id ||
    query.externalAppId ||
    body.unique_key ||
    body.uniqueKey ||
    input.unique_key ||
    input.uniqueKey ||
    query.provider,
  );
}

function getObjectPayload(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function getExternalUserObject(payload = {}) {
  return getObjectPayload(payload.external_user || payload.externalUser);
}

function getExternalUserUniqueKey(payload = {}) {
  const externalUser = getExternalUserObject(payload);
  return (
    normalizeOptionalString(externalUser.unique_key) ||
    normalizeOptionalString(externalUser.uniqueKey) ||
    normalizeOptionalString(payload.unique_key) ||
    normalizeOptionalString(payload.uniqueKey) ||
    normalizeOptionalString(externalUser.external_user_id) ||
    normalizeOptionalString(externalUser.externalUserId) ||
    normalizeOptionalString(payload.external_user_id) ||
    normalizeOptionalString(payload.externalUserId)
  );
}

function getExternalUserId(payload = {}) {
  const externalUser = getExternalUserObject(payload);
  return (
    normalizeOptionalString(externalUser.external_user_id) ||
    normalizeOptionalString(externalUser.externalUserId) ||
    normalizeOptionalString(payload.external_user_id) ||
    normalizeOptionalString(payload.externalUserId)
  );
}

function buildCreateExternalUserPayload(
  payload = {},
  { createdVia = 'v2_create_external_user' } = {},
) {
  const externalUser = getExternalUserObject(payload);
  const uniqueKey = getExternalUserUniqueKey(payload);
  if (!uniqueKey) {
    const error = new Error('unique_key or external_user_id is required.');
    error.status = 400;
    throw error;
  }

  const externalUserId = getExternalUserId(payload) || uniqueKey;
  const provider =
    normalizeOptionalString(externalUser.provider) ||
    normalizeOptionalString(payload.provider) ||
    DEFAULT_V2_EXTERNAL_USER_PROVIDER;
  const metadata = {
    ...getObjectPayload(payload.metadata),
    ...getObjectPayload(externalUser.metadata),
    createdVia,
  };
  Object.keys(metadata).forEach((key) => {
    if (metadata[key] === undefined || metadata[key] === null) {
      delete metadata[key];
    }
  });

  return {
    external_user: {
      ...externalUser,
      provider,
      external_user_id: externalUserId,
      unique_key: uniqueKey,
      ...(normalizeOptionalString(externalUser.external_app_id) || normalizeOptionalString(externalUser.externalAppId) ||
      normalizeOptionalString(payload.external_app_id) || normalizeOptionalString(payload.externalAppId)
        ? {
            external_app_id:
              normalizeOptionalString(externalUser.external_app_id) ||
              normalizeOptionalString(externalUser.externalAppId) ||
              normalizeOptionalString(payload.external_app_id) ||
              normalizeOptionalString(payload.externalAppId),
          }
        : {}),
      ...(normalizeOptionalString(externalUser.external_company_id) || normalizeOptionalString(externalUser.externalCompanyId) ||
      normalizeOptionalString(payload.external_company_id) || normalizeOptionalString(payload.externalCompanyId)
        ? {
            external_company_id:
              normalizeOptionalString(externalUser.external_company_id) ||
              normalizeOptionalString(externalUser.externalCompanyId) ||
              normalizeOptionalString(payload.external_company_id) ||
              normalizeOptionalString(payload.externalCompanyId),
          }
        : {}),
      ...(normalizeOptionalString(externalUser.external_account_id) || normalizeOptionalString(externalUser.externalAccountId) ||
      normalizeOptionalString(payload.external_account_id) || normalizeOptionalString(payload.externalAccountId)
        ? {
            external_account_id:
              normalizeOptionalString(externalUser.external_account_id) ||
              normalizeOptionalString(externalUser.externalAccountId) ||
              normalizeOptionalString(payload.external_account_id) ||
              normalizeOptionalString(payload.externalAccountId),
          }
        : {}),
      ...(normalizeOptionalString(externalUser.email) || normalizeOptionalString(payload.email)
        ? { email: normalizeOptionalString(externalUser.email) || normalizeOptionalString(payload.email) }
        : {}),
      ...(normalizeOptionalString(externalUser.username) || normalizeOptionalString(payload.username)
        ? { username: normalizeOptionalString(externalUser.username) || normalizeOptionalString(payload.username) }
        : {}),
      ...(normalizeOptionalString(externalUser.display_name) || normalizeOptionalString(externalUser.displayName) ||
      normalizeOptionalString(payload.display_name) || normalizeOptionalString(payload.displayName)
        ? {
            display_name:
              normalizeOptionalString(externalUser.display_name) ||
              normalizeOptionalString(externalUser.displayName) ||
              normalizeOptionalString(payload.display_name) ||
              normalizeOptionalString(payload.displayName),
          }
        : {}),
      ...(normalizeOptionalString(externalUser.avatar_url) || normalizeOptionalString(externalUser.avatarUrl) ||
      normalizeOptionalString(payload.avatar_url) || normalizeOptionalString(payload.avatarUrl)
        ? {
            avatar_url:
              normalizeOptionalString(externalUser.avatar_url) ||
              normalizeOptionalString(externalUser.avatarUrl) ||
              normalizeOptionalString(payload.avatar_url) ||
              normalizeOptionalString(payload.avatarUrl),
          }
        : {}),
      ...(normalizeOptionalString(externalUser.user_type) || normalizeOptionalString(externalUser.userType) ||
      normalizeOptionalString(payload.user_type) || normalizeOptionalString(payload.userType)
        ? {
            user_type:
              normalizeOptionalString(externalUser.user_type) ||
              normalizeOptionalString(externalUser.userType) ||
              normalizeOptionalString(payload.user_type) ||
              normalizeOptionalString(payload.userType),
          }
        : {}),
      metadata,
    },
  };
}

function hydrateV2ExternalUserPayload(req) {
  if (req.body?.external_user || req.body?.externalUser) {
    return;
  }

  const payload = {
    ...(req.query || {}),
    ...(req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}),
    ...normalizeInputPayload(req),
  };

  if (!getExternalUserUniqueKey(payload)) {
    return;
  }

  const externalUserPayload = buildCreateExternalUserPayload(payload, {
    createdVia: 'v2_external_user_reference',
  });

  req.body = {
    ...(req.body && typeof req.body === 'object' ? req.body : {}),
    external_user: externalUserPayload.external_user,
  };
}

function isExternalRequestIdentifier(value) {
  const normalized = normalizeOptionalString(value);
  return Boolean(
    normalized &&
    (/^extreq_[a-f0-9]{32}$/i.test(normalized) || /^[a-f0-9]{32}$/i.test(normalized)),
  );
}

function getSourceSessionId(payload = {}) {
  return (
    normalizeOptionalString(payload.source_request_id) ||
    normalizeOptionalString(payload.sourceRequestId) ||
    normalizeOptionalString(payload.request_id) ||
    normalizeOptionalString(payload.requestId) ||
    normalizeOptionalString(payload.external_request_id) ||
    normalizeOptionalString(payload.externalRequestId) ||
    normalizeOptionalString(payload.external_session_id) ||
    normalizeOptionalString(payload.externalSessionId) ||
    normalizeOptionalString(payload.video_session_id) ||
    normalizeOptionalString(payload.videoSessionId) ||
    normalizeOptionalString(payload.video_sessionID) ||
    normalizeOptionalString(payload.videoSessionID) ||
    normalizeOptionalString(payload.session_id) ||
    normalizeOptionalString(payload.sessionId)
  );
}

function getSourceSessionIds(payload = {}) {
  const rawIds =
    payload.source_request_ids ||
    payload.sourceRequestIds ||
    payload.request_ids ||
    payload.requestIds ||
    payload.external_request_ids ||
    payload.externalRequestIds ||
    payload.external_session_ids ||
    payload.externalSessionIds ||
    payload.session_ids ||
    payload.sessionIds ||
    payload.video_session_ids ||
    payload.videoSessionIds;

  if (!Array.isArray(rawIds)) {
    const singleId = getSourceSessionId(payload);
    return singleId ? [singleId] : [];
  }

  return rawIds.map((value) => normalizeOptionalString(value)).filter(Boolean);
}

function getQuerySessionId(req) {
  return (
    normalizeOptionalString(req.query?.request_id) ||
    normalizeOptionalString(req.query?.requestId) ||
    normalizeOptionalString(req.query?.session_id) ||
    normalizeOptionalString(req.query?.sessionId) ||
    normalizeOptionalString(req.query?.external_request_id) ||
    normalizeOptionalString(req.query?.externalRequestId)
  );
}

function getStatusSessionId(req) {
  const payload = normalizeInputPayload(req);
  return (
    getQuerySessionId(req) ||
    normalizeOptionalString(req.params?.request_id) ||
    normalizeOptionalString(req.params?.requestId) ||
    normalizeOptionalString(req.params?.session_id) ||
    normalizeOptionalString(req.params?.sessionId) ||
    normalizeOptionalString(payload.request_id) ||
    normalizeOptionalString(payload.requestId) ||
    normalizeOptionalString(payload.session_id) ||
    normalizeOptionalString(payload.sessionId) ||
    normalizeOptionalString(payload.external_request_id) ||
    normalizeOptionalString(payload.externalRequestId)
  );
}

function preserveQuery(req, routePath) {
  const queryIndex = req.url.indexOf('?');
  const query = queryIndex >= 0 ? req.url.slice(queryIndex) : '';
  return `${routePath}${query}`;
}

function hydrateExternalUserPayloadFromQuery(req) {
  if (req.body?.external_user || req.body?.externalUser) {
    return;
  }

  const provider = normalizeOptionalString(req.query?.provider);
  const externalUserId =
    normalizeOptionalString(req.query?.external_user_id) ||
    normalizeOptionalString(req.query?.externalUserId);
  if (!provider || !externalUserId) {
    return;
  }

  req.body = {
    ...(req.body && typeof req.body === 'object' ? req.body : {}),
    external_user: {
      provider,
      external_user_id: externalUserId,
      ...(normalizeOptionalString(req.query?.external_app_id) || normalizeOptionalString(req.query?.externalAppId)
        ? {
            external_app_id:
              normalizeOptionalString(req.query?.external_app_id) ||
              normalizeOptionalString(req.query?.externalAppId),
          }
        : {}),
      ...(normalizeOptionalString(req.query?.external_company_id) || normalizeOptionalString(req.query?.externalCompanyId)
        ? {
            external_company_id:
              normalizeOptionalString(req.query?.external_company_id) ||
              normalizeOptionalString(req.query?.externalCompanyId),
          }
        : {}),
      ...(normalizeOptionalString(req.query?.external_account_id) || normalizeOptionalString(req.query?.externalAccountId)
        ? {
            external_account_id:
              normalizeOptionalString(req.query?.external_account_id) ||
              normalizeOptionalString(req.query?.externalAccountId),
          }
        : {}),
    },
  };
}

function delegateToRouter(req, res, next, targetRouter, routePath, mountedBasePath) {
  const delegatedUrl = preserveQuery(req, routePath);
  req.url = delegatedUrl;
  req.originalUrl = `${mountedBasePath}${delegatedUrl}`;
  return targetRouter.handle(req, res, next);
}

function delegateToVideo(req, res, next, routePath) {
  hydrateV2ExternalUserPayload(req);
  return delegateToRouter(req, res, next, videoApiRouter, routePath, '/v2');
}

function normalizeV2ImageListToVideoPayload(req) {
  const inputPayload = normalizeInputPayload(req);
  if (!inputPayload || typeof inputPayload !== 'object' || Array.isArray(inputPayload)) {
    return;
  }

  const ctaUrl =
    normalizeOptionalString(inputPayload.cta_url) ||
    normalizeOptionalString(inputPayload.ctaUrl);
  const rawAddOutroAnimation =
    inputPayload.add_outro_animation ??
    inputPayload.addOutroAnimation;

  delete inputPayload.outro_image_url;
  delete inputPayload.outroImageUrl;
  delete inputPayload.new_outro_image_url;
  delete inputPayload.newOutroImageUrl;
  delete inputPayload.add_outro_focus_area;
  delete inputPayload.addOutroFocusArea;
  delete inputPayload.outro_focust_area;
  delete inputPayload.outro_focus_area;
  delete inputPayload.outroFocustArea;
  delete inputPayload.outroFocusArea;

  if (!ctaUrl) {
    return;
  }

  inputPayload.cta_url = ctaUrl;
  delete inputPayload.ctaUrl;
  inputPayload.generate_outro_image = true;
  delete inputPayload.generateOutroImage;

  if (rawAddOutroAnimation === undefined || rawAddOutroAnimation === null) {
    inputPayload.add_outro_animation = true;
  } else {
    inputPayload.add_outro_animation = rawAddOutroAnimation;
  }
  delete inputPayload.addOutroAnimation;
}

function normalizeV2FooterPayload(req) {
  const inputPayload = normalizeInputPayload(req);
  if (!inputPayload || typeof inputPayload !== 'object' || Array.isArray(inputPayload)) {
    return;
  }

  const footerMetadata = inputPayload.footer_metadata ?? inputPayload.footerMetadata;
  if (
    Array.isArray(footerMetadata) &&
    footerMetadata.length > 0 &&
    inputPayload.add_footer_animation === undefined &&
    inputPayload.addFooterAnimation === undefined
  ) {
    inputPayload.add_footer_animation = true;
  }
}

function getAliasedPayloadValue(payload, aliases) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined;
  }

  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(payload, alias) && payload[alias] !== undefined) {
      return payload[alias];
    }
  }

  return undefined;
}

function normalizeV2UpdateFooterImagePayload(req) {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return;
  }

  if (!body.input || typeof body.input !== 'object' || Array.isArray(body.input)) {
    return;
  }

  let inputPayload = body.input;
  if (inputPayload.input && typeof inputPayload.input === 'object' && !Array.isArray(inputPayload.input)) {
    inputPayload = {
      ...inputPayload.input,
      ...inputPayload,
    };
    delete inputPayload.input;
    body.input = inputPayload;
  }

  const passthroughFields = [
    ['videoSessionId', [
      'videoSessionId',
      'video_session_id',
      'videoSessionID',
      'session_id',
      'sessionId',
      'sessionID',
      'request_id',
      'requestId',
      'source_request_id',
      'sourceRequestId',
      'external_request_id',
      'externalRequestId',
      'external_session_id',
      'externalSessionId',
    ]],
    ['remove_footer', ['remove_footer', 'removeFooter']],
    ['cta_text', ['cta_text', 'ctaText']],
    ['cta_logo', ['cta_logo', 'ctaLogo']],
    ['cta_url', ['cta_url', 'ctaUrl']],
  ];

  for (const [canonicalName, aliases] of passthroughFields) {
    const inputValue = getAliasedPayloadValue(inputPayload, aliases);
    if (inputValue !== undefined) {
      continue;
    }

    const bodyValue = getAliasedPayloadValue(body, aliases);
    if (bodyValue !== undefined) {
      inputPayload[canonicalName] = bodyValue;
    }
  }
}

function delegateToExternal(req, res, next, routePath) {
  hydrateV2ExternalUserPayload(req);
  hydrateExternalUserPayloadFromQuery(req);
  return delegateToRouter(req, res, next, externalUsersApiRouter, routePath, '/v2');
}

function delegateToInternalApi(req, res, next, routePath) {
  return delegateToRouter(req, res, next, apiIndexRouter, routePath, '/v2');
}

function normalizeV2ImageApiPayload(req) {
  const inputPayload = normalizeInputPayload(req);
  if (inputPayload && typeof inputPayload === 'object' && !Array.isArray(inputPayload)) {
    req.body = inputPayload;
  }
}

function delegateToImage(req, res, next, routePath) {
  normalizeV2ImageApiPayload(req);
  return delegateToRouter(req, res, next, imageApiRouter, routePath, '/v2');
}

async function resolveV2AuthContext(req) {
  const authContext = await resolveRequestActorFromAuthHeaders(req.headers);
  const externalUser =
    authContext.externalUser ||
    await resolveExternalUserFromAuthHeaders({
      internalUserId: authContext.internalUserId,
      headers: req.headers,
    });

  req.userId = authContext.internalUserId;
  req.authType = authContext.authType;
  req.customerSubAccount = authContext.customerSubAccount || null;
  req.externalUser = externalUser || null;

  return {
    ...authContext,
    externalUser,
  };
}

function sendAuthError(res, error) {
  if (
    error?.code === 'API_KEY_EXPIRED' ||
    error?.code === 'CUSTOMER_SUB_ACCOUNT_API_KEY_EXPIRED' ||
    error?.code === 'APP_KEY_EXPIRED'
  ) {
    return res.status(401).json({ message: error.message });
  }

  return res.status(error?.status || 500).json({
    message: error?.message || 'Internal server error while validating API key or auth token.',
  });
}

function shouldUseExternalIdentity(req, authContext) {
  return Boolean(
    authContext?.externalUser ||
    authContext?.authType === 'external_auth' ||
    authContext?.authType === 'customer_sub_account_api_key' ||
    hasExplicitExternalUserPayload(req)
  );
}

function assertAppKeyManagementCredential(authContext) {
  if (authContext?.authType === 'api_key' || authContext?.authType === 'auth_token') {
    return;
  }

  const error = new Error('Use a Samsar API key or user auth token to manage APP_KEY credentials.');
  error.status = 403;
  throw error;
}

function assertCreateExternalUserCredential(authContext) {
  if (
    authContext?.authType === 'api_key' ||
    authContext?.authType === 'auth_token' ||
    authContext?.authType === 'app_key'
  ) {
    return;
  }

  const error = new Error('Use an internal Samsar API key, auth token, or APP_KEY to create external users.');
  error.status = 403;
  throw error;
}

async function assertExternalUserIdentityBelongsToInternalUser({
  internalUserId,
  externalUserPayload,
}) {
  const normalized = normalizeExternalUserPayload(externalUserPayload);
  const uniqueKey = normalizeOptionalString(normalized.uniqueKey) ||
    normalizeOptionalString(normalized.externalUserId);
  const externalIdentityKey = buildExternalIdentityKey(normalized);
  if (!uniqueKey || !externalIdentityKey) {
    const error = new Error('Unable to build external user identity.');
    error.status = 400;
    throw error;
  }

  await getDBConnectionString();
  const existingExternalUser = await ExternalUser.findOne({
    $or: [
      { uniqueKey },
      { externalIdentityKey },
    ],
  })
    .select('internalUserId')
    .lean();
  const existingInternalUserId =
    existingExternalUser?.internalUserId?.toString?.() ||
    existingExternalUser?.internalUserId ||
    null;
  const normalizedInternalUserId = internalUserId?.toString?.() || internalUserId;

  if (existingInternalUserId && existingInternalUserId !== normalizedInternalUserId) {
    const error = new Error('External user unique key is already associated with another internal user.');
    error.status = 409;
    throw error;
  }
}

async function hasExternalRequestMapping({ internalUserId, requestIds }) {
  const normalizedIds = Array.isArray(requestIds)
    ? requestIds.map((value) => normalizeOptionalString(value)).filter(Boolean)
    : [];

  if (!normalizedIds.length) {
    return false;
  }

  if (normalizedIds.some((requestId) => isExternalRequestIdentifier(requestId))) {
    return true;
  }

  const requestRecords = await findExternalRequestsForInternalUser({
    internalUserId,
    requestIds: normalizedIds,
    externalUserId: null,
  });
  if (requestRecords.length > 0) {
    return true;
  }

  const objectIds = normalizedIds.filter((requestId) => mongoose.Types.ObjectId.isValid(requestId));
  if (!objectIds.length) {
    return false;
  }

  await getDBConnectionString();
  const externalSession = await VideoSession.findOne({
    _id: { $in: objectIds },
    userId: internalUserId,
    $or: [
      { externalRequestId: { $exists: true, $ne: null } },
      { externalRequestUserId: { $exists: true, $ne: null } },
      { isExternalUserRequest: true },
    ],
  })
    .select('_id')
    .lean();

  return Boolean(externalSession);
}

async function shouldUseExternalRoute(req, { requestIds = [] } = {}) {
  const authContext = await resolveV2AuthContext(req);
  if (shouldUseExternalIdentity(req, authContext)) {
    return true;
  }

  return hasExternalRequestMapping({
    internalUserId: authContext.internalUserId,
    requestIds,
  });
}

async function routeExternalOrInternal({
  req,
  res,
  next,
  externalPath,
  internalRouter,
  internalPath,
  requestIds = [],
}) {
  try {
    if (await shouldUseExternalRoute(req, { requestIds })) {
      return delegateToExternal(req, res, next, externalPath);
    }

    return delegateToRouter(req, res, next, internalRouter, internalPath, '/v2');
  } catch (error) {
    return sendAuthError(res, error);
  }
}

async function resolveInternalVideoSessionId(userId, rawRequestId) {
  const requestId = normalizeOptionalString(rawRequestId);
  if (!requestId) {
    return null;
  }

  await getDBConnectionString();
  const normalizedUserId = userId?.toString?.() || userId;

  if (mongoose.Types.ObjectId.isValid(requestId)) {
    const directSession = await VideoSession.findOne({
      _id: requestId,
      userId: normalizedUserId,
    })
      .select('_id')
      .lean();
    if (directSession?._id) {
      return directSession._id.toString();
    }
  }

  const globalSession = await GlobalSession.findOne({
    userId: normalizedUserId,
    sessionType: 'video',
    $or: [
      { sessionId: requestId },
      { requestId },
      { apiSessionId: requestId },
    ],
  })
    .select('sessionId')
    .lean();

  return normalizeOptionalString(globalSession?.sessionId);
}

async function handleInternalSession(req, res) {
  try {
    const authContext = await resolveV2AuthContext(req);
    if (shouldUseExternalIdentity(req, authContext)) {
      return delegateToExternal(req, res, () => {}, '/session');
    }

    await getDBConnectionString();
    const user = await User.findById(authContext.internalUserId)
      .select('_id email displayName username pfpUrl generationCredits preferredLanguage')
      .lean();

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const remainingCredits = Number(user.generationCredits) || 0;
    res.set('x-credits-remaining', remainingCredits.toString());
    return res.status(200).json({
      account_type: 'internal',
      auth_type: authContext.authType,
      user: {
        id: user._id?.toString?.() || authContext.internalUserId,
        email: user.email || null,
        displayName: user.displayName || null,
        username: user.username || null,
        pfpUrl: user.pfpUrl || null,
        preferredLanguage: user.preferredLanguage || null,
      },
      remainingCredits,
    });
  } catch (error) {
    return sendAuthError(res, error);
  }
}

async function handleInternalAssistantSession(req, res) {
  try {
    const authContext = await resolveV2AuthContext(req);
    if (shouldUseExternalIdentity(req, authContext)) {
      return delegateToExternal(req, res, () => {}, '/utils/assistant_session');
    }

    const payload = normalizeInputPayload(req);
    const sessionId = await createNewBlankQuickSession(authContext.internalUserId);
    const now = new Date();
    const sessionName =
      normalizeOptionalString(payload.session_name) ||
      normalizeOptionalString(payload.sessionName) ||
      'Assistant session';
    const metadata =
      payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
        ? payload.metadata
        : {};

    const session = await VideoSession.findByIdAndUpdate(
      sessionId,
      {
        $set: {
          sessionName,
          sessionType: 'assistant',
          metadata: {
            ...metadata,
            v2AssistantSession: true,
          },
          lastActivityAt: now,
        },
      },
      { new: true },
    );

    return res.status(200).json({
      session_id: session?._id?.toString?.() || sessionId,
      request_id: session?._id?.toString?.() || sessionId,
      session_type: session?.sessionType || 'assistant',
      session_name: session?.sessionName || sessionName,
      created_at: session?.createdAt ?? now,
      updated_at: session?.updatedAt ?? now,
      metadata: session?.metadata ?? metadata,
    });
  } catch (error) {
    return res.status(error?.status || 500).json({
      message: error?.message || 'Internal server error while creating assistant session.',
    });
  }
}

async function handleInternalUtilityCharge(req, res) {
  try {
    const authContext = await resolveV2AuthContext(req);
    if (shouldUseExternalIdentity(req, authContext)) {
      return delegateToExternal(req, res, () => {}, '/utils/usage_charge');
    }

    const payload = normalizeInputPayload(req);
    const quote = calculateExternalUserUtilityCharge(payload);
    const metadata =
      payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
        ? payload.metadata
        : {};
    const deduction = await deductGenerationCredits(authContext.internalUserId, quote.credits, {
      source: `utility_${quote.utilityType}`,
      metadata: {
        requestType: 'API',
        apiVersion: 'v2',
        category: 'utility',
        utilityType: quote.utilityType,
        provider: quote.provider,
        model: quote.model,
        costUsd: quote.costUsd,
        samsarCreditsPerUsd: quote.creditsPerDollar,
        samsarUsdPerCredit: quote.samsarUsdPerCredit,
        pricingMultiplier: quote.pricingMultiplier,
        creditsCalculated: quote.credits,
        units: quote.units,
        ...metadata,
      },
    });

    res.set('x-credits-charged', quote.credits.toString());
    if (deduction.remainingCredits !== undefined && deduction.remainingCredits !== null) {
      res.set('x-credits-remaining', deduction.remainingCredits.toString());
    }

    return res.status(200).json({
      utilityType: quote.utilityType,
      provider: quote.provider,
      model: quote.model,
      creditsCharged: quote.credits,
      remainingCredits: deduction.remainingCredits ?? null,
      pricing: {
        costUsd: quote.costUsd,
        pricingMultiplier: quote.pricingMultiplier,
        creditsPerDollar: quote.creditsPerDollar,
        samsarUsdPerCredit: quote.samsarUsdPerCredit,
        units: quote.units,
      },
    });
  } catch (error) {
    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({ message: 'Insufficient credits.' });
    }

    return res.status(error?.status || 500).json({
      message: error?.message || 'Internal server error while charging utility usage.',
    });
  }
}

function getWebhookUrlFromStepRequest(req, payload = {}) {
  return (
    normalizeOptionalString(req.body?.webhookUrl) ||
    normalizeOptionalString(req.body?.webhook_url) ||
    normalizeOptionalString(payload.webhookUrl) ||
    normalizeOptionalString(payload.webhook_url)
  );
}

async function handleStepTextToVideo(req, res) {
  try {
    const authContext = await resolveV2AuthContext(req);
    const payload = normalizeInputPayload(req);
    stripDeprecatedVideoModelSubtypeOptions(payload);
    const validation = validateMovieInput(payload);
    if (!validation.status) {
      return res.status(400).json({ message: validation.message });
    }

    const response = await requestStepTextToVideo({
      userId: authContext.internalUserId,
      payload,
      webhookUrl: getWebhookUrlFromStepRequest(req, payload),
      req,
    });
    return res.status(200).json(response);
  } catch (error) {
    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({ message: 'Insufficient credits.' });
    }
    return res.status(error?.status || error?.response?.status || 500).json({
      message: error?.message || 'Internal server error while creating step text-to-video request.',
    });
  }
}

async function handleStepImageToVideo(req, res) {
  try {
    const authContext = await resolveV2AuthContext(req);
    const payload = normalizeInputPayload(req);
    const response = await requestStepImageToVideo({
      userId: authContext.internalUserId,
      payload,
      webhookUrl: getWebhookUrlFromStepRequest(req, payload),
      req,
    });
    return res.status(200).json(response);
  } catch (error) {
    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({ message: 'Insufficient credits.' });
    }
    return res.status(error?.status || error?.response?.status || 500).json({
      message: error?.message || 'Internal server error while creating step image-to-video request.',
    });
  }
}

async function handleStepLipSyncVideo(req, res) {
  try {
    const authContext = await resolveV2AuthContext(req);
    const payload = normalizeInputPayload(req);
    const response = await requestStepLipSyncVideo({
      userId: authContext.internalUserId,
      payload,
      req,
    });
    return res.status(200).json(response);
  } catch (error) {
    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({ message: 'Insufficient credits.' });
    }
    return res.status(error?.status || error?.response?.status || 500).json({
      message: error?.message || 'Internal server error while creating step lip-sync request.',
    });
  }
}

async function handleStepSoundEffectVideo(req, res) {
  try {
    const authContext = await resolveV2AuthContext(req);
    const payload = normalizeInputPayload(req);
    const response = await requestStepSoundEffectVideo({
      userId: authContext.internalUserId,
      payload,
      req,
    });
    return res.status(200).json(response);
  } catch (error) {
    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({ message: 'Insufficient credits.' });
    }
    return res.status(error?.status || error?.response?.status || 500).json({
      message: error?.message || 'Internal server error while creating step sound-effect request.',
    });
  }
}

async function handleStepVideoStatus(req, res) {
  try {
    const authContext = await resolveV2AuthContext(req);
    const sessionId = getStepVideoSessionIdFromRequest(req);
    if (!sessionId) {
      return res.status(400).json({ message: 'request_id or session_id is required.' });
    }

    const response = await buildStepVideoStatus({
      userId: authContext.internalUserId,
      sessionId,
      req,
    });
    if (!response) {
      return res.status(404).json({ message: 'Step video request not found.' });
    }
    return res.status(200).json(response);
  } catch (error) {
    return res.status(error?.status || error?.response?.status || 500).json({
      message: error?.message || 'Internal server error while fetching step video status.',
    });
  }
}

async function handleStepVideoDetailedStatus(req, res) {
  try {
    const authContext = await resolveV2AuthContext(req);
    const sessionId = getStepVideoSessionIdFromRequest(req);
    if (!sessionId) {
      return res.status(400).json({ message: 'request_id or session_id is required.' });
    }

    const response = await buildStepVideoDetailedStatus({
      userId: authContext.internalUserId,
      sessionId,
      req,
    });
    if (!response) {
      return res.status(404).json({ message: 'Step video request not found.' });
    }
    return res.status(200).json(response);
  } catch (error) {
    return res.status(error?.status || error?.response?.status || 500).json({
      message: error?.message || 'Internal server error while fetching detailed step video status.',
    });
  }
}

async function handleExternalTextToVideo(req, res) {
  try {
    const authContext = await resolveV2AuthContext(req);
    const payload = normalizeInputPayload(req);
    stripDeprecatedVideoModelSubtypeOptions(payload);
    const validation = validateMovieInput(payload);
    if (!validation.status) {
      return res.status(400).json({ message: validation.message });
    }

    const response = await requestExternalTextToVideo({
      userId: authContext.internalUserId,
      payload,
      webhookUrl: getWebhookUrlFromStepRequest(req, payload),
      req,
    });
    return res.status(200).json(response);
  } catch (error) {
    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({ message: 'Insufficient credits.' });
    }
    return res.status(error?.status || error?.response?.status || 500).json({
      message: error?.message || 'Internal server error while creating external text-to-video request.',
    });
  }
}

async function handleExternalImageToVideo(req, res) {
  try {
    const authContext = await resolveV2AuthContext(req);
    const payload = normalizeInputPayload(req);
    const response = await requestExternalImageToVideo({
      userId: authContext.internalUserId,
      payload,
      webhookUrl: getWebhookUrlFromStepRequest(req, payload),
      req,
    });
    return res.status(200).json(response);
  } catch (error) {
    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({ message: 'Insufficient credits.' });
    }
    return res.status(error?.status || error?.response?.status || 500).json({
      message: error?.message || 'Internal server error while creating external image-to-video request.',
    });
  }
}

async function handleExternalLipSyncVideo(req, res) {
  try {
    const authContext = await resolveV2AuthContext(req);
    const payload = normalizeInputPayload(req);
    const response = await requestExternalLipSyncVideo({
      userId: authContext.internalUserId,
      payload,
      req,
    });
    return res.status(200).json(response);
  } catch (error) {
    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({ message: 'Insufficient credits.' });
    }
    return res.status(error?.status || error?.response?.status || 500).json({
      message: error?.message || 'Internal server error while creating external lip-sync request.',
    });
  }
}

async function handleExternalSoundEffectVideo(req, res) {
  try {
    const authContext = await resolveV2AuthContext(req);
    const payload = normalizeInputPayload(req);
    const response = await requestExternalSoundEffectVideo({
      userId: authContext.internalUserId,
      payload,
      req,
    });
    return res.status(200).json(response);
  } catch (error) {
    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({ message: 'Insufficient credits.' });
    }
    return res.status(error?.status || error?.response?.status || 500).json({
      message: error?.message || 'Internal server error while creating external sound-effect request.',
    });
  }
}

async function handleExternalVideoStatus(req, res) {
  try {
    const authContext = await resolveV2AuthContext(req);
    const sessionId = getStatusSessionId(req);
    if (!sessionId) {
      return res.status(400).json({ message: 'request_id or session_id is required.' });
    }

    const response = await buildExternalVideoStatus({
      userId: authContext.internalUserId,
      sessionId,
      req,
    });
    if (!response) {
      return res.status(404).json({ message: 'External video request not found.' });
    }
    return res.status(200).json(response);
  } catch (error) {
    return res.status(error?.status || error?.response?.status || 500).json({
      message: error?.message || 'Internal server error while fetching external video status.',
    });
  }
}

async function handleExternalVideoDetailedStatus(req, res) {
  try {
    const authContext = await resolveV2AuthContext(req);
    const sessionId = getStatusSessionId(req);
    if (!sessionId) {
      return res.status(400).json({ message: 'request_id or session_id is required.' });
    }

    const response = await buildExternalVideoDetailedStatus({
      userId: authContext.internalUserId,
      sessionId,
      req,
    });
    if (!response) {
      return res.status(404).json({ message: 'External video request not found.' });
    }
    return res.status(200).json(response);
  } catch (error) {
    return res.status(error?.status || error?.response?.status || 500).json({
      message: error?.message || 'Internal server error while fetching detailed external video status.',
    });
  }
}

async function handleStepVideoProcessNext(req, res) {
  try {
    const authContext = await resolveV2AuthContext(req);
    const sessionId = getStepVideoSessionIdFromRequest(req);
    if (!sessionId) {
      return res.status(400).json({ message: 'request_id or session_id is required.' });
    }

    const response = await processNextStepVideoStage({
      userId: authContext.internalUserId,
      sessionId,
      req,
    });
    return res.status(200).json(response);
  } catch (error) {
    return res.status(error?.status || error?.response?.status || 500).json({
      message: error?.message || 'Internal server error while processing the next step.',
    });
  }
}

async function handleVideoDetailedStatus(req, res, next) {
  const requestId = getStatusSessionId(req);
  try {
    if (!requestId) {
      return res.status(400).json({ message: 'request_id (or session_id) is required.' });
    }

    if (await shouldUseExternalRoute(req, { requestIds: [requestId] })) {
      return delegateToExternal(req, res, next, '/status_detailed');
    }

    const sessionId = await resolveInternalVideoSessionId(req.userId, requestId);
    if (!sessionId) {
      return res.status(404).json({ message: 'Request not found.' });
    }

    const response = await buildVideoStatusDetailedResponse({
      sessionId,
      requestId,
      provider: null,
      req,
    });
    if (!response) {
      return res.status(404).json({ message: 'Request not found.' });
    }

    return res.status(200).json(response);
  } catch (error) {
    return sendAuthError(res, error);
  }
}

async function handleCreateExternalUser(req, res) {
  try {
    const authContext = await resolveV2AuthContext(req);
    assertCreateExternalUserCredential(authContext);

    const payload = req.method === 'GET' ? req.query : normalizeInputPayload(req);
    const externalUserPayload = buildCreateExternalUserPayload(payload);
    await assertExternalUserIdentityBelongsToInternalUser({
      internalUserId: authContext.internalUserId,
      externalUserPayload,
    });

    const externalUser = await upsertExternalUser({
      internalUserId: authContext.internalUserId,
      externalUserPayload,
    });
    const formattedExternalUser = formatExternalUser(externalUser);

    return res.status(201).json({
      unique_key: formattedExternalUser?.unique_key ?? null,
      provider: formattedExternalUser?.provider ?? null,
      external_user_id: formattedExternalUser?.external_user_id ?? null,
      external_app_id: formattedExternalUser?.external_app_id ?? null,
      external_user: formattedExternalUser,
      externalUser: formattedExternalUser,
      reference: {
        provider: formattedExternalUser?.provider ?? null,
        unique_key: formattedExternalUser?.unique_key ?? null,
        external_user_id: formattedExternalUser?.external_user_id ?? null,
        external_app_id: formattedExternalUser?.external_app_id ?? null,
      },
    });
  } catch (error) {
    return res.status(error?.status || error?.statusCode || 500).json({
      message: error?.message || 'Internal server error while creating external user.',
    });
  }
}

async function handleInternalRequests(req, res) {
  try {
    const authContext = await resolveV2AuthContext(req);
    if (shouldUseExternalIdentity(req, authContext)) {
      return delegateToExternal(req, res, () => {}, '/requests');
    }

    const limitRaw = Number(req.query?.limit);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(500, Math.max(1, Math.floor(limitRaw)))
      : 50;
    const sessionType = normalizeOptionalString(req.query?.type);
    const query = {
      userId: authContext.internalUserId,
      ...(sessionType ? { sessionType } : {}),
    };

    await getDBConnectionString();
    const sessions = await GlobalSession.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.status(200).json({
      requests: sessions.map((session) => ({
        request_id: session.requestId || session.sessionId,
        session_id: session.sessionId,
        type: session.sessionType,
        provider: session.provider || null,
        status: session.status || 'PENDING',
        result_url: session.resultUrl || null,
        result_urls: Array.isArray(session.resultUrls) ? session.resultUrls : [],
        thumbnail_url: session.thumbnailUrl || null,
        request_type: session.requestType || null,
        session_sub_type: session.sessionSubType || null,
        created_at: session.createdAt,
        updated_at: session.updatedAt,
        metadata: session.metadata || {},
      })),
    });
  } catch (error) {
    return sendAuthError(res, error);
  }
}

async function handleInternalArchive(req, res) {
  try {
    const payload = normalizeInputPayload(req);
    const requestId = getSourceSessionId(payload);
    if (!requestId) {
      return res.status(400).json({ message: 'request_id is required.' });
    }

    if (await shouldUseExternalRoute(req, { requestIds: [requestId] })) {
      return delegateToExternal(req, res, () => {}, '/archive');
    }

    const sessionId = await resolveInternalVideoSessionId(req.userId, requestId);
    if (!sessionId) {
      return res.status(404).json({ message: 'Request not found.' });
    }

    try {
      await unpublishSessionVideo(req.userId, { sessionId });
    } catch (error) {
      if (!/not found/i.test(error?.message || '')) {
        throw error;
      }
    }

    const now = new Date();
    await GlobalSession.updateMany(
      {
        userId: req.userId?.toString?.() || req.userId,
        $or: [
          { sessionId },
          { requestId },
          { apiSessionId: requestId },
        ],
      },
      {
        $set: {
          status: 'ARCHIVED',
          'metadata.archived': true,
          'metadata.archivedAt': now.toISOString(),
        },
      },
    );

    return res.status(200).json({
      request: {
        request_id: requestId,
        session_id: sessionId,
        status: 'ARCHIVED',
        archived: true,
        archived_at: now,
      },
    });
  } catch (error) {
    return res.status(error?.statusCode || error?.status || 500).json({
      message: error?.message || 'Internal server error while archiving video.',
    });
  }
}

async function handleInternalPublish(req, res) {
  try {
    const payload = normalizeInputPayload(req);
    const requestId = getSourceSessionId(payload);
    if (!requestId) {
      return res.status(400).json({ message: 'request_id is required.' });
    }

    if (await shouldUseExternalRoute(req, { requestIds: [requestId] })) {
      return delegateToExternal(req, res, () => {}, '/publish');
    }

    const sessionId = await resolveInternalVideoSessionId(req.userId, requestId);
    if (!sessionId) {
      return res.status(404).json({ message: 'Request not found.' });
    }

    const publication = await createPublicationForSessionVideo(req.userId, {
      ...payload,
      id: sessionId,
    });

    return res.status(200).json({
      publication: publication?.toObject?.() || publication || null,
    });
  } catch (error) {
    return res.status(error?.statusCode || error?.status || 500).json({
      message: error?.message || 'Internal server error while publishing video.',
    });
  }
}

async function handleV2UserRechargeCredits(req, res) {
  try {
    const payload = req.method === 'GET' ? req.query : normalizeInputPayload(req);
    const session = await createV2UserRechargeCheckoutSession(payload);

    return res.status(200).json({
      ...session,
      paymentStatusEndpoint: '/v2/user/payment_status',
    });
  } catch (error) {
    return res.status(error?.status || error?.statusCode || 500).json({
      message: error?.message || 'Internal server error while creating user recharge link.',
    });
  }
}

async function handleRefreshProgrammaticAuthToken(req, res) {
  try {
    const payload = req.method === 'GET' ? req.query : normalizeInputPayload(req);
    const headerRefreshToken =
      req.headers['x-refresh-token'] ||
      req.headers['refresh_token'] ||
      req.headers['refresh-token'];
    const refreshToken =
      payload.refreshToken ||
      payload.refresh_token ||
      headerRefreshToken;

    const result = await refreshProgrammaticAuthToken(refreshToken);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(error?.status || error?.statusCode || 500).json({
      message: error?.message || 'Internal server error while refreshing auth token.',
    });
  }
}

function getAppSecretFromPayload(payload = {}) {
  return (
    payload.secret ||
    payload.appSecret ||
    payload.app_secret ||
    payload.APP_SECRET
  );
}

function getAppKeyFromPayload(payload = {}) {
  return (
    payload.appKey ||
    payload.app_key ||
    payload.APP_KEY
  );
}

async function handleCreateV2UserAppKey(req, res) {
  try {
    const authContext = await resolveV2AuthContext(req);
    assertAppKeyManagementCredential(authContext);

    const payload = req.method === 'GET' ? req.query : normalizeInputPayload(req);
    const result = await createAppKeyForUser({
      userId: authContext.internalUserId,
      secret: getAppSecretFromPayload(payload),
      authType: authContext.authType,
      metadata: payload.metadata,
    });

    return res.status(201).json({
      app_key: result.appKey,
      appKey: result.appKey,
      token_type: result.tokenType,
      tokenType: result.tokenType,
      expires_at: result.expiresAt,
      expiresAt: result.expiresAt,
      app_key_record: result.appKeyRecord,
      appKeyRecord: result.appKeyRecord,
    });
  } catch (error) {
    return res.status(error?.status || error?.statusCode || 500).json({
      message: error?.message || 'Internal server error while creating APP_KEY.',
    });
  }
}

async function handleGetV2UserAppKey(req, res) {
  try {
    const authContext = await resolveV2AuthContext(req);
    assertAppKeyManagementCredential(authContext);

    const appKeyRecord = await getActiveAppKeyForUser(authContext.internalUserId);
    if (!appKeyRecord) {
      return res.status(404).json({ message: 'Active APP_KEY not found for this user.' });
    }

    return res.status(200).json({
      app_key_record: appKeyRecord,
      appKeyRecord,
    });
  } catch (error) {
    return res.status(error?.status || error?.statusCode || 500).json({
      message: error?.message || 'Internal server error while fetching APP_KEY.',
    });
  }
}

async function handleRefreshV2UserAppKey(req, res) {
  try {
    const payload = req.method === 'GET' ? req.query : normalizeInputPayload(req);
    const headerCredentials = getAppKeyCredentialsFromAuthHeaders(req.headers);
    const result = await refreshAppKey({
      appKey: getAppKeyFromPayload(payload) || headerCredentials.appKey,
      secret: getAppSecretFromPayload(payload) || headerCredentials.secret,
    });

    return res.status(200).json({
      app_key: result.appKey,
      appKey: result.appKey,
      token_type: result.tokenType,
      tokenType: result.tokenType,
      expires_at: result.expiresAt,
      expiresAt: result.expiresAt,
      app_key_record: result.appKeyRecord,
      appKeyRecord: result.appKeyRecord,
    });
  } catch (error) {
    return res.status(error?.status || error?.statusCode || 500).json({
      message: error?.message || 'Internal server error while refreshing APP_KEY.',
    });
  }
}

async function handleRevokeV2UserAppKey(req, res) {
  try {
    const authContext = await resolveV2AuthContext(req);
    assertAppKeyManagementCredential(authContext);

    const appKeyRecord = await revokeAppKeyForUser(authContext.internalUserId);
    return res.status(200).json({
      app_key_record: appKeyRecord,
      appKeyRecord,
    });
  } catch (error) {
    return res.status(error?.status || error?.statusCode || 500).json({
      message: error?.message || 'Internal server error while revoking APP_KEY.',
    });
  }
}

async function handleInternalUsageLogs(req, res) {
  try {
    const authContext = await resolveV2AuthContext(req);
    if (shouldUseExternalIdentity(req, authContext)) {
      return res.status(400).json({
        message: 'usage logs are available for internal user auth tokens, API keys, and APP_KEY credentials.',
      });
    }

    const { page, pageSize, limit } = req.query;
    const usage = await getUserUsageLogs(authContext.internalUserId, {
      page,
      pageSize: pageSize ?? limit,
    });

    return res.status(200).json(usage);
  } catch (error) {
    return sendAuthError(res, error);
  }
}

router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'v2-api',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  });
});

router.post('/external/video/text_to_video', handleExternalTextToVideo);
router.post('/external/video/image_to_video', handleExternalImageToVideo);
router.post('/external/video/lip_sync', handleExternalLipSyncVideo);
router.post('/external/video/sound_effect', handleExternalSoundEffectVideo);
router.get('/external/video/status', handleExternalVideoStatus);
router.post('/external/video/status', handleExternalVideoStatus);
router.get('/external/video/:request_id/status', handleExternalVideoStatus);
router.post('/external/video/:request_id/status', handleExternalVideoStatus);
router.get('/external/video/status_detailed', handleExternalVideoDetailedStatus);
router.post('/external/video/status_detailed', handleExternalVideoDetailedStatus);
router.get('/external/video/:request_id/status_detailed', handleExternalVideoDetailedStatus);
router.post('/external/video/:request_id/status_detailed', handleExternalVideoDetailedStatus);

router.use('/external', externalApiRouter);

router.post('/user/recharge_credits', handleV2UserRechargeCredits);
router.get('/user/recharge_credits', handleV2UserRechargeCredits);
router.post('/user/refresh_auth_token', handleRefreshProgrammaticAuthToken);
router.get('/user/refresh_auth_token', handleRefreshProgrammaticAuthToken);
router.post('/user/refresh_token', handleRefreshProgrammaticAuthToken);
router.get('/user/refresh_token', handleRefreshProgrammaticAuthToken);
router.post('/user/create_external_user', handleCreateExternalUser);
router.post(['/user/app_key', '/users/app_key'], handleCreateV2UserAppKey);
router.get(['/user/app_key', '/users/app_key'], handleGetV2UserAppKey);
router.delete(['/user/app_key', '/users/app_key'], handleRevokeV2UserAppKey);
router.post(['/user/app_key/refresh', '/users/app_key/refresh'], handleRefreshV2UserAppKey);
router.get(['/user/app_key/refresh', '/users/app_key/refresh'], handleRefreshV2UserAppKey);
router.post('/session', handleInternalSession);
router.post('/create_login_token', (req, res, next) => routeExternalOrInternal({
  req,
  res,
  next,
  externalPath: '/create_login_token',
  internalRouter: apiIndexRouter,
  internalPath: '/create_login_token',
}));
router.get('/credits', (req, res, next) => routeExternalOrInternal({
  req,
  res,
  next,
  externalPath: '/credits',
  internalRouter: apiIndexRouter,
  internalPath: '/credits',
}));
router.get('/user/credits', (req, res, next) => routeExternalOrInternal({
  req,
  res,
  next,
  externalPath: '/credits',
  internalRouter: apiIndexRouter,
  internalPath: '/credits',
}));
router.post('/credits/recharge', (req, res, next) => routeExternalOrInternal({
  req,
  res,
  next,
  externalPath: '/credits/recharge',
  internalRouter: apiIndexRouter,
  internalPath: '/credits/recharge',
}));
router.get('/user/usage/logs', handleInternalUsageLogs);
router.post('/credits/grant', async (req, res, next) => {
  try {
    if (await shouldUseExternalRoute(req)) {
      return delegateToExternal(req, res, next, '/credits/grant');
    }

    return res.status(400).json({
      message: 'credits/grant requires an external_user or external-user authentication.',
    });
  } catch (error) {
    return sendAuthError(res, error);
  }
});
router.get('/requests', handleInternalRequests);
router.post('/archive', handleInternalArchive);
router.post('/publish', handleInternalPublish);
router.get('/payment_status', (req, res, next) => routeExternalOrInternal({
  req,
  res,
  next,
  externalPath: '/payment_status',
  internalRouter: apiIndexRouter,
  internalPath: '/payment_status',
}));
router.post('/payment_status', (req, res, next) => routeExternalOrInternal({
  req,
  res,
  next,
  externalPath: '/payment_status',
  internalRouter: apiIndexRouter,
  internalPath: '/payment_status',
}));
router.get('/user/payment_status', (req, res, next) => routeExternalOrInternal({
  req,
  res,
  next,
  externalPath: '/payment_status',
  internalRouter: apiIndexRouter,
  internalPath: '/payment_status',
}));
router.post('/user/payment_status', (req, res, next) => routeExternalOrInternal({
  req,
  res,
  next,
  externalPath: '/payment_status',
  internalRouter: apiIndexRouter,
  internalPath: '/payment_status',
}));

router.post('/assistant/set_system_prompt', (req, res, next) => routeExternalOrInternal({
  req,
  res,
  next,
  externalPath: '/assistant/set_system_prompt',
  internalRouter: assistantApiRouter,
  internalPath: '/set_system_prompt',
}));
router.post('/assistant/completion', (req, res, next) => routeExternalOrInternal({
  req,
  res,
  next,
  externalPath: '/assistant/completion',
  internalRouter: assistantApiRouter,
  internalPath: '/completion',
}));
router.post('/utils/assistant_session', handleInternalAssistantSession);
router.post('/utils/usage_charge', handleInternalUtilityCharge);
router.post('/generate_embeddings_from_plain_text', (req, res, next) => routeExternalOrInternal({
  req,
  res,
  next,
  externalPath: '/generate_embeddings_from_plain_text',
  internalRouter: chatApiRouter,
  internalPath: '/generate_embeddings_from_plain_text',
}));

router.post('/upload_image_data', (req, res, next) => delegateToVideo(req, res, next, '/upload_image_data'));
router.post(['/image/assign_title', '/images/assign_title'], (req, res, next) => delegateToImage(req, res, next, '/assign_title'));
router.post('/image/enhance', (req, res, next) => delegateToImage(req, res, next, '/enhance'));
router.post('/image/remove_branding', (req, res, next) => delegateToImage(req, res, next, '/remove_branding'));
router.post('/image/add_image_set', (req, res, next) => delegateToImage(req, res, next, '/add_image_set'));
router.post('/image/text_to_image', (req, res, next) => delegateToImage(req, res, next, '/text_to_image'));
router.post(['/external/image/text_to_image', '/external/image/generate', '/external/image/generations'], (req, res, next) => delegateToImage(req, res, next, '/text_to_image'));
router.post('/external/image/assign_title', (req, res, next) => delegateToImage(req, res, next, '/assign_title'));
router.post('/external/image/enhance', (req, res, next) => delegateToImage(req, res, next, '/enhance'));
router.post('/external/image/remove_branding', (req, res, next) => delegateToImage(req, res, next, '/remove_branding'));
router.post('/external/image/add_image_set', (req, res, next) => delegateToImage(req, res, next, '/add_image_set'));
router.get('/external/image/status', (req, res, next) => delegateToImage(req, res, next, '/status'));
router.post('/video/step/text_to_video', handleStepTextToVideo);
router.post('/video/step/image_to_video', handleStepImageToVideo);
router.post('/video/step/lip_sync', handleStepLipSyncVideo);
router.post('/video/step/sound_effect', handleStepSoundEffectVideo);
router.get('/video/step/status', handleStepVideoStatus);
router.post('/video/step/status', handleStepVideoStatus);
router.get('/video/step/:request_id/status', handleStepVideoStatus);
router.post('/video/step/:request_id/status', handleStepVideoStatus);
router.get('/video/step/status_detailed', handleStepVideoDetailedStatus);
router.post('/video/step/status_detailed', handleStepVideoDetailedStatus);
router.get('/video/step/:request_id/status_detailed', handleStepVideoDetailedStatus);
router.post('/video/step/:request_id/status_detailed', handleStepVideoDetailedStatus);
router.post('/video/step/process_next', handleStepVideoProcessNext);
router.post('/video/step/:request_id/process_next', handleStepVideoProcessNext);
router.post('/text_to_video', (req, res, next) => {
  normalizeV2FooterPayload(req);
  return delegateToVideo(req, res, next, '/text_to_video');
});
router.post('/image_list_to_video', (req, res, next) => {
  normalizeV2ImageListToVideoPayload(req);
  normalizeV2FooterPayload(req);
  return delegateToVideo(req, res, next, '/image_list_to_video');
});
router.post('/translate_video', (req, res, next) => {
  const requestIds = getSourceSessionIds(normalizeInputPayload(req));
  return delegateToVideo(req, res, next, '/translate_video', requestIds);
});
router.post('/retranslate_video', (req, res, next) => {
  const requestIds = getSourceSessionIds(normalizeInputPayload(req));
  return delegateToVideo(req, res, next, '/translate_video', requestIds);
});
router.post('/add_outro_image', (req, res, next) => delegateToVideo(req, res, next, '/add_outro_image'));
router.post('/update_outro_image', (req, res, next) => delegateToVideo(req, res, next, '/update_outro_image'));
router.post('/update_footer_image', (req, res, next) => {
  normalizeV2UpdateFooterImagePayload(req);
  return delegateToVideo(req, res, next, '/update_footer_image');
});
router.post(['/video/add_subtitles', '/add_subtitles'], (req, res, next) => (
  delegateToVideo(req, res, next, '/add_subtitles')
));
router.post(['/video/remove_subtitles', '/remove_subtitles'], (req, res, next) => (
  delegateToVideo(req, res, next, '/remove_subtitles')
));
router.post('/join_videos', (req, res, next) => delegateToVideo(req, res, next, '/join_videos'));
router.post('/video/clone', (req, res, next) => delegateToVideo(req, res, next, '/clone'));
router.post('/video/regenerate_avatar', (req, res, next) => delegateToVideo(req, res, next, '/regenerate_avatar'));
router.post('/regenerate_avatar', (req, res, next) => delegateToVideo(req, res, next, '/regenerate_avatar'));
router.post('/video/reroll-layers', (req, res, next) => delegateToVideo(req, res, next, '/reroll-layers'));
router.post('/reroll-layers', (req, res, next) => delegateToVideo(req, res, next, '/reroll-layers'));
router.post('/cancel_render', (req, res, next) => delegateToVideo(req, res, next, '/cancel_render'));
router.post('/pause_render', (req, res, next) => delegateToVideo(req, res, next, '/pause_render'));
router.post('/resume_render', (req, res, next) => delegateToVideo(req, res, next, '/resume_render'));

router.get('/status', async (req, res, next) => {
  const requestId = getQuerySessionId(req);
  try {
    if (await shouldUseExternalRoute(req, { requestIds: requestId ? [requestId] : [] })) {
      return delegateToExternal(req, res, next, '/status');
    }

    return delegateToInternalApi(req, res, next, '/status');
  } catch (error) {
    return sendAuthError(res, error);
  }
});
router.get('/status_detailed', handleVideoDetailedStatus);
router.post('/status_detailed', handleVideoDetailedStatus);

export default router;
