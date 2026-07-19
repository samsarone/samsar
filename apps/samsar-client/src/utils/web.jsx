import { getAuthCookiePolicy } from './authCookiePolicy.mjs';

const AUTH_TOKEN_KEY = 'authToken';
const COOKIE_CONSENT_KEY = 'samsar_cookie_consent';
const AUTH_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const POST_AUTH_REDIRECT_KEY = 'postAuthRedirect';
let inMemoryAuthToken = null;

const getCurrentAuthCookiePolicy = () =>
  getAuthCookiePolicy(
    import.meta.env.VITE_CURRENT_ENV,
    typeof window !== 'undefined' ? window.location.hostname : '',
  );

const getAuthCookie = () => {
  if (typeof document === 'undefined') return null;
  const cookies = document.cookie ? document.cookie.split(';') : [];
  const prefix = `${getCurrentAuthCookiePolicy().cookieName}=`;

  for (const cookie of cookies) {
    const trimmed = cookie.trim();
    if (trimmed.startsWith(prefix)) {
      const value = trimmed.slice(prefix.length);
      return value ? decodeURIComponent(value) : null;
    }
  }

  return null;
};

const setAuthCookie = (token) => {
  if (!token || typeof document === 'undefined') return;
  const policy = getCurrentAuthCookiePolicy();
  const domainAttr = policy.domain ? ` Domain=${policy.domain};` : '';
  const secureAttr =
    typeof window !== 'undefined' && window.location.protocol === 'https:' ? ' Secure;' : '';
  const encodedToken = encodeURIComponent(token);

  document.cookie = `${policy.cookieName}=${encodedToken}; Path=/; Max-Age=${AUTH_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax;${secureAttr}${domainAttr}`;
};

const expireAuthCookie = (cookieName, domain) => {
  if (typeof document === 'undefined') return;
  const domainAttr = domain ? ` Domain=${domain};` : '';
  document.cookie = `${cookieName}=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/;${domainAttr}`;
};

function clearAuthCookies() {
  if (typeof document === 'undefined') return;
  const policy = getCurrentAuthCookiePolicy();

  // Docker and development expire only their host-scoped cookie. Production
  // also expires the shared Samsar cookie used for cross-subdomain login.
  expireAuthCookie(policy.cookieName, null);
  if (policy.isSharedAcrossSubdomains) {
    expireAuthCookie(policy.cookieName, policy.domain);
  }
}

function getCookieConsentStatus() {
  if (typeof window === 'undefined') return 'accepted';
  try {
    return localStorage.getItem(COOKIE_CONSENT_KEY) || 'accepted';
  } catch {
    return 'accepted';
  }
}

export function hasAcceptedCookies() {
  return getCookieConsentStatus() === 'accepted';
}

// helpers/auth.jsx

export function getAuthToken() {
  if (inMemoryAuthToken) return inMemoryAuthToken;
  if (typeof window === 'undefined') return null;

  try {
    const legacyToken = localStorage.getItem(AUTH_TOKEN_KEY);
    if (legacyToken) {
      inMemoryAuthToken = legacyToken;
      return legacyToken;
    }
  } catch  {
    // Ignore storage read errors to avoid breaking auth flow.
  }

  try {
    const sessionToken = sessionStorage.getItem(AUTH_TOKEN_KEY);
    if (sessionToken) {
      inMemoryAuthToken = sessionToken;
      try {
        localStorage.setItem(AUTH_TOKEN_KEY, sessionToken);
      } catch  {
        // Ignore storage write errors.
      }
      return sessionToken;
    }
  } catch  {
    // Ignore storage read errors to avoid breaking auth flow.
  }

  if (hasAcceptedCookies()) {
    const cookieToken = getAuthCookie();
    if (cookieToken) {
      inMemoryAuthToken = cookieToken;
      try {
        localStorage.setItem(AUTH_TOKEN_KEY, cookieToken);
      } catch  {
        // Ignore storage write errors.
      }
      return cookieToken;
    }
  }

  return null;
}

export function getHeaders() {
  const token = getAuthToken();

  if (!token) return;
  return {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  };
}

export function persistAuthToken(token) {
  if (!token || typeof window === 'undefined') return;

  try {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch  {
    try {
      sessionStorage.setItem(AUTH_TOKEN_KEY, token);
    } catch  {
      // Ignore storage write errors; token will only live in memory.
    }
  }

  inMemoryAuthToken = token;
  if (hasAcceptedCookies()) {
    setAuthCookie(token);
  }
}

export function clearAuthData() {
  if (typeof window !== 'undefined') {
    try {
      sessionStorage.removeItem(AUTH_TOKEN_KEY);
    } catch  {
      // Ignore storage clear errors.
    }

    // Clear any stored auth tokens.
    try {
      localStorage.removeItem(AUTH_TOKEN_KEY);
    } catch  {
      // Ignore storage clear errors.
    }
  }

  inMemoryAuthToken = null;
  clearAuthCookies();
}

export function setPostAuthRedirect(path) {
  if (typeof window === 'undefined') return;
  if (!path || typeof path !== 'string') return;
  try {
    sessionStorage.setItem(POST_AUTH_REDIRECT_KEY, path);
  } catch  {
    // Ignore storage errors to avoid blocking auth flow.
  }
}

export function consumePostAuthRedirect() {
  if (typeof window === 'undefined') return null;
  try {
    const target = sessionStorage.getItem(POST_AUTH_REDIRECT_KEY);
    if (target) {
      sessionStorage.removeItem(POST_AUTH_REDIRECT_KEY);
    }
    return target || null;
  } catch  {
    return null;
  }
}

export const cleanJsonTheme = (payload) => {
  try {
    return JSON.stringify(JSON.parse(payload));
  } catch {
    return null;
  }
};
