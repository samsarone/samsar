const AUTH_COOKIE_NAME = 'authToken';
const AUTH_TOKEN_KEY = 'authToken';
const COOKIE_CONSENT_KEY = 'samsar_cookie_consent';
const AUTH_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const POST_AUTH_REDIRECT_KEY = 'postAuthRedirect';
let inMemoryAuthToken = null;

const getAuthCookie = () => {
  if (typeof document === 'undefined') return null;
  const cookies = document.cookie ? document.cookie.split(';') : [];
  const prefix = `${AUTH_COOKIE_NAME}=`;

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
  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
  const domainAttr = hostname.endsWith('samsar.one') ? ' domain=.samsar.one;' : '';
  const secureAttr =
    typeof window !== 'undefined' && window.location.protocol === 'https:' ? ' Secure;' : '';
  const encodedToken = encodeURIComponent(token);

  document.cookie = `${AUTH_COOKIE_NAME}=${encodedToken}; Path=/; Max-Age=${AUTH_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax;${secureAttr}${domainAttr}`;
};

const expireAuthCookie = (domain) => {
  if (typeof document === 'undefined') return;
  const domainAttr = domain ? ` domain=${domain};` : '';
  document.cookie = `${AUTH_COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;${domainAttr}`;
};

function clearAuthCookies() {
  // Clear any legacy auth cookies that may still be present.
  if (typeof document === 'undefined') return;
  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
  const domainParts = hostname ? hostname.split('.').filter(Boolean) : [];

  const domainOptions = new Set(['']);
  if (hostname) domainOptions.add(hostname);
  if (hostname && hostname.includes('samsar.one')) domainOptions.add('.samsar.one');

  for (let i = 0; i < domainParts.length - 1; i += 1) {
    const domain = domainParts.slice(i).join('.');
    domainOptions.add(domain);
    domainOptions.add(`.${domain}`);
  }

  domainOptions.forEach(expireAuthCookie);
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
