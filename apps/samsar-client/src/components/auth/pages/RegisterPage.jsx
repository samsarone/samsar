
import axios from 'axios';
import { Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useUser } from '../../../contexts/UserContext.jsx';
import { persistAuthToken } from '../../../utils/web.jsx';
import Register from '../Register.tsx';
import OverflowContainer from '../../common/OverflowContainer.tsx';
import { useMediaQuery } from 'react-responsive';
import { PURCHASE_CREDITS_PROMPT_STORAGE_KEY } from '../../account/PurchaseCreditsPromptDialog.jsx';
import {
  buildGoogleLoginUrl,
  getCurrentAuthRedirect,
  persistAuthRedirectForFlow,
  resolvePostSignupDestination,
} from '../../../utils/authRedirect.js';
import { IS_STANDALONE_DEPLOYMENT } from '../../../utils/environment.jsx';

const PROCESSOR_SERVER = import.meta.env.VITE_PROCESSOR_API;

export default function RegisterPage() {
  const { setUser } = useUser();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useMediaQuery({ query: '(max-width: 767px)' });
  const requestedRedirect = getCurrentAuthRedirect(location);

  if (IS_STANDALONE_DEPLOYMENT) {
    return <Navigate to={{ pathname: '/login', search: location.search }} replace />;
  }

  // No-op if you don't need a dialog close
  const closeAlertDialog = () => { };

  const handleViewChange = (view) => {
    const targetPath = view === 'register' ? '/register' : '/login';
    if (location.pathname !== targetPath) {
      navigate({ pathname: targetPath, search: location.search });
    }
  };

  const registerWithGoogle = ({ subscribeToWeeklyNewsletter = true } = {}) => {
    if (IS_STANDALONE_DEPLOYMENT) {
      return;
    }

    const redirect = persistAuthRedirectForFlow(requestedRedirect, { isMobile });
    localStorage.setItem('setShowSetPaymentFlow', true);
    localStorage.setItem(PURCHASE_CREDITS_PROMPT_STORAGE_KEY, 'true');
    window.location.href = buildGoogleLoginUrl({
      processorServer: PROCESSOR_SERVER,
      redirect,
      subscribeToWeeklyNewsletter,
    });
  };

  const navigateAfterSignup = async () => {
    const destination = await resolvePostSignupDestination({
      isMobile,
      apiServer: PROCESSOR_SERVER,
    });
    navigate(destination, { replace: true });
  };

  // Register with email, same as AuthContainer
  const registerUserWithEmail = async (payload, onError = () => {}) => {
    let userData;
    try {
      const response = await axios.post(`${PROCESSOR_SERVER}/users/register`, payload);
      userData = response.data;
    } catch (error) {
      const serverMessage = error.response?.data?.message || error.response?.data?.error;
      onError(serverMessage || 'Unable to register user at this time. Please try again.');
      return;
    }

    const authToken = userData.authToken;
    persistAuthToken(authToken);
    setUser(userData);
    closeAlertDialog(); // no-op here
    localStorage.setItem(PURCHASE_CREDITS_PROMPT_STORAGE_KEY, 'true');
    localStorage.setItem('setShowSetPaymentFlow', 'true');

    try {
      await navigateAfterSignup();
    } catch {
      onError('Your account was created, but a new project could not be opened.');
    }
  };

  return (
    <OverflowContainer>
      <div className="flex min-h-[calc(100vh-96px)] w-full items-center justify-center px-4 py-6 sm:py-8">
        <Register
          registerWithGoogle={registerWithGoogle}
          registerUserWithEmail={registerUserWithEmail}
          setUser={setUser}
          getOrCreateUserSession={navigateAfterSignup}
          closeAlertDialog={closeAlertDialog}
          setCurrentLoginView={handleViewChange}
          showLoginButton={false}
        />
      </div>
    </OverflowContainer>
  );
}
