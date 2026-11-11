import { readAssistantSSE, assistantMessagesFromSnapshot, isTerminalAssistantDeliveryError,
  assistantDeliveryErrorMessage } from '../utils/assistantSSE.js';
import { useEffect, useRef, useState } from 'react';
import axios from 'axios';

// Bound the whole operation, including headers/body, and release its socket.
// Axios' timeout alone cannot protect every adapter/connection failure mode.
async function withTimeout(operation, signal, timeoutMs) {
  const controller = new AbortController();
  let timer, abort;
  const interrupted = new Promise((_, reject) => {
    abort = () => {
      controller.abort();
      reject(Object.assign(new Error('Assistant connection interrupted.'), { code: 'ERR_CANCELED' }));
    };
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(Object.assign(new Error('Assistant connection timed out.'), { code: 'ETIMEDOUT' }));
    }, timeoutMs);
  });
  try {
    if (signal?.aborted) { abort(); return await interrupted; }
    return await Promise.race([operation(controller.signal), interrupted]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    controller.abort();
  }
}

const retryable = error => !error?.response?.status || error.response.status >= 500 || [408, 429].includes(error.response.status);

// Discard replies already in flight when a conversation is cleared or changed.
export function useAssistantRequestGuard(sessionId) {
  const [error, setError] = useState(null);
  const state = useRef({ sessionId, version: 0, serverVersion: 0, completedQueryId: null, latestStream: null, streamController: null, timers: new Set() });
  const guard = useRef(null);
  if (!guard.current) {
    guard.current = {
      messages: assistantMessagesFromSnapshot,
      retry: () => { setError(null); state.current.retry?.(); },
      reportError: (failure, retry) => {
        state.current.retry = retry;
        setError({ message: assistantDeliveryErrorMessage(failure),
          retryable: Boolean(retry), sessionId: state.current.sessionId, version: state.current.version });
      },
      stopOnAccessError: (error) => {
        if (!isTerminalAssistantDeliveryError(error)) return false;
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
      beginRequest: () => { guard.current.invalidate(); state.current.expectedQueryId = null; setError(null); return guard.current.capture(); },
      capture: () => ({ sessionId: state.current.sessionId, version: state.current.version, serverVersion: state.current.serverVersion }),
      isCurrent: (token) => token.sessionId === state.current.sessionId && token.version === state.current.version,
      acceptSession: (session) => {
        const snapshotId = session?.sessionId || session?._id;
        if (snapshotId && String(snapshotId) !== String(state.current.sessionId)) return false;
        const version = session?.assistantSessionVersion || 0;
        if (version < state.current.serverVersion) return false;
        const stream = session?.assistantStream;
        const expected = state.current.expectedQueryId;
        if (version === state.current.serverVersion && expected && stream?.queryId && stream.queryId !== expected) return false;
        if (version === state.current.serverVersion && stream?.queryId &&
            stream.queryId === state.current.completedQueryId && stream.status !== 'completed') return false;
        if (version > state.current.serverVersion) {
          state.current.expectedQueryId = null;
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
        if (Array.isArray(session?.sessionMessages)) state.current.sessionMessages = session.sessionMessages;
        state.current.serverVersion = version;
        return true;
      },
      invalidate: (session) => {
        state.current.version += 1;
        state.current.stopDelivery?.();
        state.current.submitController?.abort();
        state.current.retry = null;
        state.current.streamController?.abort();
        if (session) {
          state.current.expectedQueryId = null;
          state.current.serverVersion = session.assistantSessionVersion || 0;
          state.current.completedQueryId = null;
          state.current.latestStream = null;
          state.current.sessionMessages = session.sessionMessages || [];
        }
        state.current.timers.forEach(clearInterval);
        state.current.timers.clear();
      },
      subscribe: ({ url, headers, onSnapshot, onActivity, onError }) => {
        state.current.streamController?.abort();
        const controller = new AbortController();
        state.current.streamController = controller;
        const token = guard.current.capture();
        const active = () => !controller.signal.aborted && guard.current.isCurrent(token);
        (async () => {
          for (let attempt = 0; attempt < 4 && active(); attempt++) {
            let settled = false, rotate = false;
            try {
              await withTimeout(async signal => {
                const response = await fetch(url, { headers: { ...headers, Accept: 'text/event-stream' }, signal, cache: 'no-store' });
                await readAssistantSSE(response, (event, snapshot) => {
                  if (!active()) return;
                  if (event === 'settled') settled = true;
                  if (event === 'reconnect') rotate = true;
                  if (event === 'error') {
                    const failure = { status: snapshot.status, response: { status: snapshot.status, data: snapshot } };
                    if (isTerminalAssistantDeliveryError(failure)) {
                      controller.abort();
                      onError?.(failure);
                    }
                  }
                  if (event === 'snapshot' && guard.current.acceptSession(snapshot)) {
                    onSnapshot({ ...snapshot, sessionMessages: assistantMessagesFromSnapshot(snapshot) });
                  }
                }, signal, () => { if (active()) onActivity?.(); });
              }, controller.signal, 45000);
              if (settled) break;
              if (rotate) attempt = -1; // Only explicit server rotation resets the retry budget.
            } catch (error) {
              if (isTerminalAssistantDeliveryError(error)) {
                // Older servers may omit the SSE endpoint while REST remains usable.
                const data = error.response?.data;
                const hasApplicationError = [data?.error, data?.error?.message, data?.message, data?.detail, data?.code]
                  .some(value => typeof value === 'string' && value.trim());
                if (error.status !== 404 || hasApplicationError) onError?.(error);
                break;
              }
              if (error.status === 405) break;
            }
            if (active()) await new Promise(resolve => {
              const done = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', done); resolve(); };
              const timer = setTimeout(done, Math.min(4000, 500 * (2 ** Math.max(0, attempt))));
              controller.signal.addEventListener('abort', done, { once: true });
            });
          }
        })().catch(() => {}); // Existing REST polling remains the compatibility fallback.
        return controller;
      },
      // Replays only the same idempotent submission when acknowledgement is
      // lost. A delivery reconnect below never submits or bills another query.
      submit: async (options) => {
        const { url, payload, headers, onResponse, onError } = options;
        const token = guard.current.capture();
        state.current.submitController?.abort();
        const controller = new AbortController();
        state.current.submitController = controller;
        const active = () => !controller.signal.aborted && guard.current.isCurrent(token);
        setError(null);
        options.onStart?.();
        for (let attempt = 0; active(); attempt++) {
          try {
            const response = await withTimeout(signal => axios.post(url, payload, { headers, signal, timeout: 15000 }), controller.signal, 15000);
            if (active()) {
              state.current.retry = null;
              state.current.expectedQueryId = response.data?.queryId || null;
              setError(null);
              onResponse(response);
              if (active() && response.data?.status === 'COMPLETED' && response.data?.sessionDetails?.sessionMessageGenerationError) {
                guard.current.reportError(new Error(response.data.sessionDetails.sessionMessageGenerationError), null);
              }
            }
            return;
          } catch (failure) {
            if (!active()) return;
            const canRetry = Boolean(payload.client_request_id) && retryable(failure);
            if (canRetry && attempt === 0) continue;
            guard.current.reportError(failure, canRetry ? () => guard.current.submit(options) : null);
            onError?.(failure);
            return;
          }
        }
      },
      watch: (options) => {
        const { url, statusUrl, headers, onSnapshot, onError } = options;
        state.current.stopDelivery?.();
        setError(null);
        state.current.retry = null;
        options.onStart?.();
        const token = guard.current.capture();
        const controller = new AbortController();
        let stopped = false, timer, deadlineTimer, stream, inFlight = false;
        let lastContact = Date.now(), lastProgress = Date.now(), previousProgress = '';
        const active = () => !stopped && guard.current.isCurrent(token);
        const stop = () => {
          stopped = true;
          clearTimeout(timer); clearInterval(deadlineTimer);
          controller.abort(); stream?.abort();
          window.removeEventListener('online', wake);
          document.removeEventListener('visibilitychange', wake);
          if (state.current.stopDelivery === stop) state.current.stopDelivery = null;
        };
        const fail = (failure, canRetry = true) => {
          if (!active()) return;
          stop();
          guard.current.reportError(failure, canRetry ? () => guard.current.watch(options) : null);
          onError?.(failure);
        };
        const apply = snapshot => {
          if (!active() || !snapshot || !guard.current.acceptSession(snapshot)) return;
          lastContact = Date.now();
          const progress = JSON.stringify([snapshot.assistantStream, snapshot.sessionMessages, snapshot.sessionMessageGenerationPending]);
          if (progress !== previousProgress) { previousProgress = progress; lastProgress = Date.now(); }
          onSnapshot({ ...snapshot, sessionMessages: assistantMessagesFromSnapshot({ ...snapshot,
            sessionMessages: snapshot.sessionMessages || state.current.sessionMessages || [] }) });
          if (snapshot.sessionMessageGenerationPending === false) {
            stop();
            if (snapshot.sessionMessageGenerationError) guard.current.reportError(new Error(snapshot.sessionMessageGenerationError), null);
          }
        };
        const poll = async () => {
          if (!active() || inFlight) return;
          clearTimeout(timer);
          inFlight = true;
          try {
            const response = await withTimeout(signal => axios.get(statusUrl, { headers, signal, timeout: 10000,
              validateStatus: status => status >= 200 && status < 300 || status === 304 }), controller.signal, 10000);
            if (response.status === 304) {
              lastContact = Date.now();
              return; // Conditional reads retain the existing snapshot and progress deadline.
            }
            const data = response.data;
            // Keep older REST contracts usable when SSE is unavailable.
            const snapshot = data.sessionDetails || data;
            apply({ ...snapshot, sessionMessageGenerationPending: snapshot.sessionMessageGenerationPending ?? (data.status !== 'COMPLETED') });
          } catch (failure) {
            if (isTerminalAssistantDeliveryError(failure)) fail(failure, false);
          } finally {
            inFlight = false;
            if (active()) timer = setTimeout(poll, 1000);
          }
        };
        const connect = () => { stream = guard.current.subscribe({ url, headers, onSnapshot: apply,
          onActivity: () => { if (active()) lastContact = Date.now(); },
          onError: failure => fail(failure, false) }); };
        const wake = () => { if (active() && !document.hidden) { connect(); void poll(); } };
        state.current.stopDelivery = stop;
        // Healthy reasoning may take minutes without visible text. A dead
        // connection gets a shorter recovery deadline than a healthy job.
        deadlineTimer = setInterval(() => {
          if (Date.now() - lastContact >= 60000 || Date.now() - lastProgress >= 12 * 60 * 1000) {
            fail(new Error('Unable to load. Please try again.'));
          }
        }, 1000);
        window.addEventListener('online', wake);
        document.addEventListener('visibilitychange', wake);
        connect();
        void poll();
        return stop;
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
    state.current.expectedQueryId = null;
    state.current.sessionMessages = [];
  }
  useEffect(() => () => guard.current.invalidate(), []);
  guard.current.error = error?.sessionId === sessionId && error?.version === state.current.version ? error : null;
  return guard.current;
}
