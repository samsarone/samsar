import { useEffect, useRef } from 'react';
import { useUser } from '../../contexts/UserContext';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { getHeaders, getAuthToken } from '../../utils/web';
import RouteLoadingScreen from '../common/RouteLoadingScreen.jsx';


const API_SERVER = import.meta.env.VITE_PROCESSOR_API;
const IS_DOCKER_INSTALL = import.meta.env.VITE_DOCKER_INSTALL === 'true';

export default function MobileVideoLandingHome() {

  const { user, userFetching, userInitiated } = useUser();
  const navigate = useNavigate();
  const redirectStartedRef = useRef(false);

  useEffect(() => {
    if (!userInitiated || userFetching || redirectStartedRef.current) {
      return;
    }

    redirectStartedRef.current = true;

    const run = async () => {
      void import('../oneshot_editor/OneshotEditorContainer.jsx')
        .then(({ preloadOneshotEditor }) => preloadOneshotEditor())
        .catch(() => undefined);
      const userToken = getAuthToken();
      const isGuest = !userToken || !user || !user._id;

      if (isGuest) {
        if (IS_DOCKER_INSTALL) {
          navigate('/login', { replace: true });
          return;
        }

        try {
          const res = await axios.get(`${API_SERVER}/video_sessions/fetch_guest_session`);
          const sessionData = res.data;
          if (sessionData?._id && sessionData.isGuestSession === true) {
            navigate(`/vidgenie/${sessionData._id}`, {
              replace: true,
              state: { guestSession: sessionData },
            });
            return;
          }
        } catch {
          // The VidGenie entry route will show a recoverable guest error.
        }
        navigate('/vidgenie', { replace: true });
        return;
      }

      const videoSessionId = localStorage.getItem('videoSessionId');
      if (videoSessionId) {
        navigate(`/vidgenie/${videoSessionId}`, { replace: true });
        return;
      }

      const headers = getHeaders();
      try {
        const res = await axios.get(`${API_SERVER}/video_sessions/get_session`, headers);
        const sessionData = res.data;
        if (sessionData?._id) {
          localStorage.setItem('videoSessionId', sessionData._id);
          navigate(`/vidgenie/${sessionData._id}`, { replace: true });
        } else {
          navigate('/vidgenie', { replace: true });
        }
      } catch {
        // Let the VidGenie entry route create a fresh authenticated session or
        // present its recoverable error state instead of leaving this loader up.
        navigate('/vidgenie', { replace: true });
      }
    };

    run();
  }, [userInitiated, userFetching, user, navigate]);

  return (
    <RouteLoadingScreen label="Opening VidGenie..." />
  );
}
