import { useEffect } from 'react';
import axios from 'axios';
import { FaSpinner } from 'react-icons/fa6';
import { useNavigate, useLocation } from 'react-router-dom';
import { useMediaQuery } from 'react-responsive';
import Loader from '../common/Loader';
import { persistAuthToken } from '../../utils/web';
import { useUser } from '../../contexts/UserContext.jsx';
import {
  buildLoginPathForRedirect,
  consumeResolvedAuthRedirect,
  resolvePostAuthDestination,
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

  useEffect(() => {
    const finalizeAuth = async (resolvedAuthToken: string) => {
      if (!resolvedAuthToken) {
        return;
      }

      persistAuthToken(resolvedAuthToken);

      const isPopup = typeof window !== 'undefined' && window.opener && window.opener !== window;
      if (isPopup) {
        const channel = new BroadcastChannel('oauth_channel');
        channel.postMessage('oauth_complete');
        window.close();
        return;
      }

      const resolvedUser = await getUserAPI();
      const redirectTarget = consumeResolvedAuthRedirect(safeRedirect);
      if (!resolvedUser?._id && !redirectTarget) {
        navigate(buildLoginPathForRedirect(safeRedirect), { replace: true });
        return;
      }

      const destination = await resolvePostAuthDestination({
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
  }, [authToken, getUserAPI, isMobile, location.search, loginToken, navigate, safeRedirect]);

  if (!authToken && !loginToken) {
    return <FaSpinner className="animate-spin" />;
  }

  return (
    <div className='bg-gray-800 h-full absolute w-full'>
      <div className='m-auto text-center min-w-16 h-full mt-8 text-neutral-100'>

        <div>
          Verification Completed.
        </div>
        <div className='m-auto'>
          Redirecting to Home 
          <Loader />
        </div>

      </div>
    </div>
  );
}
