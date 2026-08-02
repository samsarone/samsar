import { useState, useContext, createContext, useCallback, useRef } from 'react';
import axios from 'axios';
import { getHeaders, getAuthToken, clearAuthData } from '../utils/web'; // Adjust the path if needed

const PROCESSOR_SERVER = import.meta.env.VITE_PROCESSOR_API || 'http://localhost:3002';

function getInitialAuthState() {
  const authToken = getAuthToken();
  const hasAuthToken = Boolean(authToken && authToken !== 'undefined');
  const hasLoginToken =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has('loginToken');
  const needsAuthBootstrap = hasAuthToken || hasLoginToken;

  return {
    userFetching: needsAuthBootstrap,
    userInitiated: !needsAuthBootstrap,
  };
}

const UserContext = createContext({
  user: null,
  setUser: () => {},
  getUser: () => {},
  setUserApi: () => {},
  resetUser: () => {},
  getUserAPI: () => null,
  userFetching: false,
  userInitiated: false,
});

export const UserProvider = ({ children }) => {
  const [initialAuthState] = useState(getInitialAuthState);
  const [user, setUserState] = useState(null);
  const [userFetching, setUserFetching] = useState(initialAuthState.userFetching);
  const [userInitiated, setUserInitiated] = useState(initialAuthState.userInitiated);
  const authRequestSequence = useRef(0);

  const setUserApi = () => {
    // Placeholder for future use
  };

  const setUser = (profile) => {
    setUserState(profile);
  };

  const getUser = () => user;

  const resetUser = useCallback(() => {
    authRequestSequence.current += 1;
    setUserState(null);
    clearAuthData();
    setUserFetching(false);
    setUserInitiated(true);
  }, []);

  const getUserAPI = useCallback(async () => {
    const requestSequence = ++authRequestSequence.current;
    const isLatestRequest = () => authRequestSequence.current === requestSequence;
    const authToken = getAuthToken();

    if (!authToken || authToken === 'undefined') {
      setUserFetching(false);
      setUserInitiated(true);
      return null;
    }

    setUserFetching(true);

    try {
      const authHeaders = getHeaders();
      const res = await axios.get(`${PROCESSOR_SERVER}/users/verify_token`, {
        ...(authHeaders || {}),
        params: { _: Date.now() },
      });
      if (!isLatestRequest()) return null;
      const userProfile = res.data;
      setUserState(userProfile);
      setUserInitiated(true);
      return userProfile;
    } catch (error) {
      if (!isLatestRequest()) return null;
      setUserState(null);
      if ([400, 401, 403].includes(error?.response?.status)) {
        clearAuthData();
      }
      setUserInitiated(true);
      return null;
    } finally {
      if (isLatestRequest()) setUserFetching(false);
    }
  }, []);

  return (
    <UserContext.Provider
      value={{
        user,
        setUserApi,
        getUser,
        getUserAPI,
        resetUser,
        setUser,
        userFetching,
        userInitiated,
      }}
    >
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => useContext(UserContext);
