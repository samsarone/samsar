import { createHash, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { normalizeNewsletterPreference } from '../Newsletter.js';
import { getTokenSecret, validateRuntimeSecret } from '../../utils/RuntimeSecrets.js';

const STATE_PREFIX = 'samsar_oauth_v1.';
const STATE_ISSUER = 'samsar-processor';
const STATE_AUDIENCE = 'samsar-google-oauth';
const DEFAULT_STATE_TTL_SECONDS = 10 * 60;
const DEFAULT_CLIENT_ORIGIN = 'https://app.samsar.one';
const DEFAULT_BLOG_PATH_PREFIX = '/blog';
const MAX_REDIRECT_LENGTH = 2048;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export const GOOGLE_OAUTH_FLOW = Object.freeze({
  BLOG: 'blog',
  CLIENT: 'client',
});

export class GoogleOAuthStateError extends Error {
  constructor(message, { code = 'INVALID_GOOGLE_OAUTH_STATE', status = 400 } = {}) {
    super(message);
    this.name = 'GoogleOAuthStateError';
    this.code = code;
    this.status = status;
    this.statusCode = status;
  }
}

function configurationError(message) {
  return new GoogleOAuthStateError(message, {
    code: 'GOOGLE_OAUTH_CONFIGURATION_ERROR',
    status: 500,
  });
}

function getPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getStateSecret(env = process.env) {
  try {
    if (env.SAMSAR_OAUTH_STATE_SECRET) {
      return validateRuntimeSecret(
        'SAMSAR_OAUTH_STATE_SECRET',
        env.SAMSAR_OAUTH_STATE_SECRET,
      );
    }

    return getTokenSecret(env);
  } catch (error) {
    throw configurationError(error.message);
  }
}

function parseHttpUrl(value, label, { allowLoopbackHttp = false } = {}) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch (_) {
    throw configurationError(`${label} must be a valid absolute URL.`);
  }

  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  const allowedProtocol = parsed.protocol === 'https:' || (allowLoopbackHttp && loopback && parsed.protocol === 'http:');
  if (
    !allowedProtocol ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw configurationError(`${label} must be an HTTPS URL without credentials, query parameters, or a fragment.`);
  }

  return parsed;
}

function normalizeOrigin(value, label = 'Google OAuth origin', { configuration = false } = {}) {
  let parsed;
  try {
    parsed = parseHttpUrl(value, label, { allowLoopbackHttp: true });
  } catch (error) {
    if (configuration) throw error;
    throw new GoogleOAuthStateError(`${label} is invalid or is not allowed.`, {
      code: 'GOOGLE_OAUTH_ORIGIN_NOT_ALLOWED',
    });
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    const error = `${label} must contain only a URL origin.`;
    if (configuration) throw configurationError(error);
    throw new GoogleOAuthStateError(error, { code: 'GOOGLE_OAUTH_ORIGIN_NOT_ALLOWED' });
  }
  return parsed.origin;
}

function getConfiguredClientOrigin(env = process.env) {
  const value = typeof env.CLIENT_APP === 'string' && env.CLIENT_APP.trim()
    ? env.CLIENT_APP.trim()
    : DEFAULT_CLIENT_ORIGIN;
  return normalizeOrigin(value, 'CLIENT_APP', { configuration: true });
}

export function getAllowedGoogleOAuthOrigins(env = process.env) {
  const origins = new Set([getConfiguredClientOrigin(env)]);
  const configured = typeof env.SAMSAR_GOOGLE_OAUTH_ALLOWED_ORIGINS === 'string'
    ? env.SAMSAR_GOOGLE_OAUTH_ALLOWED_ORIGINS.split(',')
    : [];

  for (const candidate of configured) {
    if (!candidate.trim()) continue;
    origins.add(normalizeOrigin(candidate.trim(), 'SAMSAR_GOOGLE_OAUTH_ALLOWED_ORIGINS', {
      configuration: true,
    }));
  }
  return origins;
}

