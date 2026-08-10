import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GOOGLE_ADMIN_ACCESS_DENIED,
  getGoogleLogin,
  requireGoogleAdminAccess,
} from './Google.js';
import { verifyGoogleOAuthState } from './GoogleOAuthState.js';

test('admin Google login intent is preserved in OAuth state', async () => {
  const previousAllowedOrigins = process.env.SAMSAR_GOOGLE_OAUTH_ALLOWED_ORIGINS;
  const previousTokenSecret = process.env.TOKEN_SECRET;
  process.env.SAMSAR_GOOGLE_OAUTH_ALLOWED_ORIGINS = 'https://admin.example.com';
  process.env.TOKEN_SECRET = 'test-only-google-login-token-secret-32-bytes';

  try {
    const loginUrl = await getGoogleLogin({
      adminLogin: 'true',
      origin: 'https://admin.example.com',
    });
    const state = new URL(loginUrl).searchParams.get('state');
    const decodedState = verifyGoogleOAuthState(state);

    assert.equal(decodedState.adminLogin, true);
    assert.equal(decodedState.origin, 'https://admin.example.com');
  } finally {
    if (previousAllowedOrigins === undefined) {
      delete process.env.SAMSAR_GOOGLE_OAUTH_ALLOWED_ORIGINS;
    } else {
      process.env.SAMSAR_GOOGLE_OAUTH_ALLOWED_ORIGINS = previousAllowedOrigins;
    }
    if (previousTokenSecret === undefined) {
      delete process.env.TOKEN_SECRET;
    } else {
      process.env.TOKEN_SECRET = previousTokenSecret;
    }
  }
});

test('admin Google login accepts only an existing admin user', () => {
  assert.doesNotThrow(() => requireGoogleAdminAccess({ isAdminUser: true }, true));

  for (const user of [null, { isAdminUser: false }, { isAdminUser: undefined }]) {
    assert.throws(
      () => requireGoogleAdminAccess(user, true),
      (error) => (
        error.code === GOOGLE_ADMIN_ACCESS_DENIED &&
        error.statusCode === 403
      ),
    );
  }
});

test('regular Google login remains available to non-admin users', () => {
  assert.doesNotThrow(() => requireGoogleAdminAccess(null, false));
  assert.doesNotThrow(() => requireGoogleAdminAccess({ isAdminUser: false }, false));
});
