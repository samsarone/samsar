import { useEffect, useState } from 'react';
import Login from './Login.tsx';
import Register from './Register.tsx';
import ForgotPassword from './ForgotPassword.jsx';
import axios from 'axios';
import { useAlertDialog } from '../../contexts/AlertDialogContext.jsx';
import { useUser } from '../../contexts/UserContext.jsx';
import { useNavigate, useLocation } from 'react-router-dom';
import { persistAuthToken } from '../../utils/web.jsx';
import { FaTimes } from 'react-icons/fa';
import { useMediaQuery } from 'react-responsive';
import {
  buildGoogleLoginUrl,
  consumeResolvedAuthRedirect,
  getCurrentAuthRedirect,
  persistAuthRedirectForFlow,
  resolvePostAuthDestination,
  resolvePostSignupDestination,
} from '../../utils/authRedirect.js';
import { PURCHASE_CREDITS_PROMPT_STORAGE_KEY } from '../account/PurchaseCreditsPromptDialog.jsx';
import { IS_STANDALONE_DEPLOYMENT } from '../../utils/environment.jsx';

const PROCESSOR_SERVER = import.meta.env.VITE_PROCESSOR_API;

export const AUTH_DIALOG_OPTIONS = {
  surface: 'auth',
  transparentShell: true,
  fullBleed: true,
  centerContent: true,
  hideBorder: true,
  hideCloseButton: true,
};

export default function AuthContainer(props) {
  const { initView, redirectTo } = props;

  const [error, setError] = useState('');
  const [currentLoginView, setCurrentLoginView] = useState('login');
  
  const API_SERVER = import.meta.env.VITE_PROCESSOR_API;
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useMediaQuery({ query: '(max-width: 767px)' });
  const { closeAlertDialog } = useAlertDialog();
  const { setUser } = useUser();
  const requestedRedirect = getCurrentAuthRedirect(location, redirectTo);

  useEffect(() => {
    if (initView) {
      if (initView === 'register' && !IS_STANDALONE_DEPLOYMENT) {
        setCurrentLoginView('register');
      } else {
        setCurrentLoginView('login');
      }
    }
  }, [initView]);

  const signInWithGoogle = () => {
    if (IS_STANDALONE_DEPLOYMENT) {
      return;
    }
    const redirect = persistAuthRedirectForFlow(requestedRedirect, { isMobile });
    window.location.href = buildGoogleLoginUrl({
      processorServer: PROCESSOR_SERVER,
      redirect,
    });
    closeAlertDialog();
  };

  const registerWithGoogle = ({ subscribeToWeeklyNewsletter = true } = {}) => {
    if (IS_STANDALONE_DEPLOYMENT) {
      return;
    }
    const redirect = persistAuthRedirectForFlow(requestedRedirect, { isMobile });
    localStorage.setItem("setShowSetPaymentFlow", true);
    localStorage.setItem(PURCHASE_CREDITS_PROMPT_STORAGE_KEY, 'true');
    window.location.href = buildGoogleLoginUrl({
      processorServer: PROCESSOR_SERVER,
      redirect,
      subscribeToWeeklyNewsletter,
    });
    closeAlertDialog();
  };

  const navigateAfterAuth = async (resolvedUser = null) => {
    try {
      const redirect = consumeResolvedAuthRedirect(requestedRedirect);
      const destination = await resolvePostAuthDestination({
        user: resolvedUser,
        isMobile,
        apiServer: API_SERVER,
        redirect,
        search: location.search,
      });
      navigate(destination, { replace: true });
    } catch  {
      setError('Unable to open your workspace.');
    }
  };

  const navigateAfterSignup = async () => {
    const destination = await resolvePostSignupDestination({
      isMobile,
      apiServer: API_SERVER,
    });
    navigate(destination, { replace: true });
  };

  const verifyAndSetUserProfile = (profile) => {
    axios.post(`${PROCESSOR_SERVER}/users/verify`, profile)
      .then((dataRes) => {
        const userData = dataRes.data;
        const authToken = userData.authToken;
        persistAuthToken(authToken);
        setUser(userData);
        closeAlertDialog();
      })
      .catch(() => {
        
        setError('Unable to verify user profile.');
      });
  };

  /**
   * Register user with email and bubble up server errors if any
   */
  const registerUserWithEmail = async (payload, onError) => {
    let userData;
    try {
      const { data } = await axios.post(`${PROCESSOR_SERVER}/users/register`, payload);
      userData = data;
    } catch (error) {
      const serverMessage = error.response?.data?.message || error.response?.data?.error;
      onError(serverMessage || 'Unable to register user at this time. Please try again.');
      return;
    }

    persistAuthToken(userData.authToken);
    setUser(userData);
    localStorage.setItem(PURCHASE_CREDITS_PROMPT_STORAGE_KEY, 'true');
    localStorage.setItem("setShowSetPaymentFlow", true);

    try {
      await navigateAfterSignup();
      closeAlertDialog();
    } catch {
      const message = 'Your account was created, but a new project could not be opened.';
      setError(message);
      onError(message);
    }
  };

  let authoComponent;



  if (currentLoginView === 'login') {
    authoComponent = (
      <Login
        setCurrentLoginView={setCurrentLoginView}
        signInWithGoogle={signInWithGoogle}
        verifyAndSetUserProfile={verifyAndSetUserProfile}
        setUser={setUser}
        closeAlertDialog={closeAlertDialog}
        getOrCreateUserSession={navigateAfterAuth}
        showSignupButton={!IS_STANDALONE_DEPLOYMENT}
        showGoogleAuth={!IS_STANDALONE_DEPLOYMENT}
      />
    );
  } else if (currentLoginView === 'forgotPassword') {
    authoComponent = (
      <ForgotPassword
        setCurrentLoginView={setCurrentLoginView}
        closeAlertDialog={closeAlertDialog}
      />
    );
  } else if (!IS_STANDALONE_DEPLOYMENT) {
    authoComponent = (
      <Register
        setCurrentLoginView={setCurrentLoginView}
        registerWithGoogle={registerWithGoogle}
        verifyAndSetUserProfile={verifyAndSetUserProfile}
        setUser={setUser}
        getOrCreateUserSession={navigateAfterAuth}
        closeAlertDialog={closeAlertDialog}
        registerUserWithEmail={registerUserWithEmail}
        showLoginButton={true}
      />
    );
  } else {
    authoComponent = (
      <Login
        setCurrentLoginView={setCurrentLoginView}
        signInWithGoogle={signInWithGoogle}
        verifyAndSetUserProfile={verifyAndSetUserProfile}
        setUser={setUser}
        closeAlertDialog={closeAlertDialog}
        getOrCreateUserSession={navigateAfterAuth}
        showSignupButton={false}
        showGoogleAuth={false}
      />
    );
  }

  return (
    <div className="w-full h-full flex items-center justify-center">
      <div className="relative w-full max-w-md">
        {/* If you'd like to display container-level errors */}
        {error && (
          <div className="mb-3 text-center text-red-500">
            {error}
          </div>
        )}

        <FaTimes className="absolute top-3 right-3 cursor-pointer" onClick={closeAlertDialog} />
        {authoComponent}
      </div>
    </div>
  );
}
