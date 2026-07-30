import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GOOGLE_ADMIN_ACCESS_DENIED,
  getGoogleLogin,
  requireGoogleAdminAccess,
} from './Google.js';

test('admin Google login intent is preserved in OAuth state', async () => {
  const loginUrl = await getGoogleLogin({
    adminLogin: 'true',
    origin: 'https://admin.example.com',
  });
  const state = new URL(loginUrl).searchParams.get('state');
  const decodedState = JSON.parse(Buffer.from(state, 'base64url').toString());

  assert.equal(decodedState.adminLogin, true);
  assert.equal(decodedState.origin, 'https://admin.example.com');
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
