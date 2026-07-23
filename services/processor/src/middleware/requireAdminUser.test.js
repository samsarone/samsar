import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequireAdminUser, getBearerToken } from './requireAdminUser.js';

function createResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

test('getBearerToken accepts a bearer token and rejects other schemes', () => {
  assert.equal(getBearerToken({ headers: { authorization: 'Bearer admin-token' } }), 'admin-token');
  assert.equal(getBearerToken({ headers: { authorization: 'Basic abc123' } }), null);
  assert.equal(getBearerToken({ headers: {} }), null);
});

test('requireAdminUser rejects requests without an auth token', async () => {
  const middleware = createRequireAdminUser({ verifyToken: async () => null });
  const response = createResponse();
  let calledNext = false;

  await middleware({ headers: {} }, response, () => {
    calledNext = true;
  });

  assert.equal(response.statusCode, 401);
  assert.equal(calledNext, false);
});

test('requireAdminUser rejects authenticated non-admin users', async () => {
  const middleware = createRequireAdminUser({
    verifyToken: async () => ({ _id: 'user-id', isAdminUser: false }),
  });
  const request = { headers: { authorization: 'Bearer user-token' } };
  const response = createResponse();
  let calledNext = false;

  await middleware(request, response, () => {
    calledNext = true;
  });

  assert.equal(response.statusCode, 403);
  assert.equal(calledNext, false);
});

test('requireAdminUser attaches an authenticated admin and continues', async () => {
  const adminUser = { _id: 'admin-id', isAdminUser: true };
  const middleware = createRequireAdminUser({ verifyToken: async () => adminUser });
  const request = { headers: { authorization: 'Bearer admin-token' } };
  const response = createResponse();
  let calledNext = false;

  await middleware(request, response, () => {
    calledNext = true;
  });

  assert.equal(response.statusCode, 200);
  assert.equal(request.adminUser, adminUser);
  assert.equal(calledNext, true);
});

test('requireAdminUser treats invalid or expired tokens as unauthorized', async () => {
  const middleware = createRequireAdminUser({
    verifyToken: async () => {
      throw new Error('jwt expired');
    },
  });
  const response = createResponse();

  await middleware(
    { headers: { authorization: 'Bearer expired-token' } },
    response,
    () => assert.fail('next should not be called')
  );

  assert.equal(response.statusCode, 401);
});
