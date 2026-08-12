import axios from 'axios';

import {
  getStudioSessionId,
  hasInitialStudioLayer,
  shouldAddInitialLayerToNewStudioSession,
} from './studioSessionPolicy.mjs';

function resolveInitialLayerDuration(session, payload) {
  const duration = Number(session?.defaultSceneDuration ?? payload?.durationPerScene);
  return Number.isFinite(duration) && duration > 0 ? duration : 2;
}

async function addInitialLayerToNewStudioSession({
  processorServer,
  headers,
  session,
  sessionId,
  payload,
  httpClient,
}) {
  const addLayerResponse = await httpClient.post(
    `${processorServer}/video_sessions/add_layer`,
    {
      sessionId,
      duration: resolveInitialLayerDuration(session, payload),
      position: 'end',
    },
    headers,
  );
  const sessionWithLayer = addLayerResponse?.data?.session;
  if (!hasInitialStudioLayer(sessionWithLayer)) {
    throw new Error('The new Studio session did not include its initial layer.');
  }
  return sessionWithLayer;
}

export async function ensureInitialLayerForNewStudioSession({
  processorServer,
  headers,
  session = null,
  sessionId: requestedSessionId,
  payload = { prompts: [] },
  httpClient = axios,
} = {}) {
  const sessionId = requestedSessionId || getStudioSessionId(session);
  if (!sessionId) {
    throw new Error('The Studio session response did not include an id.');
  }
  if (hasInitialStudioLayer(session)) {
    return session;
  }
  if (shouldAddInitialLayerToNewStudioSession(session)) {
    return addInitialLayerToNewStudioSession({
      processorServer,
      headers,
      session,
      sessionId,
      payload,
      httpClient,
    });
  }

  const persistedSession = await fetchStudioSessionDetails({
    processorServer,
    headers,
    sessionId,
    httpClient,
  });
  if (hasInitialStudioLayer(persistedSession)) {
    return persistedSession;
  }
  if (!shouldAddInitialLayerToNewStudioSession(persistedSession)) {
    throw new Error('The new Studio session details did not include a layers array.');
  }
  return addInitialLayerToNewStudioSession({
    processorServer,
    headers,
    session: persistedSession,
    sessionId,
    payload,
    httpClient,
  });
}

export async function createStudioSession({
  processorServer,
  headers,
  payload = { prompts: [] },
  httpClient = axios,
} = {}) {
  const { data } = await httpClient.post(
    `${processorServer}/video_sessions/create_video_session`,
    payload,
    headers,
  );
  // The processor normally creates this layer atomically with the Studio
  // session. This narrowly scoped fallback only repairs the response of the
  // Studio creation request above; it is never used for Vidgenie sessions.
  return ensureInitialLayerForNewStudioSession({
    processorServer,
    headers,
    session: data,
    payload,
    httpClient,
  });
}

export async function fetchStudioSessionDetails({
  processorServer,
  headers,
  sessionId,
  httpClient = axios,
} = {}) {
  if (!processorServer || !sessionId) return null;

  const { data } = await httpClient.get(
    `${processorServer}/video_sessions/session_details`,
    {
      ...(headers || {}),
      params: {
        id: sessionId,
        cacheBust: Date.now(),
      },
    },
  );
  return data || null;
}
