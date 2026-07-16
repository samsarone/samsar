import OpenAI from 'openai';
import mongoose from 'mongoose';
import { createHash } from 'crypto';

import { DEFAULT_INFERENCE_MODEL, normalizeInferenceModel } from '../../consts/InferenceModels.js';
import ExternalAssistantRequest from '../../schema/ExternalAssistantRequest.js';
import { createCompatibleChatCompletion } from '../ai_utils/OpenAICompat.js';
import { getDBConnectionString } from '../DBString.js';
import { deductGenerationCredits } from '../GenerationCredits.js';
import {
  calculateAssistantCreditsFromUsage,
  calculateLegacyAssistantCredits,
  EXTERNAL_CHAT_PRICING_MULTIPLIER,
} from './AssistantBilling.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });
const DEFAULT_EXTERNAL_CHAT_TIMEOUT_MS = 10 * 60 * 1000;
const EXTERNAL_CHAT_POLL_PATH = '/v2/external/chat/status';
const ASYNC_CONTROL_FIELDS = new Set([
  'async',
  'async_mode',
  'asyncMode',
  'poll',
  'polling',
  'response_mode',
  'responseMode',
]);
const REQUEST_CORRELATION_FIELDS = new Set([
  'client_request_id',
  'clientRequestId',
  'client_session_id',
  'clientSessionId',
  'internal_session_id',
  'internalSessionId',
  'client_request_key',
  'clientRequestKey',
]);

export function getExternalChatTimeoutMs(payload = {}) {
  const parsed = Number(
    payload.timeout ??
    payload.timeoutMs ??
    process.env.SAMSAR_EXTERNAL_CHAT_TIMEOUT_MS
  );

  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_EXTERNAL_CHAT_TIMEOUT_MS;
}

function buildError(message, statusCode = 400, code = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) {
    error.code = code;
  }
  return error;
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw buildError('messages must be a non-empty OpenAI-compatible message array.');
  }
  return messages;
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function isExternalChatPollingRequested(payload = {}) {
  const responseMode = normalizeString(
    payload.response_mode ?? payload.responseMode,
  ).toLowerCase();
  return payload.async === true ||
    payload.async_mode === true ||
    payload.asyncMode === true ||
    payload.poll === true ||
    payload.polling === true ||
    responseMode === 'poll' ||
    responseMode === 'polling' ||
    responseMode === 'async';
}

export function stripExternalChatAsyncControlFields(payload = {}) {
  return Object.fromEntries(
    Object.entries(payload || {}).filter(([key]) => (
      !ASYNC_CONTROL_FIELDS.has(key) && !REQUEST_CORRELATION_FIELDS.has(key)
    )),
  );
}

export function normalizeExternalChatRequestCorrelation(payload = {}) {
  return {
    clientRequestId: normalizeString(
      payload.client_request_id ?? payload.clientRequestId,
    ) || null,
    clientSessionId: normalizeString(
      payload.client_session_id ??
      payload.clientSessionId ??
      payload.internal_session_id ??
      payload.internalSessionId,
    ) || null,
    clientRequestKey: normalizeString(
      payload.client_request_key ?? payload.clientRequestKey,
    ) || null,
  };
}

export function buildExternalChatRequestObjectId(userId, clientRequestId) {
  const digest = createHash('sha256')
    .update(`${userId?.toString?.() || userId}:${normalizeString(clientRequestId)}`)
    .digest('hex')
    .slice(0, 24);
  return new mongoose.Types.ObjectId(digest);
}

function getRequestedModel(payload = {}) {
  return normalizeInferenceModel(
    payload.model ||
    payload.provider_options?.model ||
    payload.providerOptions?.model ||
    payload.inference_model ||
    payload.inferenceModel ||
    DEFAULT_INFERENCE_MODEL
  );
}

