import { useEffect, useRef } from 'react';
import { useUser } from '../../contexts/UserContext';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { getHeaders, getAuthToken } from '../../utils/web';
import './home.css';
import StudioSkeletonLoader from './util/StudioSkeletonLoader.jsx';

const API_SERVER = import.meta.env.VITE_PROCESSOR_API;

export default function VideoEditorLandingHome() {

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

      const createNewSession = async () => {
        const headers = getHeaders();
        const res = await axios.post(`${API_SERVER}/video_sessions/create_video_session`, { prompts: [] }, headers);
        const sessionData = res.data;
        localStorage.setItem('videoSessionId', sessionData._id);
        navigate(`/video/${sessionData._id}`, { replace: true });
      };

      if (isGuest) {
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
      try {
        const res = await axios.get(`${API_SERVER}/video_sessions/get_session`, headers);
        const sessionData = res.data;
        if (sessionData) {
          localStorage.setItem('videoSessionId', sessionData._id);
          navigate(`/video/${sessionData._id}`, { replace: true });
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
