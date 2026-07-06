import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useLocation } from 'react-router-dom';

import AuthContainer from './AuthContainer.jsx';
import { clearAuthData, getAuthToken } from '../../utils/web.jsx';

const PROCESSOR_SERVER = import.meta.env.VITE_PROCESSOR_API;
const EXTENSION_REDIRECT_HOST_SUFFIX = '.chromiumapp.org';

function normalizeRedirectUri(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  try {
    const redirectUrl = new URL(value);
    if (
      redirectUrl.protocol !== 'https:'
      || !redirectUrl.hostname.endsWith(EXTENSION_REDIRECT_HOST_SUFFIX)
    ) {
      return null;
    }

    return redirectUrl;
  } catch  {
    return null;
  }
}

function extractLoginToken(payload) {
  if (typeof payload?.loginToken === 'string' && payload.loginToken.trim()) {
    return payload.loginToken.trim();
  }

  if (typeof payload?.loginUrl !== 'string' || !payload.loginUrl.trim()) {
    return null;
  }

  try {
    const loginUrl = new URL(payload.loginUrl);
    const loginToken = loginUrl.searchParams.get('loginToken');
    return typeof loginToken === 'string' && loginToken.trim()
      ? loginToken.trim()
      : null;
  } catch  {
    return null;
  }
}

export default function ExtensionAuthBridge() {
  const location = useLocation();
  const [phase, setPhase] = useState('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const redirectUri = useMemo(() => {
    const query = new URLSearchParams(location.search);
    return normalizeRedirectUri(query.get('redirect_uri'));
  }, [location.search]);

  const redirectTo = useMemo(
    () => `${location.pathname}${location.search}`,
    [location.pathname, location.search],
  );

  useEffect(() => {
    let cancelled = false;

    if (!redirectUri) {
      setPhase('error');
      setErrorMessage('This extension sign-in request is missing a valid redirect URI.');
      return () => {
        cancelled = true;
      };
    }

    const authToken = getAuthToken();
    if (!authToken) {
      setPhase('login');
      setErrorMessage('');
      return () => {
        cancelled = true;
      };
    }

    const createExtensionLoginToken = async () => {
      setPhase('loading');
      setErrorMessage('');

      try {
        const response = await axios.get(`${PROCESSOR_SERVER}/v1/create_login_token`, {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        });
        const loginToken = extractLoginToken(response?.data);

        if (!loginToken) {
          throw new Error('Samsar could not create an extension login token.');
        }

        const nextRedirectUrl = new URL(redirectUri.toString());
        nextRedirectUrl.searchParams.set('loginToken', loginToken);
        window.location.replace(nextRedirectUrl.toString());
      } catch (error) {
        if (cancelled) {
          return;
        }

        const status = error?.response?.status;
        const message =
          error?.response?.data?.message
          || error?.message
          || 'Unable to connect this extension to Samsar One.';

        if (status === 401 || status === 403) {
          clearAuthData();
          setPhase('login');
          setErrorMessage('Your Samsar session expired. Sign in again to continue.');
          return;
        }

        setPhase('error');
        setErrorMessage(message);
      }
    };

    void createExtensionLoginToken();

    return () => {
      cancelled = true;
    };
  }, [redirectUri]);

  if (phase === 'login') {
    return (
      <div className="min-h-screen px-4 py-8">
        {errorMessage ? (
          <div className="mx-auto mb-4 max-w-md rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMessage}
          </div>
        ) : null}
        <AuthContainer redirectTo={redirectTo} />
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Extension sign-in unavailable</h1>
          <p className="mt-3 text-sm text-slate-600">
            {errorMessage || 'Unable to connect this extension to Samsar One right now.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col items-center justify-center gap-4 py-10 text-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-slate-900" />
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Connecting your extension</h1>
            <p className="mt-2 text-sm text-slate-600">
              Using your current Samsar One session to finish sign-in.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
