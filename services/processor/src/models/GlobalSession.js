import GlobalSession from '../schema/GlobalSession.js';
import { getDBConnectionString } from './DBString.js';

export async function upsertGlobalSessionMapping({
  sessionId,
  sessionType,
  requestId,
  provider,
  userId,
  metadata,
  status,
  errorMessage,
  resultUrl,
  resultUrls,
  thumbnailUrl,
  inputUrl,
  inputUrls,
  requestType,
  sessionSubType,
  apiSessionId,
}) {
  if (!sessionId || !sessionType) {
    return null;
  }

  const update = {
    sessionType,
  };

  if (requestId !== undefined) {
    update.requestId = requestId;
  }
  if (provider) {
    update.provider = provider;
  }
  if (userId) {
    update.userId = userId;
  }
  if (metadata !== undefined) {
    update.metadata = metadata;
  }
  if (status) {
    update.status = status;
  }
  if (errorMessage !== undefined) {
    update.errorMessage = errorMessage;
  }
  if (resultUrl !== undefined) {
    update.resultUrl = resultUrl;
  }
  if (Array.isArray(resultUrls)) {
    update.resultUrls = resultUrls;
  }
  if (thumbnailUrl !== undefined) {
    update.thumbnailUrl = thumbnailUrl;
  }
  if (inputUrl !== undefined) {
    update.inputUrl = inputUrl;
  }
  if (Array.isArray(inputUrls)) {
    update.inputUrls = inputUrls;
  }
  if (requestType) {
    update.requestType = requestType;
  }
  if (sessionSubType) {
    update.sessionSubType = sessionSubType;
  }
  if (apiSessionId) {
    update.apiSessionId = apiSessionId;
  }

  return GlobalSession.findOneAndUpdate(
    { sessionId: sessionId.toString() },
    { $set: update },
    { upsert: true, new: true }
  );
}

export async function deleteGlobalSessionsForUser(userId) {
  await getDBConnectionString();
  await GlobalSession.deleteMany({ userId });
}
