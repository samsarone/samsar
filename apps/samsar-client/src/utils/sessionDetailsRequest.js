import axios from 'axios';
import { deduplicatedGet } from './deduplicatedGet.mjs';

export const sessionAuthorization = (config) => config?.headers?.Authorization || config?.headers?.authorization || '';
export function requestSessionDetails(apiServer, sessionId, headers, client = axios) {
  return deduplicatedGet(client,
    `${apiServer}/video_sessions/session_details?id=${encodeURIComponent(sessionId)}&cacheBust=${Date.now()}`, headers);
}

// A route owns this one-shot handoff. No resolved private response is retained
// globally or reused for polling, retries, another session, or another account.
export async function consumeInitialSessionDetails(apiServer, sessionId, headers, preloadRef) {
  const initial = preloadRef?.current;
  if (initial?.sessionId === sessionId && initial.authorization === sessionAuthorization(headers)) {
    try { return await initial.promise; }
    finally { if (preloadRef.current === initial) preloadRef.current = null; }
  }
  return requestSessionDetails(apiServer, sessionId, headers);
}
