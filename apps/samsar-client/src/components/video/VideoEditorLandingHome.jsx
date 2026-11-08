import { boundedGet } from '../../utils/deduplicatedGet.mjs';
import { useUiLanguage } from '../../hooks/useUiLanguage.js';
import { translateText as uiText } from '../../utils/localization.js';
import { useEffect, useRef, useState } from 'react';
import { useUser } from '../../contexts/UserContext';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { getHeaders, getAuthToken } from '../../utils/web';
import './home.css';
import StudioSkeletonLoader from './util/StudioSkeletonLoader.jsx';
import { IS_STANDALONE_DEPLOYMENT } from '../../utils/environment.jsx';
import {
  createStudioSession,
  fetchStudioSessionDetails,
} from '../../utils/studioSessionApi.js';
import {
  getStudioSessionId,
} from '../../utils/studioSessionPolicy.mjs';

const API_SERVER = import.meta.env.VITE_PROCESSOR_API;
const preloadVideoEditor = () => import('./VideoHome.jsx');

export default function VideoEditorLandingHome() {
  useUiLanguage();

  const { user, userFetching, userInitiated } = useUser();
  const navigate = useNavigate();
  const redirectOperationRef = useRef(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [routeError, setRouteError] = useState('');

  useEffect(() => {
    if (!userInitiated || userFetching) return undefined;
    let cancelled = false;
    setRouteError('');
    void preloadVideoEditor().catch(() => undefined);
    const userToken = getAuthToken();
    const key = JSON.stringify([userToken, user?._id, retryAttempt]);
    let operation = redirectOperationRef.current;
    if (operation?.key !== key) {
      operation = { key, active: true, promise: null };
      redirectOperationRef.current = operation;
    }
    operation.active = true;
    const canContinue = () => {
      if (operation.active) return true;
      if (redirectOperationRef.current === operation) redirectOperationRef.current = null;
      return false;
    };
    if (!operation.promise) {
      const resolveRoute = async () => {
        const isGuest = !userToken || !user?._id;
        if (isGuest) {
          if (IS_STANDALONE_DEPLOYMENT) return '/login';
          const { data } = await boundedGet(axios, `${API_SERVER}/video_sessions/fetch_guest_session`);
          const sessionId = getStudioSessionId(data);
          if (!sessionId) throw new Error(uiText("Unable to open this session."));
          return `/video/${sessionId}`;
        }
        const headers = getHeaders();
        const storedId = localStorage.getItem('videoSessionId');
        if (storedId) {
          try {
            const data = await fetchStudioSessionDetails({ processorServer: API_SERVER, headers, sessionId: storedId });
            if (getStudioSessionId(data)) return `/video/${storedId}`;
            throw new Error(uiText("Unable to open this session."));
          } catch (error) {
            // A network/server failure must not discard the selected project or
            // create a replacement. Only an explicitly missing project can do so.
            if (![400, 404].includes(error?.response?.status)) throw error;
            if (!canContinue()) return null;
            if (localStorage.getItem('videoSessionId') === storedId) localStorage.removeItem('videoSessionId');
          }
        } else {
          const { data } = await boundedGet(axios, `${API_SERVER}/video_sessions/get_session`, headers);
          const sessionId = getStudioSessionId(data);
          if (sessionId) return `/video/${sessionId}`;
          if (!IS_STANDALONE_DEPLOYMENT) return '/my_sessions';
        }
        if (!canContinue()) return null;
        const session = await createStudioSession({ processorServer: API_SERVER, headers, payload: { prompts: [] } });
        return `/video/${getStudioSessionId(session)}`;
      };
      // Reattach after Strict Mode replay/profile refresh without creating a
      // second session. An unmounted landing page may never redirect a new route.
      operation.promise = resolveRoute();
    }
    void operation.promise.then(path => {
      if (cancelled || !path) return;
      const sessionId = path.startsWith('/video/') ? path.slice('/video/'.length) : null;
      if (sessionId) {
        try { localStorage.setItem('videoSessionId', sessionId); } catch { /* optional preference */ }
      }
      navigate(path, { replace: true });
    }).catch(() => {
      if (!cancelled) setRouteError(uiText("Unable to open Studio. Check the server connection and try again."));
    });
    return () => { cancelled = true; operation.active = false; };
  }, [userInitiated, userFetching, user?._id, navigate, retryAttempt]);

  if (routeError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0c0d12] px-6 text-slate-100">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold">{uiText("Studio is unavailable")}</h1>
          <p className="mt-2 text-sm text-slate-300">{routeError}</p>
          <button
            type="button"
            onClick={() => setRetryAttempt(attempt => attempt + 1)}
            className="mt-5 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >{uiText("Try again")}</button>
        </div>
      </div>
    );
  }

  return (
    <StudioSkeletonLoader />
  );
}
