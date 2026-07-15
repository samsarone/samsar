import { useEffect, useRef } from 'react';
import { useUser } from '../../contexts/UserContext';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { getHeaders, getAuthToken } from '../../utils/web';
import StudioSkeletonLoader from '../video/util/StudioSkeletonLoader.jsx';


const API_SERVER = import.meta.env.VITE_PROCESSOR_API;
const IS_DOCKER_INSTALL = import.meta.env.VITE_DOCKER_INSTALL === 'true';

export default function QuickEditorLandingHome() {

  const { user, userFetching, userInitiated } = useUser();
  const navigate = useNavigate();
  const redirectStartedRef = useRef(false);

  useEffect(() => {
    if (!userInitiated || userFetching || redirectStartedRef.current) {
      return;
    }

    redirectStartedRef.current = true;

    const run = async () => {
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
          if (sessionData) {
            navigate(`/quick_video/${sessionData._id}`, { replace: true });
          }
        } catch  {
          
        }
        return;
      }

      const videoSessionId = localStorage.getItem('videoSessionId');
      if (videoSessionId) {
        navigate(`/quick_video/${videoSessionId}`, { replace: true });
        return;
      }

      const headers = getHeaders();
      try {
        const res = await axios.get(`${API_SERVER}/video_sessions/get_session`, headers);
        const sessionData = res.data;
        if (sessionData) {
          localStorage.setItem('videoSessionId', sessionData._id);
          navigate(`/quick_video/${sessionData._id}`, { replace: true });
        } else {
          navigate('/my_sessions', { replace: true });
        }
      } catch  {
        
      }
    };

    run();
  }, [userInitiated, userFetching, user, navigate]);

  return (
    <StudioSkeletonLoader />
  );
}
