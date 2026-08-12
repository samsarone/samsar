import axios from 'axios';

const VIDEO_SESSION_STORAGE_KEY = 'videoSessionId';

function normalizeSessionId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'object') {
    if (typeof value.$oid === 'string') {
      return value.$oid.trim() || null;
    }
    if (typeof value.toString === 'function') {
      const stringValue = value.toString();
      return stringValue && stringValue !== '[object Object]' ? stringValue : null;
    }
  }
  return null;
}

function storeVidgenieSessionId(sessionId) {
  if (typeof window === 'undefined') return;
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) return;

  try {
    window.localStorage.setItem(VIDEO_SESSION_STORAGE_KEY, normalizedSessionId);
  } catch {
    // Storage access can fail in private browsing modes; routing still works.
  }
}

export async function createBlankVidgenieSession(apiServer, headers, httpClient = axios) {
  if (!apiServer || !headers) return null;

  const { data } = await httpClient.post(`${apiServer}/vidgenie/create_blank`, {}, headers);
  const sessionId = normalizeSessionId(data?.sessionId || data?.session_id || data?._id || data?.id);
  if (sessionId) {
    storeVidgenieSessionId(sessionId);
  }
  return sessionId;
}
