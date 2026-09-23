import assert from 'node:assert/strict';
import test from 'node:test';
import { formatPublicUserProfile, verifyUserSession } from './User.js';

test('legacy profile sign-in cannot issue a token from an arbitrary profile', async () => {
  for (const payload of [{ fid: 'victim' }, {}, { fid: { $ne: null }, isAdminUser: true, generationCredits: 1e9 }]) {
    await assert.rejects(verifyUserSession(payload), (error) => error.statusCode === 410);
  }
});

test('public profiles allowlist display fields instead of exposing account metadata', () => {
  const publicFields = { fid: '123', username: 'person', displayName: 'Person', pfpUrl: 'https://example.com/photo.png', bio: 'Hello' };
  assert.deepEqual(formatPublicUserProfile({
    ...publicFields, email: 'private@example.com', password: 'hash', verificationCode: 'secret',
    stripeCustomerId: 'billing-id', generationCredits: 500, isAdminUser: true,
    custom_adapters: { api_key: 'secret' }, futurePrivateField: 'private',
  }), publicFields);
  assert.equal(formatPublicUserProfile(null), null);
});
