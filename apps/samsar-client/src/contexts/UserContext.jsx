import { useState, useContext, createContext, useCallback } from 'react';
import axios from 'axios';
import { getHeaders, getAuthToken, clearAuthData } from '../utils/web'; // Adjust the path if needed

const PROCESSOR_SERVER = import.meta.env.VITE_PROCESSOR_API || 'http://localhost:3002';

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
  const [user, setUserState] = useState(null);
  const [userFetching, setUserFetching] = useState(true);
  const [userInitiated, setUserInitiated] = useState(false);

  const setUserApi = () => {
    // Placeholder for future use
  };

  const setUser = (profile) => {
    setUserState(profile);
  };

  const getUser = () => user;

  const resetUser = useCallback(() => {
    setUserState(null);
    clearAuthData();
  }, []);

  const getUserAPI = useCallback(async () => {
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
      const userProfile = res.data;
      setUserState(userProfile);
      setUserInitiated(true);
      return userProfile;
    } catch  {
      setUserState(null);
      setUserInitiated(true);
      return null;
    } finally {
      setUserFetching(false);
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
