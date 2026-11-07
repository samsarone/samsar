import { readAssistantSSE, assistantMessagesFromSnapshot } from '../utils/assistantSSE.js';
import { useEffect, useRef } from 'react';

// Discard replies already in flight when a conversation is cleared or changed.
export function useAssistantRequestGuard(sessionId) {
  const state = useRef({ sessionId, version: 0, serverVersion: 0, completedQueryId: null, latestStream: null, streamController: null, timers: new Set() });
  const guard = useRef(null);
  if (!guard.current) {
    guard.current = {
      messages: assistantMessagesFromSnapshot,
      stopOnAccessError: (error) => {
        if (![400, 401, 403, 404].includes(error?.response?.status)) return false;
        guard.current.invalidate();
        return true;
      },
      applyStatus: (response, setMessages) => {
        const snapshot = response.sessionDetails || response;
        if (!snapshot.sessionMessages && !snapshot.assistantStream) return false;
        if (!guard.current.acceptSession(snapshot)) return false;
        setMessages(previous => assistantMessagesFromSnapshot({ ...snapshot,
          sessionMessages: snapshot.sessionMessages || previous }));
        return response.status === 'COMPLETED';
      },
      beginRequest: () => { guard.current.invalidate(); return guard.current.capture(); },
      capture: () => ({ sessionId: state.current.sessionId, version: state.current.version, serverVersion: state.current.serverVersion }),
      isCurrent: (token) => token.sessionId === state.current.sessionId && token.version === state.current.version,
      acceptSession: (session) => {
        const version = session?.assistantSessionVersion || 0;
        if (version < state.current.serverVersion) return false;
        const stream = session?.assistantStream;
        if (version === state.current.serverVersion && stream?.queryId &&
            stream.queryId === state.current.completedQueryId && stream.status !== 'completed') return false;
        if (version > state.current.serverVersion) {
          state.current.completedQueryId = null;
          state.current.latestStream = null;
        }
        const latest = state.current.latestStream;
        if (stream?.queryId === latest?.queryId && Number.isFinite(stream?.sequence) &&
            stream.sequence < latest.sequence && stream.status !== 'completed') return false;
        if (stream?.queryId && Number.isFinite(stream.sequence)) {
          state.current.latestStream = { queryId: stream.queryId, sequence: stream.sequence };
        }
        if (stream?.status === 'completed') state.current.completedQueryId = stream.queryId;
        state.current.serverVersion = version;
        return true;
      },
      invalidate: (session) => {
        state.current.version += 1;
        state.current.streamController?.abort();
        if (session) {
          state.current.serverVersion = session.assistantSessionVersion || 0;
          state.current.completedQueryId = null;
          state.current.latestStream = null;
        }
        state.current.timers.forEach(clearInterval);
        state.current.timers.clear();
      },
      subscribe: ({ url, headers, onSnapshot }) => {
        state.current.streamController?.abort();
        const controller = new AbortController();
        state.current.streamController = controller;
        const token = guard.current.capture();
        const active = () => !controller.signal.aborted && guard.current.isCurrent(token);
        (async () => {
          for (let attempt = 0; attempt < 4 && active(); attempt++) {
            let settled = false, rotate = false;
            try {
              const response = await fetch(url, { headers: { ...headers, Accept: 'text/event-stream' }, signal: controller.signal });
              await readAssistantSSE(response, (event, snapshot) => {
                if (!active()) return;
                if (event === 'settled') settled = true;
                if (event === 'reconnect') rotate = true;
                if (event === 'error' && [401, 403, 404].includes(snapshot.status)) controller.abort();
                if (event === 'snapshot' && guard.current.acceptSession(snapshot)) {
                  onSnapshot({ ...snapshot, sessionMessages: assistantMessagesFromSnapshot(snapshot) });
                }
              }, controller.signal);
              if (settled) break;
              if (rotate) attempt = -1; // Only explicit server rotation resets the retry budget.
            } catch (error) {
              if ([400, 401, 403, 404, 405].includes(error.status)) break;
            }
            if (active()) await new Promise(resolve => {
              const done = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', done); resolve(); };
              const timer = setTimeout(done, Math.min(4000, 500 * (2 ** Math.max(0, attempt))));
              controller.signal.addEventListener('abort', done, { once: true });
            });
          }
        })().catch(() => {}); // Existing REST polling remains the compatibility fallback.
      },
      setInterval: (callback, delay) => {
        const token = guard.current.capture();
        const timer = setInterval(() => {
          if (guard.current.isCurrent(token)) callback();
          else clearInterval(timer);
        }, delay);
        state.current.timers.add(timer);
        return timer;
      },
    };
  }
  if (state.current.sessionId !== sessionId) {
    guard.current.invalidate();
    state.current.sessionId = sessionId;
    state.current.serverVersion = 0;
    state.current.completedQueryId = null;
    state.current.latestStream = null;
  }
  useEffect(() => () => guard.current.invalidate(), []);
  return guard.current;
}
