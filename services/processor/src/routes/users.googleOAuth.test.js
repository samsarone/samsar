import assert from 'node:assert/strict';
import test from 'node:test';

import express from 'express';

import { GOOGLE_OAUTH_FLOW, verifyGoogleOAuthState } from '../models/auth/GoogleOAuthState.js';
import usersRouter from './users.js';

const ENV_KEYS = [
  'CLIENT_APP',
  'CURRENT_ENV',
  'SAMSAR_BLOG_AUTH_CALLBACK_URL',
  'SAMSAR_BLOG_AUTH_PATH_PREFIX',
  'SAMSAR_DEPLOYMENT_EDITION',
  'SAMSAR_GOOGLE_OAUTH_ALLOWED_ORIGINS',
  'SAMSAR_OAUTH_STATE_SECRET',
];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function withUsersServer(callback) {
  const app = express();
  app.use(express.json());
  app.use('/users', usersRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    return await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function configureOAuthEnv() {
  process.env.CURRENT_ENV = 'production';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'production';
  process.env.CLIENT_APP = 'https://app.samsar.one';
  process.env.SAMSAR_GOOGLE_OAUTH_ALLOWED_ORIGINS = 'https://admin.samsar.one';
  process.env.SAMSAR_BLOG_AUTH_CALLBACK_URL = 'https://samsar.one/blog/members/api/samsar-auth/google/verify';
  process.env.SAMSAR_BLOG_AUTH_PATH_PREFIX = '/blog';
  process.env.SAMSAR_OAUTH_STATE_SECRET = 'route-test-oauth-state-secret-with-32-characters';
}

test.afterEach(restoreEnv);

test('blog login start returns a Google URL with signed fixed-callback state', async () => {
  configureOAuthEnv();

  await withUsersServer(async (baseUrl) => {
    const params = new URLSearchParams({
      flow: 'blog',
      nonce: 'R'.repeat(43),
      origin: 'https://attacker.example',
      redirect: '/blog/article/?from=home#comments',
    });
    const response = await fetch(`${baseUrl}/users/google_login?${params}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');

    const { loginUrl } = await response.json();
    const state = new URL(loginUrl).searchParams.get('state');
    const payload = verifyGoogleOAuthState(state);
    assert.equal(payload.flow, GOOGLE_OAUTH_FLOW.BLOG);
    assert.equal(payload.callbackUrl, process.env.SAMSAR_BLOG_AUTH_CALLBACK_URL);
    assert.equal(payload.redirect, '/blog/article/?from=home#comments');
    assert.equal(Object.hasOwn(payload, 'origin'), false);
  });
});

test('blog login start rejects a missing browser nonce', async () => {
  configureOAuthEnv();

  await withUsersServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/users/google_login?flow=blog&redirect=%2Fblog%2F`);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /nonce/i);
  });
});

test('legacy Google login rejects an origin outside the explicit allowlist', async () => {
  configureOAuthEnv();

  await withUsersServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/users/google_login?origin=https%3A%2F%2Fattacker.example`);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /not allowed/i);
  });
});
