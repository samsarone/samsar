import ProviderUsageLog from '../schema/ProviderUsageLog.js';
import { getDBConnectionString } from './DBString.js';
import { getRequestAuthContext } from './api/RequestAuthContext.js';

function normalizeString(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function isTruthy(value) {
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalizeString(value).toLowerCase());
}

function isFalsey(value) {
  return ['0', 'false', 'no', 'n', 'off'].includes(normalizeString(value).toLowerCase());
}

export function isProviderUsageAuditEnabled() {
  if (isFalsey(process.env.SAMSAR_PROVIDER_USAGE_AUDIT_ENABLED)) {
    return false;
  }
  if (isTruthy(process.env.SAMSAR_PROVIDER_USAGE_AUDIT_ENABLED)) {
    return true;
  }
  return normalizeString(process.env.CURRENT_ENV).toLowerCase() === 'docker';
}

function normalizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => {
        if (value instanceof Date) {
          return [key, value.toISOString()];
        }
        if (value && typeof value === 'object') {
          return [key, JSON.parse(JSON.stringify(value))];
        }
        return [key, value];
      })
  );
}

export function resolveDockerJobType(payload = {}) {
  if (payload.jobType) {
    return normalizeString(payload.jobType);
  }
  if (payload.isExpressGeneration || payload.expressGeneration || payload.expressJob) {
    return 'Express video';
  }
  if (payload.isMovieGen || payload.isVidGPTGen) {
    return 'Image list to video';
  }
  return normalizeString(payload.requestType) || 'Generative request';
}

export async function recordProviderUsageLog(input = {}) {
  if (!isProviderUsageAuditEnabled()) {
    return null;
  }

  const payload = input.payload || {};
  const metadata = normalizeMetadata(input.metadata);
  const requestAuthContext = getRequestAuthContext();
  const teamOwnerUserId = normalizeString(
    input.teamOwnerUserId ??
    payload.teamOwnerUserId ??
    metadata.teamOwnerUserId ??
    requestAuthContext?.teamOwnerUserId
  );
  const teamMemberUserId = normalizeString(
    input.teamMemberUserId ??
    payload.teamMemberUserId ??
    metadata.teamMemberUserId ??
    requestAuthContext?.actorUserId
  );
  const teamMemberName = normalizeString(
    input.teamMemberName ??
    payload.teamMemberName ??
    metadata.teamMemberName ??
    requestAuthContext?.teamMemberUsername
  );
  const teamMemberEmail = normalizeString(
    input.teamMemberEmail ??
    payload.teamMemberEmail ??
    metadata.teamMemberEmail ??
    requestAuthContext?.teamMemberEmail
  );
  const userId = normalizeString(input.userId ?? payload.userId);
  if (!userId) {
    return null;
  }

  const provider = normalizeString(input.provider ?? payload.provider ?? payload.externalProvider);
  const requestType = normalizeString(input.requestType ?? input.callType ?? payload.requestType);
  const model = normalizeString(input.model ?? payload.model);
  const localRequestId = normalizeString(
    input.localRequestId ??
    input.requestId ??
    payload._id?.toString?.() ??
    payload._id ??
    payload.apiRequestId ??
    payload.generationId
  );
  const idempotencyKey = normalizeString(input.idempotencyKey) ||
    [
      normalizeString(input.service || process.env.SERVICE_NAME || 'samsar_processor'),
      localRequestId,
      requestType,
      provider,
      model,
    ].filter(Boolean).join(':');

  const doc = {
    userId,
    teamOwnerUserId,
    teamMemberUserId: teamOwnerUserId ? teamMemberUserId : '',
    teamMemberName: teamOwnerUserId ? teamMemberName : '',
    teamMemberEmail: teamOwnerUserId ? teamMemberEmail : '',
    sessionId: normalizeString(input.sessionId ?? input.videoSessionId ?? payload.sessionId ?? payload.videoSessionId),
    layerId: normalizeString(input.layerId ?? payload.layerId ?? payload.currentLayerId),
    audioLayerId: normalizeString(input.audioLayerId ?? payload.audioLayerId),
    localRequestId,
    providerRequestId: normalizeString(input.providerRequestId ?? payload.providerRequestId),
    idempotencyKey,
    requestType,
    callType: normalizeString(input.callType ?? requestType),
    jobType: resolveDockerJobType(input.jobType ? { jobType: input.jobType } : payload),
    provider,
    authorizationProvider: normalizeString(input.authorizationProvider ?? provider),
    model,
    status: normalizeString(input.status) || 'requested',
    source: normalizeString(input.source) || 'internal_generation',
    service: normalizeString(input.service || process.env.SERVICE_NAME || 'samsar_processor'),
    metadata: {
      ...metadata,
      ...(teamOwnerUserId
        ? {
          teamOwnerUserId,
          teamMemberUserId,
          teamMemberName,
          teamMemberEmail,
        }
        : {}),
    },
  };

  try {
    await getDBConnectionString();
    if (idempotencyKey) {
      const {
        providerRequestId,
        status,
        ...insertDoc
      } = doc;
      return await ProviderUsageLog.findOneAndUpdate(
        { idempotencyKey },
        {
          $setOnInsert: insertDoc,
          $set: {
            status,
            providerRequestId,
            updatedAt: new Date(),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }
    return await ProviderUsageLog.create(doc);
  } catch (error) {
    console.warn('[provider_usage_audit] failed to record provider usage', {
      requestType,
      provider,
      model,
      error: error?.message || error,
    });
    return null;
  }
}