export function resolveAllowedGoogleOAuthOrigin(value, env = process.env) {
  const fallback = getConfiguredClientOrigin(env);
  const requested = typeof value === 'string' && value.trim()
    ? normalizeOrigin(value.trim())
    : fallback;

  if (!getAllowedGoogleOAuthOrigins(env).has(requested)) {
    throw new GoogleOAuthStateError('The requested Google OAuth origin is not allowed.', {
      code: 'GOOGLE_OAUTH_ORIGIN_NOT_ALLOWED',
    });
  }
  return requested;
}

export function getBlogGoogleOAuthCallbackUrl(env = process.env) {
  const value = typeof env.SAMSAR_BLOG_AUTH_CALLBACK_URL === 'string'
    ? env.SAMSAR_BLOG_AUTH_CALLBACK_URL.trim()
    : '';
  if (!value) {
    throw configurationError('SAMSAR_BLOG_AUTH_CALLBACK_URL is required for blog Google login.');
  }

  const parsed = parseHttpUrl(value, 'SAMSAR_BLOG_AUTH_CALLBACK_URL', { allowLoopbackHttp: true });
  if (parsed.pathname === '/' || parsed.pathname.endsWith('/')) {
    throw configurationError('SAMSAR_BLOG_AUTH_CALLBACK_URL must include the exact callback path without a trailing slash.');
  }
  return parsed.toString();
}

export function buildBlogGoogleOAuthHandoffRedirect(code, env = process.env) {
  const normalizedCode = typeof code === 'string' ? code.trim() : '';
  if (!NONCE_PATTERN.test(normalizedCode)) {
    throw new GoogleOAuthStateError('Google OAuth handoff code is invalid.');
  }
  const callbackUrl = new URL(getBlogGoogleOAuthCallbackUrl(env));
  callbackUrl.searchParams.set('code', normalizedCode);
  return callbackUrl.toString();
}

