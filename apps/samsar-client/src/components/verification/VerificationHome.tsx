import { useEffect } from 'react';
import axios from 'axios';
import { useNavigate, useLocation } from 'react-router-dom';
import { useMediaQuery } from 'react-responsive';
import { persistAuthToken } from '../../utils/web';
import { useUser } from '../../contexts/UserContext.jsx';
import VidgenieSkeletonLoader from '../oneshot_editor/VidgenieSkeletonLoader.jsx';
import {
  buildLoginPathForRedirect,
  consumeResolvedAuthRedirect,
  resolvePostAuthDestination,
  resolvePostSignupDestination,
  sanitizeAuthRedirect,
} from '../../utils/authRedirect.js';

const PROCESSOR_SERVER = import.meta.env.VITE_PROCESSOR_API || 'http://localhost:3002';

export default function VerificationHome() {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useMediaQuery({ query: '(max-width: 767px)' });
  const { getUserAPI } = useUser();

  const query = new URLSearchParams(location.search);
  const authToken = query.get('authToken');
  const loginToken = query.get('loginToken');
  const redirectParam = query.get('redirect');
  const safeRedirect = sanitizeAuthRedirect(redirectParam);
  const isNewUser = query.get('newUser') === 'true';

  useEffect(() => {
    const finalizeAuth = async (resolvedAuthToken: string) => {
      if (!resolvedAuthToken) {
        return;
      }

      persistAuthToken(resolvedAuthToken);

      const isPopup = typeof window !== 'undefined' && window.opener && window.opener !== window;
      if (isPopup) {
        const channel = new BroadcastChannel('oauth_channel');
        channel.postMessage({ type: 'oauth_complete', isNewUser });
        window.close();
        return;
      }

      const resolvedUser = await getUserAPI();
      const redirectTarget = isNewUser
        ? null
        : consumeResolvedAuthRedirect(safeRedirect);
      if (!resolvedUser?._id && !redirectTarget) {
        navigate(buildLoginPathForRedirect(safeRedirect), { replace: true });
        return;
      }

      const destination = isNewUser
        ? await resolvePostSignupDestination({
            isMobile,
            apiServer: PROCESSOR_SERVER,
          })
        : await resolvePostAuthDestination({
            user: resolvedUser,
            isMobile,
            apiServer: PROCESSOR_SERVER,
            redirect: redirectTarget,
          });
      navigate(destination, { replace: true });
    };

    if (authToken) {
      void finalizeAuth(authToken);
      return;
    }

    if (loginToken) {
      const exchangeLoginToken = async () => {
        try {
          const response = await axios.get(`${PROCESSOR_SERVER}/users/verify_token`, {
            params: { loginToken, _: Date.now() },
          });
          const resolvedAuthToken = response?.data?.authToken;
          if (resolvedAuthToken) {
            await finalizeAuth(resolvedAuthToken);
            return;
          }
        } catch  {
          
        }

        navigate(buildLoginPathForRedirect(safeRedirect), { replace: true });
      };

      void exchangeLoginToken();
    }
  }, [authToken, getUserAPI, isMobile, isNewUser, location.search, loginToken, navigate, safeRedirect]);

  return <VidgenieSkeletonLoader />;
}