export async function createExternalChatCompletion({ userId, payload = {} } = {}) {
  if (!userId) {
    throw buildError('User ID is required.', 401);
  }
  const completionPayload = stripExternalChatAsyncControlFields(payload);
  if (completionPayload.stream === true) {
    throw buildError('stream=true is not supported for this endpoint yet.', 400);
  }

  const messages = normalizeMessages(completionPayload.messages);
  const model = getRequestedModel(completionPayload);
  const timeout = getExternalChatTimeoutMs(completionPayload);
  const response = await createCompatibleChatCompletion(openai, {
    ...completionPayload,
    model,
    messages,
    timeout,
    bypassSamsarExternalInference: true,
  });

  const assistantMessage = response?.choices?.[0]?.message;
  const outputText = typeof assistantMessage?.content === 'string'
    ? assistantMessage.content
    : '';
  const billing = calculateAssistantCreditsFromUsage({
    model: response?.model || model,
    usage: response?.usage,
    pricingMultiplier: EXTERNAL_CHAT_PRICING_MULTIPLIER,
  });
  const creditsCharged = billing.credits || calculateLegacyAssistantCredits({
    inputMessages: messages,
    outputText,
  });

  const chargeResult = await deductGenerationCredits(userId, creditsCharged, {
    source: 'external_chat_completion',
    metadata: {
      requestType: 'API',
      category: 'external_chat',
      model: response?.model || model,
      pricingMultiplier: billing.pricingMultiplier ?? EXTERNAL_CHAT_PRICING_MULTIPLIER,
      costUsd: billing.costUsd ?? null,
      usage: billing.usage ?? null,
      creditsCharged,
    },
  });

  return {
    response,
    creditsCharged,
    remainingCredits: chargeResult?.remainingCredits ?? null,
  };
}

function getRequestErrorStatus(error) {
  const status = Number(
    error?.statusCode ?? error?.status ?? error?.response?.status,
  );
  return Number.isInteger(status) && status > 0 ? status : 500;
}

function buildExternalChatRequestPayload(request) {
  const requestId = request._id.toString();
  const payload = {
    request_id: requestId,
    requestId,
    status: request.status,
    poll_url: `${EXTERNAL_CHAT_POLL_PATH}?request_id=${encodeURIComponent(requestId)}`,
    created_at: request.createdAt,
    updated_at: request.updatedAt,
  };

  if (request.clientRequestId) {
    payload.client_request_id = request.clientRequestId;
    payload.clientRequestId = request.clientRequestId;
  }
  if (request.clientSessionId) {
    payload.client_session_id = request.clientSessionId;
    payload.clientSessionId = request.clientSessionId;
  }
  if (request.clientRequestKey) {
    payload.client_request_key = request.clientRequestKey;
    payload.clientRequestKey = request.clientRequestKey;
  }

  if (request.status === 'COMPLETED') {
    payload.response = request.response;
    payload.creditsCharged = request.creditsCharged;
    payload.remainingCredits = request.remainingCredits;
  } else if (request.status === 'FAILED') {
    payload.error = {
      message: request.errorMessage || 'External assistant request failed.',
      code: request.errorCode || null,
      status: request.errorStatus || 500,
    };
  }

  return payload;
}

export async function processExternalChatCompletionRequest(requestId) {
  await getDBConnectionString();
  const persisted = await ExternalAssistantRequest.findById(requestId)
    .select('payload')
    .lean();
  if (!persisted) return null;
  const now = new Date();
  const timeoutMs = getExternalChatTimeoutMs(persisted.payload || {});
  const staleStartedBefore = new Date(now.getTime() - timeoutMs - 30000);
  const request = await ExternalAssistantRequest.findOneAndUpdate(
    {
      _id: requestId,
      $or: [
        { status: 'PENDING' },
        { status: 'PROCESSING', workerLeaseExpiresAt: { $lte: now } },
        {
          status: 'PROCESSING',
          workerLeaseExpiresAt: null,
          startedAt: { $lte: staleStartedBefore },
        },
      ],
    },
    {
      $set: {
        status: 'PROCESSING',
        startedAt: now,
        workerLeaseExpiresAt: new Date(now.getTime() + timeoutMs + 30000),
      },
      $inc: { processingAttempts: 1 },
    },
    { new: true },
  ).lean();

  if (!request) {
    return null;
  }

  try {
    const result = await createExternalChatCompletion({
      userId: request.userId,
      payload: request.payload || {},
    });
    const completed = await ExternalAssistantRequest.findByIdAndUpdate(
      requestId,
      {
        $set: {
          status: 'COMPLETED',
          response: result.response,
          creditsCharged: result.creditsCharged,
          remainingCredits: result.remainingCredits,
          completedAt: new Date(),
          workerLeaseExpiresAt: null,
          payload: null,
          errorMessage: null,
          errorCode: null,
          errorStatus: null,
        },
      },
      { new: true },
    ).lean();
    return completed ? buildExternalChatRequestPayload(completed) : null;
  } catch (error) {
    const failed = await ExternalAssistantRequest.findByIdAndUpdate(
      requestId,
      {
        $set: {
          status: 'FAILED',
          errorMessage: error?.message || 'External assistant request failed.',
          errorCode: normalizeString(error?.code) || null,
          errorStatus: getRequestErrorStatus(error),
          completedAt: new Date(),
          workerLeaseExpiresAt: null,
          payload: null,
        },
      },
      { new: true },
    ).lean();
    return failed ? buildExternalChatRequestPayload(failed) : null;
  }
}

