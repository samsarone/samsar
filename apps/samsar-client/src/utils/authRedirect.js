import axios from 'axios';
import { getDefaultAuthenticatedPath } from './defaultRoutes.js';
import { appendRouteSearch, resolveAuthenticatedEntryPath } from './vidgenieRouting.js';
import {
  consumePostAuthRedirect,
  getHeaders,
  hasAcceptedCookies,
  setPostAuthRedirect,
} from './web.jsx';
import { IS_STANDALONE_DEPLOYMENT } from './environment.jsx';

const AUTH_ROUTE_PATHS = new Set([
  '/login',
  '/register',
  '/forgot_password',
  '/reset_password',
  '/verify',
  '/verify_email',
]);

export function sanitizeAuthRedirect(value) {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed || !trimmed.startsWith('/') || trimmed.startsWith('//')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;

  return trimmed;
}

export function getRoutePath(location) {
  const pathname = location?.pathname || '/';
  const search = location?.search || '';
  return `${pathname}${search}`;
}

export function getRedirectParam(location) {
  const params = new URLSearchParams(location?.search || '');
  return sanitizeAuthRedirect(params.get('redirect'));
}

export function getCurrentAuthRedirect(location, explicitRedirect) {
  const normalizedExplicitRedirect = sanitizeAuthRedirect(explicitRedirect);
  if (normalizedExplicitRedirect) return normalizedExplicitRedirect;

  const queryRedirect = getRedirectParam(location);
  if (queryRedirect) return queryRedirect;

  const pathname = location?.pathname || '/';
  if (pathname === '/' || AUTH_ROUTE_PATHS.has(pathname)) return null;

  return sanitizeAuthRedirect(getRoutePath(location));
}

export function buildLoginPathForRedirect(targetPath) {
  const redirect = sanitizeAuthRedirect(targetPath);
  return redirect ? `/login?redirect=${encodeURIComponent(redirect)}` : '/login';
}

function getMediaFlowPathForRedirect(redirect, { isMobile = false } = {}) {
  const normalizedRedirect = sanitizeAuthRedirect(redirect) || '';
  if (
    normalizedRedirect.startsWith('/vidgenie') ||
    normalizedRedirect.startsWith('/vidgpt') ||
    normalizedRedirect.startsWith('/videogpt') ||
    normalizedRedirect.startsWith('/quick_video')
  ) {
    return 'quick_video';
  }

  return isMobile ? 'quick_video' : 'video';
}

export function persistAuthRedirectForFlow(redirect, options = {}) {
  const normalizedRedirect = sanitizeAuthRedirect(redirect);

  if (normalizedRedirect) {
    setPostAuthRedirect(normalizedRedirect);
  }

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(
        'currentMediaFlowPath',
        getMediaFlowPathForRedirect(normalizedRedirect, options)
      );
    } catch {
      // Storage access should not block sign-in.
    }
  }

  return normalizedRedirect;
}

export function buildGoogleLoginUrl({
  processorServer,
  redirect,
  subscribeToWeeklyNewsletter,
} = {}) {
  const origin = window.location.origin;
  const cookieConsent = hasAcceptedCookies() ? 'accepted' : 'rejected';
  const params = new URLSearchParams({ origin, cookieConsent });
  params.set('responseMode', 'redirect');

  if (subscribeToWeeklyNewsletter !== undefined) {
    params.set('subscribeToWeeklyNewsletter', String(subscribeToWeeklyNewsletter));
  }

  const normalizedRedirect = sanitizeAuthRedirect(redirect);
  if (normalizedRedirect) {
    params.set('redirect', normalizedRedirect);
  }

  return `${processorServer}/users/google_login?${params.toString()}`;
}

export function consumeResolvedAuthRedirect(fallbackRedirect = null) {
  const normalizedFallback = sanitizeAuthRedirect(fallbackRedirect);
  const storedRedirect = sanitizeAuthRedirect(consumePostAuthRedirect());
  return normalizedFallback || storedRedirect;
}

function getCreatedProjectSessionId(data) {
  const value = data?.sessionId || data?.session_id || data?._id || data?.id;
  if (typeof value === 'string') return value.trim() || null;
  if (value && typeof value.toString === 'function') {
    const stringValue = value.toString();
    return stringValue && stringValue !== '[object Object]' ? stringValue : null;
  }
  return null;
}

function storeCreatedProjectSessionId(sessionId) {
  if (typeof window === 'undefined' || !sessionId) return;
  try {
    window.localStorage.setItem('videoSessionId', sessionId);
  } catch {
    // Storage access should not block the new-user route.
  }
}

async function createSignupProjectWithLegacyEndpoint({
  apiServer,
  headers,
  editor,
}) {
  if (editor === 'vidgenie') {
    const { data } = await axios.post(`${apiServer}/vidgenie/create_blank`, {}, headers);
    return getCreatedProjectSessionId(data);
  }

  const { data } = await axios.post(
    `${apiServer}/video_sessions/create_video_session`,
    { prompts: [] },
    headers,
  );
  return getCreatedProjectSessionId(data);
}

export async function resolvePostSignupDestination({
  isMobile = false,
  apiServer,
} = {}) {
  // A signup started from the public sample must never resume that sample.
  consumeResolvedAuthRedirect();

  const editor = isMobile ? 'vidgenie' : 'studio';
  const fallbackPath = isMobile ? '/vidgenie' : '/video';
  const headers = getHeaders();
  if (!apiServer || !headers) return fallbackPath;

  let sessionId = null;
  try {
    const { data } = await axios.post(
      `${apiServer}/video_sessions/create_signup_project`,
      { editor },
      headers,
    );
    sessionId = getCreatedProjectSessionId(data);
  } catch (error) {
    if (![404, 405].includes(error?.response?.status)) {
      throw error;
    }
    sessionId = await createSignupProjectWithLegacyEndpoint({
      apiServer,
      headers,
      editor,
    });
  }

  if (!sessionId) {
    throw new Error('The new project response did not include a session id.');
  }

  storeCreatedProjectSessionId(sessionId);
  return isMobile ? `/vidgenie/${sessionId}` : `/video/${sessionId}`;
}

export async function resolvePostAuthDestination({
  user,
  isMobile = false,
  apiServer,
  search = '',
  redirect = null,
  createIfMissing = true,
} = {}) {
  const normalizedRedirect = IS_STANDALONE_DEPLOYMENT ? null : sanitizeAuthRedirect(redirect);
  if (normalizedRedirect) return normalizedRedirect;

  const defaultPath = getDefaultAuthenticatedPath(user, { isMobile }) || '/vidgenie';
  const destinationSearch = IS_STANDALONE_DEPLOYMENT ? '' : search;
  const headers = getHeaders();
  if (!headers) {
    return appendRouteSearch(defaultPath, destinationSearch);
  }

  try {
    const targetPath = await resolveAuthenticatedEntryPath({
      user,
      isMobile,
      apiServer,
      headers,
      search: destinationSearch,
      createIfMissing,
    });
    return targetPath || appendRouteSearch(defaultPath, destinationSearch);
  } catch {
    return appendRouteSearch(defaultPath, destinationSearch);
  }
}
