import { getDefaultAuthenticatedPath } from './defaultRoutes.js';
import { appendRouteSearch, resolveAuthenticatedEntryPath } from './vidgenieRouting.js';
import {
  consumePostAuthRedirect,
  getHeaders,
  hasAcceptedCookies,
  setPostAuthRedirect,
} from './web.jsx';

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

export async function resolvePostAuthDestination({
  user,
  isMobile = false,
  apiServer,
  search = '',
  redirect = null,
  createIfMissing = true,
} = {}) {
  const normalizedRedirect = sanitizeAuthRedirect(redirect);
  if (normalizedRedirect) return normalizedRedirect;

  const defaultPath = getDefaultAuthenticatedPath(user, { isMobile }) || '/vidgenie';
  const headers = getHeaders();
  if (!headers) {
    return appendRouteSearch(defaultPath, search);
  }

  try {
    const targetPath = await resolveAuthenticatedEntryPath({
      user,
      isMobile,
      apiServer,
      headers,
      search,
      createIfMissing,
    });
    return targetPath || appendRouteSearch(defaultPath, search);
  } catch {
    return appendRouteSearch(defaultPath, search);
  }
}