function queueExternalChatCompletionRequest(requestId) {
  setImmediate(() => {
    void processExternalChatCompletionRequest(requestId).catch((error) => {
      console.error('[external_chat] async request worker failed', {
        requestId,
        message: error?.message || String(error),
      });
    });
  });
}

export async function createExternalChatCompletionRequest({ userId, payload = {} } = {}) {
  if (!userId) {
    throw buildError('User ID is required.', 401);
  }
  if (payload.stream === true) {
    throw buildError('stream=true is not supported for polling requests.', 400);
  }

  const correlation = normalizeExternalChatRequestCorrelation(payload);
  const requestPayload = stripExternalChatAsyncControlFields(payload);
  normalizeMessages(requestPayload.messages);
  getRequestedModel(requestPayload);

  await getDBConnectionString();
  let request;
  if (correlation.clientRequestId) {
    const query = {
      _id: buildExternalChatRequestObjectId(userId, correlation.clientRequestId),
      userId,
      requestType: 'external_chat',
      clientRequestId: correlation.clientRequestId,
    };
    try {
      request = await ExternalAssistantRequest.findOneAndUpdate(
        query,
        {
          $setOnInsert: {
            ...query,
            clientSessionId: correlation.clientSessionId,
            clientRequestKey: correlation.clientRequestKey,
            status: 'PENDING',
            payload: requestPayload,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).lean();
    } catch (error) {
      if (error?.code !== 11000) throw error;
      request = await ExternalAssistantRequest.findOne(query).lean();
    }
  } else {
    const created = await ExternalAssistantRequest.create({
      userId,
      requestType: 'external_chat',
      status: 'PENDING',
      payload: requestPayload,
    });
    request = created.toObject();
  }

  if (!request) {
    throw buildError('Unable to persist external assistant request.', 500);
  }
  const requestId = request._id.toString();
  if (request.status === 'PENDING') {
    queueExternalChatCompletionRequest(requestId);
  }
  return buildExternalChatRequestPayload(request);
}

export async function getExternalChatCompletionRequest({
  userId,
  requestId,
  clientRequestId,
} = {}) {
  if (!userId) {
    throw buildError('User ID is required.', 401);
  }
  const normalizedRequestId = normalizeString(requestId);
  const normalizedClientRequestId = normalizeString(clientRequestId);
  if (!normalizedClientRequestId && !mongoose.Types.ObjectId.isValid(normalizedRequestId)) {
    throw buildError('A valid request_id or client_request_id is required.', 400);
  }

  await getDBConnectionString();
  const requestIdentity = normalizedClientRequestId
    ? { clientRequestId: normalizedClientRequestId }
    : { _id: normalizedRequestId };
  let request = await ExternalAssistantRequest.findOne({
    ...requestIdentity,
    userId,
    requestType: 'external_chat',
  }).lean();
  if (!request) {
    throw buildError('External assistant request not found.', 404);
  }

  if (request.status === 'PENDING') {
    // Polling also repairs a job that was persisted immediately before a
    // process restart and therefore never reached the in-process worker.
    queueExternalChatCompletionRequest(request._id.toString());
  } else if (request.status === 'PROCESSING' && request.startedAt) {
    const staleAfterMs = getExternalChatTimeoutMs(request.payload || {}) + 30000;
    const leaseExpired = request.workerLeaseExpiresAt &&
      new Date(request.workerLeaseExpiresAt).getTime() <= Date.now();
    const legacyRequestStale = !request.workerLeaseExpiresAt &&
      Date.now() - new Date(request.startedAt).getTime() > staleAfterMs;
    if (leaseExpired || legacyRequestStale) {
      // The payload and stable request id remain persisted, so a poll can
      // safely reacquire work abandoned by a restarted deployed processor.
      queueExternalChatCompletionRequest(request._id.toString());
    }
  }
  return buildExternalChatRequestPayload(request);
}
