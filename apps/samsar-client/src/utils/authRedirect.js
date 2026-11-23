import { DEFAULT_APP_PATH } from './defaultRoutes.js';
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
  // Browsers normalize backslashes and strip control characters when parsing
  // URLs, so these can turn a local-looking path into a remote redirect.
  if (/[\\\u0000-\u001f\u007f]/.test(trimmed)) return null;

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
  if (pathname === '/' || pathname === DEFAULT_APP_PATH || AUTH_ROUTE_PATHS.has(pathname)) return null;

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

export function resolvePostSignupDestination() {
  // A new account starts on Create even if signup began in a public sample.
  consumePostAuthRedirect();
  return DEFAULT_APP_PATH;
}

export async function resolvePostAuthDestination({
  user,
  apiServer,
  search = '',
  redirect = null,
} = {}) {
  const requestedRedirect = sanitizeAuthRedirect(redirect);
  if (requestedRedirect && (!IS_STANDALONE_DEPLOYMENT || requestedRedirect === '/create')) {
    return requestedRedirect;
  }

  const destinationSearch = IS_STANDALONE_DEPLOYMENT ? '' : search;
  const fallback = appendRouteSearch(DEFAULT_APP_PATH, destinationSearch);
  const headers = getHeaders();
  if (!headers) return fallback;

  try {
    const path = await resolveAuthenticatedEntryPath({ user, apiServer, headers, search: destinationSearch });
    return path || fallback;
  } catch {
    return fallback;
  }
}
