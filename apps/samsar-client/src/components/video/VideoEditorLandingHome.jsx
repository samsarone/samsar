import { useEffect, useRef, useState } from 'react';
import { useUser } from '../../contexts/UserContext';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { getHeaders, getAuthToken } from '../../utils/web';
import './home.css';
import StudioSkeletonLoader from './util/StudioSkeletonLoader.jsx';
import { IS_STANDALONE_DEPLOYMENT } from '../../utils/environment.jsx';

const API_SERVER = import.meta.env.VITE_PROCESSOR_API;
const preloadVideoEditor = () => import('./VideoHome.jsx');

export default function VideoEditorLandingHome() {

  const { user, userFetching, userInitiated } = useUser();
  const navigate = useNavigate();
  const redirectStartedRef = useRef(false);
  const [routeError, setRouteError] = useState('');

  useEffect(() => {
    if (!userInitiated || userFetching || redirectStartedRef.current) {
      return;
    }

    redirectStartedRef.current = true;

    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function' ||
      !window.matchMedia('(max-width: 767px)').matches
    ) {
      // The API lookup and the editor bundle are both required for the next route.
      // Fetch them concurrently instead of waiting for the lookup to finish first.
      void preloadVideoEditor().catch(() => undefined);
    }

    const run = async () => {
      const userToken = getAuthToken();
      const isGuest = !userToken || !user || !user._id;

      const createNewSession = async () => {
        const headers = getHeaders();
        const res = await axios.post(`${API_SERVER}/video_sessions/create_video_session`, { prompts: [] }, headers);
        const sessionData = res.data;
        if (!sessionData?._id) {
          throw new Error('The Studio session response did not include an id.');
        }
        localStorage.setItem('videoSessionId', sessionData._id);
        navigate(`/video/${sessionData._id}`, { replace: true });
      };

      if (isGuest) {
        if (IS_STANDALONE_DEPLOYMENT) {
          navigate('/login', { replace: true });
          return;
        }

        try {
          const res = await axios.get(`${API_SERVER}/video_sessions/fetch_guest_session`);
          const sessionData = res.data;
          if (sessionData && sessionData._id) {
            navigate(`/video/${sessionData._id}`, { replace: true });
          }
        } catch  {
          
        }
        return;
      }

      const videoSessionId = localStorage.getItem('videoSessionId');
      if (videoSessionId) {
        const headers = getHeaders();
        try {
          const res = await axios.get(
            `${API_SERVER}/video_sessions/validate_session?sessionId=${videoSessionId}`,
            headers
          );
          const sessionData = res.data;
          if (sessionData) {
            navigate(`/video/${videoSessionId}`, { replace: true });
            return;
          }
        } catch  {
          
        }

        localStorage.removeItem('videoSessionId');
        await createNewSession();
        return;
      }

      const headers = getHeaders();
      let shouldCreateStandaloneSession = false;
      try {
        const res = await axios.get(`${API_SERVER}/video_sessions/get_session`, headers);
        const sessionData = res.data;
        if (sessionData?._id) {
          localStorage.setItem('videoSessionId', sessionData._id);
          navigate(`/video/${sessionData._id}`, { replace: true });
        } else if (IS_STANDALONE_DEPLOYMENT) {
          shouldCreateStandaloneSession = true;
        } else {
          navigate('/my_sessions', { replace: true });
        }
      } catch {
        shouldCreateStandaloneSession = IS_STANDALONE_DEPLOYMENT;
      }

      if (shouldCreateStandaloneSession) {
        await createNewSession();
      }
    };

    void run().catch(() => {
      setRouteError('Unable to open Studio. Check the server connection and try again.');
    });
  }, [userInitiated, userFetching, user, navigate]);

  if (routeError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0c0d12] px-6 text-slate-100">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold">Studio is unavailable</h1>
          <p className="mt-2 text-sm text-slate-300">{routeError}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <StudioSkeletonLoader />
  );
}
