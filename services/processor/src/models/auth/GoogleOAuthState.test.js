import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';

import {
  GOOGLE_OAUTH_FLOW,
  buildBlogGoogleOAuthHandoffRedirect,
  createBlogGoogleOAuthState,
  createClientGoogleOAuthState,
  getBlogGoogleOAuthCallbackUrl,
  resolveAllowedGoogleOAuthOrigin,
  sanitizeBlogOAuthRedirect,
  verifyGoogleOAuthState,
} from './GoogleOAuthState.js';

const TEST_SECRET = 'test-only-oauth-state-secret-with-32-characters';

function buildEnv(overrides = {}) {
  return {
    TOKEN_SECRET: TEST_SECRET,
    CLIENT_APP: 'https://app.samsar.one',
    SAMSAR_GOOGLE_OAUTH_ALLOWED_ORIGINS: 'https://admin.samsar.one,https://gallery.samsar.one',
    SAMSAR_BLOG_AUTH_CALLBACK_URL: 'https://samsar.one/blog/members/api/samsar-auth/google/verify',
    SAMSAR_BLOG_AUTH_PATH_PREFIX: '/blog',
    ...overrides,
  };
}

test('blog OAuth state is signed and binds the configured callback, nonce, and return path', () => {
  const env = buildEnv();
  const nonce = 'A'.repeat(43);
  const state = createBlogGoogleOAuthState({
    nonce,
    origin: 'https://attacker.example',
    redirect: '/blog/a-post/?from=home#comments',
    cookieConsent: 'rejected',
  }, env);

  const payload = verifyGoogleOAuthState(state, env);
  assert.equal(payload.flow, GOOGLE_OAUTH_FLOW.BLOG);
  assert.equal(payload.callbackUrl, env.SAMSAR_BLOG_AUTH_CALLBACK_URL);
  assert.equal(payload.redirect, '/blog/a-post/?from=home#comments');
  assert.equal(payload.cookieConsent, 'rejected');
  assert.match(payload.nonceHash, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(payload, 'nonce'), false);
  assert.equal(Object.hasOwn(payload, 'origin'), false);

  const encodedJwt = state.slice(state.indexOf('.') + 1);
  const decoded = jwt.decode(encodedJwt);
  assert.ok(decoded.exp > decoded.iat);
  assert.ok(decoded.jti);
});

test('tampered and unsigned OAuth states are rejected', () => {
  const env = buildEnv();
  const state = createBlogGoogleOAuthState({ nonce: 'B'.repeat(43) }, env);
  const last = state.at(-1);
  const tampered = `${state.slice(0, -1)}${last === 'a' ? 'b' : 'a'}`;

  assert.throws(() => verifyGoogleOAuthState(tampered, env), /expired, or invalid/);
  assert.throws(
    () => verifyGoogleOAuthState(Buffer.from('{"origin":"https://attacker.example"}').toString('base64url'), env),
    /missing or invalid/,
  );
});

test('blog return paths cannot escape the configured blog prefix', () => {
  const env = buildEnv();

  assert.equal(sanitizeBlogOAuthRedirect('/blog/post?x=1#heart', env), '/blog/post?x=1#heart');
  assert.equal(sanitizeBlogOAuthRedirect('/blogger/escape', env), '/blog/');
  assert.equal(sanitizeBlogOAuthRedirect('//attacker.example/blog', env), '/blog/');
  assert.equal(sanitizeBlogOAuthRedirect('/blog\\@attacker.example', env), '/blog/');
  assert.equal(sanitizeBlogOAuthRedirect(`/blog/${'x'.repeat(2048)}`, env), '/blog/');
});

test('blog callback must be explicitly configured as HTTPS, except for loopback development', () => {
  assert.equal(
    getBlogGoogleOAuthCallbackUrl(buildEnv()),
    'https://samsar.one/blog/members/api/samsar-auth/google/verify',
  );
  assert.equal(
    getBlogGoogleOAuthCallbackUrl(buildEnv({
      SAMSAR_BLOG_AUTH_CALLBACK_URL: 'http://localhost:2368/blog/members/api/samsar-auth/google/verify',
    })),
    'http://localhost:2368/blog/members/api/samsar-auth/google/verify',
  );
  assert.throws(
    () => getBlogGoogleOAuthCallbackUrl(buildEnv({
      SAMSAR_BLOG_AUTH_CALLBACK_URL: 'http://attacker.example/blog/callback',
    })),
    /must be an HTTPS URL/,
  );
});

test('successful blog callback redirect contains only the short-lived handoff code', () => {
  const redirect = new URL(buildBlogGoogleOAuthHandoffRedirect('C'.repeat(43), buildEnv()));

  assert.equal(redirect.toString(), `${buildEnv().SAMSAR_BLOG_AUTH_CALLBACK_URL}?code=${'C'.repeat(43)}`);
  assert.deepEqual([...redirect.searchParams.keys()], ['code']);
  assert.equal(redirect.searchParams.has('authToken'), false);
  assert.equal(redirect.searchParams.has('redirect'), false);
});

test('legacy client OAuth origins are signed and exactly allowlisted', () => {
  const env = buildEnv();
  const state = createClientGoogleOAuthState({
    origin: 'https://admin.samsar.one',
    adminLogin: 'true',
    redirect: '/users?sort=newest',
  }, env);
  const payload = verifyGoogleOAuthState(state, env);

  assert.equal(payload.flow, GOOGLE_OAUTH_FLOW.CLIENT);
  assert.equal(payload.origin, 'https://admin.samsar.one');
  assert.equal(payload.adminLogin, true);
  assert.equal(payload.redirect, '/users?sort=newest');
  assert.equal(resolveAllowedGoogleOAuthOrigin(undefined, env), 'https://app.samsar.one');
  assert.throws(
    () => resolveAllowedGoogleOAuthOrigin('https://attacker.example', env),
    /not allowed/,
  );
});
