
import { useUser } from '../../../contexts/UserContext.jsx';
import { useNavigate, useLocation } from 'react-router-dom';
import Login from '../Login.tsx';  // <-- Reuse your existing Login component
import OverflowContainer from '../../common/OverflowContainer.tsx';
import { useMediaQuery } from 'react-responsive';
import {
  buildGoogleLoginUrl,
  consumeResolvedAuthRedirect,
  getCurrentAuthRedirect,
  persistAuthRedirectForFlow,
  resolvePostAuthDestination,
} from '../../../utils/authRedirect.js';

const PROCESSOR_SERVER = import.meta.env.VITE_PROCESSOR_API;
const IS_DOCKER_INSTALL = import.meta.env.VITE_DOCKER_INSTALL === 'true';

export default function LoginPage() {
  const { setUser } = useUser();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useMediaQuery({ query: '(max-width: 767px)' });
  const requestedRedirect = getCurrentAuthRedirect(location);

  // In a page (vs. a modal), we can define a no-op or minimal function:
  const closeAlertDialog = () => {
    // No-op in a full page context
  };

  const handleViewChange = (view) => {
    const targetPath = view === 'register' ? '/register' : '/login';
    if (location.pathname !== targetPath) {
      navigate({ pathname: targetPath, search: location.search });
    }
  };

  const signInWithGoogle = () => {
    if (IS_DOCKER_INSTALL) {
      return;
    }

    const redirect = persistAuthRedirectForFlow(requestedRedirect, { isMobile });
    window.location.href = buildGoogleLoginUrl({
      processorServer: PROCESSOR_SERVER,
      redirect,
    });
  };

  const navigateAfterAuth = async (resolvedUser = null) => {
    const redirect = consumeResolvedAuthRedirect(requestedRedirect);
    const destination = await resolvePostAuthDestination({
      user: resolvedUser,
      isMobile,
      apiServer: PROCESSOR_SERVER,
      redirect,
      search: location.search,
    });
    navigate(destination, { replace: true });
  };

  return (
    <OverflowContainer>
      <div className="flex min-h-[calc(100vh-96px)] w-full flex-col items-center justify-center px-4 py-6 sm:py-8">
        <div className="w-full max-w-md">
          <Login
            signInWithGoogle={signInWithGoogle}
            setUser={setUser}
            closeAlertDialog={closeAlertDialog}
            getOrCreateUserSession={navigateAfterAuth}
            showSignupButton={false}
            showGoogleAuth={!IS_DOCKER_INSTALL}
            setCurrentLoginView={handleViewChange}
          />
        </div>
      </div>
    </OverflowContainer>
  );
}
