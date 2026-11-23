import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { getHeaders } from '../utils/web.jsx';
import {
  createSessionPostProcessingPreferenceController,
  getPostProcessingPreferenceSessionId,
  readSessionPostProcessingPreferences,
} from '../utils/sessionPostProcessingPreferences.mjs';

const API_SERVER = import.meta.env.VITE_PROCESSOR_API || '';

export function useSessionPostProcessingPreferences({ session, sessionId, apiServer = API_SERVER, onError } = {}) {
  const targetSessionId = String(sessionId ?? getPostProcessingPreferenceSessionId(session));
  const context = useRef({ session, targetSessionId, apiServer, onError });
  context.current = { session, targetSessionId, apiServer, onError };
  const controllerRef = useRef(null);
  if (!controllerRef.current) {
    controllerRef.current = createSessionPostProcessingPreferenceController({
      sessionId: targetSessionId, session,
      persist: async (writeSessionId, preferences) => {
        const headers = getHeaders();
        if (!headers) throw new Error('Please sign in to save post-processing preferences.');
        await axios.post(`${context.current.apiServer.replace(/\/$/, '')}/video_sessions/post_processing_preferences`, {
          sessionId: writeSessionId, preferences,
        }, { ...headers, timeout: 15000 });
      },
      onError: (failure, write) => {
        if (write.sessionId === context.current.targetSessionId) context.current.onError?.(failure);
      },
    });
  }
  const controller = controllerRef.current;
  const [snapshot, setSnapshot] = useState(() => controller.getSnapshot());

  useEffect(() => {
    controller.activate();
    const unsubscribe = controller.subscribe(setSnapshot);
    setSnapshot(controller.getSnapshot());
    return () => { unsubscribe(); controller.dispose(); };
  }, [controller]);

  useEffect(() => {
    controller.setSession(targetSessionId, session);
  }, [controller, targetSessionId, session]);

  const updatePreference = useCallback((field, value) => {
    const current = context.current;
    controller.setSession(current.targetSessionId, current.session);
    return controller.updatePreference(field, value);
  }, [controller]);

  const flushPreferences = useCallback(async () => {
    const current = context.current;
    const requestedSessionId = current.targetSessionId;
    controller.setSession(requestedSessionId, current.session);
    const result = await controller.flushPreferences();
    if (context.current.targetSessionId !== requestedSessionId) {
      throw Object.assign(new Error('The video session changed while saving post-processing preferences.'), {
        code: 'POST_PROCESSING_PREFERENCE_SESSION_CHANGED',
      });
    }
    return result;
  }, [controller]);

  const isMatchingSession = snapshot.sessionId === targetSessionId;
  return {
    preferences: isMatchingSession ? snapshot.preferences : readSessionPostProcessingPreferences(session, targetSessionId),
    error: isMatchingSession ? snapshot.error : null,
    updatePreference,
    flushPreferences,
  };
}
