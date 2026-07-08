import AudioGeneration from '../schema/AudioGeneration.js';
import GlobalSession from '../schema/GlobalSession.js';
import { getDBConnectionString } from '../DBString.js';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toPlainPayload(payload = {}) {
  if (payload && typeof payload.toObject === 'function') {
    return payload.toObject();
  }
  if (payload?._doc) {
    return payload._doc;
  }
  return payload || {};
}

export function isStandaloneExternalAudioRequest(payload = {}) {
  const plainPayload = toPlainPayload(payload);
  const generationMeta = plainPayload.generationMeta || {};
  return plainPayload.externalAudioApiRequest === true ||
    plainPayload.requestType === 'API' && generationMeta.externalAudioApiRequest === true ||
    generationMeta.externalAudioApiRequest === true;
}

function getStandaloneRequestIds(payload = {}) {
  const plainPayload = toPlainPayload(payload);
  const generationMeta = plainPayload.generationMeta || {};
  return Array.from(new Set([
    normalizeString(plainPayload.apiSessionId),
    normalizeString(generationMeta.globalSessionId),
    normalizeString(generationMeta.audioGenerationId),
    normalizeString(plainPayload.sessionId),
    normalizeString(plainPayload._id?.toString?.() || plainPayload._id),
  ].filter(Boolean)));
}

function buildStandaloneGlobalSessionQuery(payload = {}) {
  const ids = getStandaloneRequestIds(payload);
  if (!ids.length) {
    return null;
  }

  return {
    sessionType: 'audio',
    $or: ids.flatMap((id) => [
      { sessionId: id },
      { requestId: id },
      { apiSessionId: id },
      { 'metadata.audioGenerationId': id },
    ]),
  };
}

function normalizeResultUrls(resultUrl, resultUrls) {
  const urls = Array.isArray(resultUrls) ? resultUrls.filter(Boolean) : [];
  if (resultUrl && !urls.includes(resultUrl)) {
    urls.unshift(resultUrl);
  }
  return urls;
}

function compactObject(value = {}) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
  );
}

export async function markStandaloneExternalAudioPending(payload = {}, providerRequestId = null) {
  if (!isStandaloneExternalAudioRequest(payload)) {
    return false;
  }

  const query = buildStandaloneGlobalSessionQuery(payload);
  if (!query) {
    return false;
  }

  await getDBConnectionString();
  await GlobalSession.findOneAndUpdate(
    query,
    {
      $set: compactObject({
        status: 'PENDING',
        errorMessage: null,
        'metadata.providerRequestId': providerRequestId || undefined,
        'metadata.audioGenerationStatus': 'PENDING',
        'metadata.updatedAt': new Date().toISOString(),
      }),
    },
    { new: true }
  );
  return true;
}

export async function finalizeStandaloneExternalAudioGeneration({
  payload = {},
  resultUrl,
  resultUrls,
  duration,
  localAudioPath,
  remoteAudioData,
  title,
} = {}) {
  if (!isStandaloneExternalAudioRequest(payload)) {
    return false;
  }

  const query = buildStandaloneGlobalSessionQuery(payload);
  const normalizedResultUrl = normalizeString(resultUrl);
  const normalizedResultUrls = normalizeResultUrls(normalizedResultUrl, resultUrls);
  if (!query || !normalizedResultUrl) {
    return false;
  }

  const plainPayload = toPlainPayload(payload);
  const requestId = normalizeString(plainPayload._id?.toString?.() || plainPayload._id);
  const now = new Date().toISOString();
  const metadataSet = {
    'metadata.audioGenerationId': requestId || undefined,
    'metadata.audioGenerationStatus': 'COMPLETED',
    'metadata.completedAt': now,
    'metadata.providerRequestId': normalizeString(plainPayload.apiRequestId || plainPayload.generationId) || undefined,
    'metadata.duration': Number.isFinite(Number(duration)) ? Number(duration) : undefined,
    'metadata.localAudioPath': normalizeString(localAudioPath) || undefined,
    'metadata.remoteAudioData': Array.isArray(remoteAudioData) ? remoteAudioData : undefined,
    'metadata.title': normalizeString(title) || undefined,
  };

  const updateSet = compactObject({
    status: 'COMPLETED',
    errorMessage: null,
    resultUrl: normalizedResultUrl,
    resultUrls: normalizedResultUrls,
    ...metadataSet,
  });

  await getDBConnectionString();
  await GlobalSession.findOneAndUpdate(
    query,
    { $set: updateSet },
    { new: true }
  );

  if (requestId) {
    await AudioGeneration.deleteOne({ _id: requestId });
  }
  return true;
}

export async function failStandaloneExternalAudioGeneration(
  payload = {},
  errorMessage = 'Audio generation failed.',
  { deleteAudioGeneration = false } = {}
) {
  if (!isStandaloneExternalAudioRequest(payload)) {
    return false;
  }

  const query = buildStandaloneGlobalSessionQuery(payload);
  if (!query) {
    return false;
  }

  const plainPayload = toPlainPayload(payload);
  const requestId = normalizeString(plainPayload._id?.toString?.() || plainPayload._id);
  const failureMessage = normalizeString(errorMessage) || 'Audio generation failed.';

  await getDBConnectionString();
  await GlobalSession.findOneAndUpdate(
    query,
    {
      $set: compactObject({
        status: 'FAILED',
        errorMessage: failureMessage,
        'metadata.audioGenerationId': requestId || undefined,
        'metadata.audioGenerationStatus': 'FAILED',
        'metadata.failedAt': new Date().toISOString(),
        'metadata.providerRequestId': normalizeString(plainPayload.apiRequestId || plainPayload.generationId) || undefined,
      }),
    },
    { new: true }
  );

  if (deleteAudioGeneration && requestId) {
    await AudioGeneration.deleteOne({ _id: requestId });
  }
  return true;
}