function getBlogPathPrefix(env = process.env) {
  const configured = typeof env.SAMSAR_BLOG_AUTH_PATH_PREFIX === 'string'
    ? env.SAMSAR_BLOG_AUTH_PATH_PREFIX.trim()
    : '';
  const prefix = configured || DEFAULT_BLOG_PATH_PREFIX;
  if (!prefix.startsWith('/') || prefix.startsWith('//') || prefix.includes('\\') || /[?#]/.test(prefix)) {
    throw configurationError('SAMSAR_BLOG_AUTH_PATH_PREFIX must be an absolute path prefix.');
  }
  return prefix.replace(/\/+$/, '') || '/';
}

export function sanitizeBlogOAuthRedirect(value, env = process.env) {
  const prefix = getBlogPathPrefix(env);
  const fallback = prefix === '/' ? '/' : `${prefix}/`;
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }

  const candidate = value.trim();
  if (
    candidate.length > MAX_REDIRECT_LENGTH ||
    !candidate.startsWith('/') ||
    candidate.startsWith('//') ||
    candidate.includes('\\')
  ) {
    return fallback;
  }

  const callbackUrl = new URL(getBlogGoogleOAuthCallbackUrl(env));
  let parsed;
  try {
    parsed = new URL(candidate, callbackUrl.origin);
  } catch (_) {
    return fallback;
  }

  const withinPrefix = prefix === '/'
    ? true
    : parsed.pathname === prefix || parsed.pathname.startsWith(`${prefix}/`);
  if (parsed.origin !== callbackUrl.origin || !withinPrefix) {
    return fallback;
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function validateBlogOAuthNonce(value) {
  const nonce = typeof value === 'string' ? value.trim() : '';
  if (!NONCE_PATTERN.test(nonce)) {
    throw new GoogleOAuthStateError('A valid browser-bound OAuth nonce is required.', {
      code: 'INVALID_GOOGLE_OAUTH_NONCE',
    });
  }
  return nonce;
}

export function hashGoogleOAuthValue(value) {
  return createHash('sha256').update(value).digest('hex');
}

function signState(payload, env = process.env) {
  const ttlSeconds = getPositiveInteger(
    env.SAMSAR_GOOGLE_OAUTH_STATE_TTL_SECONDS,
    DEFAULT_STATE_TTL_SECONDS,
  );
  const token = jwt.sign(payload, getStateSecret(env), {
    algorithm: 'HS256',
    audience: STATE_AUDIENCE,
    issuer: STATE_ISSUER,
    jwtid: randomUUID(),
    expiresIn: ttlSeconds,
  });
  return `${STATE_PREFIX}${token}`;
}

export function isSignedGoogleOAuthState(value) {
  return typeof value === 'string' && value.startsWith(STATE_PREFIX);
}

export function createClientGoogleOAuthState(params = {}, env = process.env) {
  const origin = resolveAllowedGoogleOAuthOrigin(params.origin, env);
  const state = {
    type: 'google_oauth_state',
    flow: GOOGLE_OAUTH_FLOW.CLIENT,
    origin,
    cookieConsent: params.cookieConsent === 'rejected' ? 'rejected' : 'accepted',
  };

  if (params.adminLogin === true || params.adminLogin === 'true') {
    state.adminLogin = true;
  }
  if (
    typeof params.redirect === 'string' &&
    params.redirect.length <= MAX_REDIRECT_LENGTH &&
    params.redirect.startsWith('/') &&
    !params.redirect.startsWith('//') &&
    !params.redirect.includes('\\')
  ) {
    state.redirect = params.redirect;
  }

  const newsletterPreference = params.subscribeToWeeklyNewsletter ?? params.subscribeToNewsletter;
  if (newsletterPreference !== undefined) {
    state.subscribeToWeeklyNewsletter = normalizeNewsletterPreference(newsletterPreference, false);
  }
  return signState(state, env);
}

export function createBlogGoogleOAuthState(params = {}, env = process.env) {
  const nonce = validateBlogOAuthNonce(params.nonce);
  const state = {
    type: 'google_oauth_state',
    flow: GOOGLE_OAUTH_FLOW.BLOG,
    callbackUrl: getBlogGoogleOAuthCallbackUrl(env),
    nonceHash: hashGoogleOAuthValue(nonce),
    redirect: sanitizeBlogOAuthRedirect(params.redirect, env),
    cookieConsent: params.cookieConsent === 'rejected' ? 'rejected' : 'accepted',
    subscribeToWeeklyNewsletter: normalizeNewsletterPreference(
      params.subscribeToWeeklyNewsletter ?? params.subscribeToNewsletter,
      false,
    ),
  };
  return signState(state, env);
}

export function verifyGoogleOAuthState(value, env = process.env) {
  if (!isSignedGoogleOAuthState(value)) {
    throw new GoogleOAuthStateError('Google OAuth state is missing or invalid.');
  }

  let payload;
  try {
    payload = jwt.verify(value.slice(STATE_PREFIX.length), getStateSecret(env), {
      algorithms: ['HS256'],
      audience: STATE_AUDIENCE,
      issuer: STATE_ISSUER,
    });
  } catch (_) {
    throw new GoogleOAuthStateError('Google OAuth state is missing, expired, or invalid.');
  }

  if (payload?.type !== 'google_oauth_state') {
    throw new GoogleOAuthStateError('Google OAuth state has an invalid purpose.');
  }

  if (payload.flow === GOOGLE_OAUTH_FLOW.BLOG) {
    if (
      payload.callbackUrl !== getBlogGoogleOAuthCallbackUrl(env) ||
      typeof payload.nonceHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(payload.nonceHash)
    ) {
      throw new GoogleOAuthStateError('Google OAuth blog state is invalid.');
    }
    return {
      ...payload,
      redirect: sanitizeBlogOAuthRedirect(payload.redirect, env),
    };
  }

  if (payload.flow === GOOGLE_OAUTH_FLOW.CLIENT) {
    return {
      ...payload,
      origin: resolveAllowedGoogleOAuthOrigin(payload.origin, env),
    };
  }

  throw new GoogleOAuthStateError('Google OAuth state has an unsupported flow.');
}

export const _test = {
  DEFAULT_STATE_TTL_SECONDS,
  NONCE_PATTERN,
  STATE_PREFIX,
};
