import axios from 'axios';
import { getDefaultAuthenticatedPath } from './defaultRoutes.js';

const VIDEO_SESSION_STORAGE_KEY = 'videoSessionId';
const IS_DOCKER_INSTALL = import.meta.env.VITE_DOCKER_INSTALL === 'true';

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

function getVidgenieSessionId(session) {
  return normalizeSessionId(
    session?._id ||
      session?.id ||
      session?.sessionId ||
      session?.session_id ||
      session?.request_id
  );
}

function hasTextValue(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasStartedVidgenieGeneration(session) {
  if (!session) return false;

  return Boolean(
    session.isExpressGeneration ||
      session.isStepVideoGeneration ||
      session.expressGenerationCreated ||
      session.quickSessionCreatedAt ||
      hasTextValue(session.inputPrompt) ||
      hasTextValue(session.expressInputPrompt) ||
      (Array.isArray(session.textList) && session.textList.length > 0) ||
      (Array.isArray(session.layers) && session.layers.length > 0)
  );
}

function isPendingVidgenieSession(session) {
  if (!session || !getVidgenieSessionId(session)) return false;
  if (session.expressGenerationFailed || session.expressGenerationCancelled) return false;

  const hasCompletedVideo = Boolean(session.remoteURL || session.videoLink);
  if (hasCompletedVideo && !session.videoGenerationPending) {
    return false;
  }

  const hasPendingFlag =
    session.videoGenerationPending === true ||
    session.expressGenerationPending === true;

  return hasPendingFlag && hasStartedVidgenieGeneration(session);
}

export function appendRouteSearch(path, search = '') {
  if (!search) return path;
  return `${path}${search.startsWith('?') ? search : `?${search}`}`;
}

function getStoredVidgenieSessionId() {
  if (typeof window === 'undefined') return null;

  try {
    return normalizeSessionId(window.localStorage.getItem(VIDEO_SESSION_STORAGE_KEY));
  } catch {
    return null;
  }
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

async function fetchSessionDetails(apiServer, headers, sessionId) {
  if (!apiServer || !headers || !sessionId) return null;

  try {
    const { data } = await axios.get(
      `${apiServer}/video_sessions/session_details?id=${encodeURIComponent(sessionId)}`,
      headers
    );
    return data || null;
  } catch {
    return null;
  }
}

async function fetchLatestSession(apiServer, headers) {
  if (!apiServer || !headers) return null;

  try {
    const { data } = await axios.get(`${apiServer}/video_sessions/get_session`, headers);
    return data || null;
  } catch {
    return null;
  }
}

async function fetchPendingSessionCandidates(apiServer, headers) {
  if (!apiServer || !headers) return [];

  try {
    const { data } = await axios.get(
      `${apiServer}/video_sessions/list?page=1&limit=5&renderType=Pending`,
      headers
    );
    return Array.isArray(data?.data) ? data.data : [];
  } catch {
    return [];
  }
}

async function findPendingVidgenieSession(apiServer, headers) {
  const storedSessionId = getStoredVidgenieSessionId();
  const storedSessionPromise = fetchSessionDetails(apiServer, headers, storedSessionId);
  const latestSession = await fetchLatestSession(apiServer, headers);
  if (isPendingVidgenieSession(latestSession)) {
    return latestSession;
  }

  const storedSession = await storedSessionPromise;
  if (isPendingVidgenieSession(storedSession)) {
    return storedSession;
  }

  const pendingSessionCandidates = await fetchPendingSessionCandidates(apiServer, headers);
  const latestSessionId = getVidgenieSessionId(latestSession);
  const candidateSessionIds = pendingSessionCandidates
    .map(getVidgenieSessionId)
    .filter((candidateSessionId) => candidateSessionId && candidateSessionId !== latestSessionId);

  if (candidateSessionIds.length > 0) {
    const candidateDetailsList = await Promise.all(
      candidateSessionIds.map((candidateSessionId) => fetchSessionDetails(apiServer, headers, candidateSessionId))
    );
    const pendingCandidate = candidateDetailsList.find(isPendingVidgenieSession);
    if (pendingCandidate) {
      return pendingCandidate;
    }
  }

  return null;
}

async function createBlankVidgenieSession(apiServer, headers) {
  if (!apiServer || !headers) return null;

  const { data } = await axios.post(`${apiServer}/vidgenie/create_blank`, {}, headers);
  const sessionId = normalizeSessionId(data?.sessionId || data?.session_id || data?._id || data?.id);
  if (sessionId) {
    storeVidgenieSessionId(sessionId);
  }
  return sessionId;
}

export async function fetchGuestVidgenieSession(apiServer) {
  if (IS_DOCKER_INSTALL || !apiServer) return null;

  try {
    const { data } = await axios.get(`${apiServer}/video_sessions/fetch_guest_session`);
    return data || null;
  } catch {
    return null;
  }
}

export async function resolveGuestVidgenieEntryPath({
  apiServer,
  search = '',
  onGuestSessionResolved,
} = {}) {
  const guestSession = await fetchGuestVidgenieSession(apiServer);
  const guestSessionId = guestSession?.isGuestSession === true
    ? getVidgenieSessionId(guestSession)
    : null;
  if (guestSessionId && typeof onGuestSessionResolved === 'function') {
    onGuestSessionResolved(guestSession);
  }
  return guestSessionId
    ? appendRouteSearch(`/vidgenie/${guestSessionId}`, search)
    : null;
}

export async function resolveVidgenieEntryPath({
  apiServer,
  headers,
  search = '',
  createIfMissing = true,
  onGuestSessionResolved,
} = {}) {
  if (!headers) {
    return resolveGuestVidgenieEntryPath({
      apiServer,
      search,
      onGuestSessionResolved,
    });
  }

  const pendingSession = await findPendingVidgenieSession(apiServer, headers);
  const pendingSessionId = getVidgenieSessionId(pendingSession);
  if (pendingSessionId) {
    storeVidgenieSessionId(pendingSessionId);
    return appendRouteSearch(`/vidgenie/${pendingSessionId}`, search);
  }

  if (!createIfMissing) {
    return appendRouteSearch('/vidgenie', search);
  }

  const sessionId = await createBlankVidgenieSession(apiServer, headers);
  return sessionId ? appendRouteSearch(`/vidgenie/${sessionId}`, search) : null;
}

export async function resolveAuthenticatedEntryPath({
  user,
  isMobile = false,
  apiServer,
  headers,
  search = '',
  createIfMissing = true,
} = {}) {
  const defaultPath = getDefaultAuthenticatedPath(user, { isMobile });
  if (defaultPath !== '/vidgenie') {
    return appendRouteSearch(defaultPath, search);
  }

  return resolveVidgenieEntryPath({
    apiServer,
    headers,
    search,
    createIfMissing,
  });
}
