import ExternalAssistantClientRequest from '../../schema/ExternalAssistantClientRequest.js';
import { getDBConnectionString } from '../DBString.js';

function normalizeString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeErrorStatus(error) {
  const status = Number(
    error?.status ?? error?.statusCode ?? error?.response?.status,
  );
  return Number.isInteger(status) && status > 0 ? status : null;
}

export function normalizeExternalAssistantRequestContext(context = {}) {
  const sessionId = normalizeString(
    context.sessionId ?? context.session_id ?? context.internalSessionId,
  );
  const requestKey = normalizeString(
    context.requestKey ?? context.request_key ?? context.stage,
  );
  if (!sessionId || !requestKey) return null;

  const provider = normalizeString(context.provider) || 'samsar';
  const clientRequestId = normalizeString(
    context.clientRequestId ?? context.client_request_id,
  ) || `${provider}:${sessionId}:${requestKey}`;

  return {
    clientRequestId,
    sessionId,
    userId: normalizeString(context.userId ?? context.user_id) || null,
    requestKey,
    provider,
  };
}

export async function prepareExternalAssistantClientRequest(context, { model } = {}) {
  const normalized = normalizeExternalAssistantRequestContext(context);
  if (!normalized) return null;

  await getDBConnectionString();
  return ExternalAssistantClientRequest.findOneAndUpdate(
    {
      sessionId: normalized.sessionId,
      requestKey: normalized.requestKey,
      provider: normalized.provider,
    },
    {
      $setOnInsert: {
        ...normalized,
        model: normalizeString(model) || null,
        status: 'PENDING',
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
}

async function updateClientRequest(clientRequestId, update) {
  if (!clientRequestId) return null;
  await getDBConnectionString();
  return ExternalAssistantClientRequest.findOneAndUpdate(
    { clientRequestId },
    update,
    { new: true },
  ).lean();
}

export async function markExternalAssistantClientRequestSubmitted(
  clientRequestId,
  providerRequestId,
) {
  const now = new Date();
  return updateClientRequest(clientRequestId, {
    $set: {
      providerRequestId: normalizeString(providerRequestId) || null,
      status: 'SUBMITTED',
      submittedAt: now,
      lastPolledAt: now,
      errorMessage: null,
      errorCode: null,
      errorStatus: null,
    },
  });
}

export async function markExternalAssistantClientRequestPolling(clientRequestId) {
  return updateClientRequest(clientRequestId, {
    $set: {
      status: 'POLLING',
      lastPolledAt: new Date(),
    },
  });
}

export async function markExternalAssistantClientRequestCompleted(
  clientRequestId,
  response,
) {
  const now = new Date();
  return updateClientRequest(clientRequestId, {
    $set: {
      status: 'COMPLETED',
      response: response ?? null,
      lastPolledAt: now,
      completedAt: now,
      errorMessage: null,
      errorCode: null,
      errorStatus: null,
    },
  });
}

export async function markExternalAssistantClientRequestFailed(
  clientRequestId,
  error,
) {
  const now = new Date();
  return updateClientRequest(clientRequestId, {
    $set: {
      status: 'FAILED',
      errorMessage: error?.message || 'External assistant request failed.',
      errorCode: normalizeString(error?.code) || null,
      errorStatus: normalizeErrorStatus(error),
      lastPolledAt: now,
      completedAt: now,
    },
  });
}

export const externalAssistantClientRequestStore = Object.freeze({
  prepare: prepareExternalAssistantClientRequest,
  markSubmitted: markExternalAssistantClientRequestSubmitted,
  markPolling: markExternalAssistantClientRequestPolling,
  markCompleted: markExternalAssistantClientRequestCompleted,
  markFailed: markExternalAssistantClientRequestFailed,
});
