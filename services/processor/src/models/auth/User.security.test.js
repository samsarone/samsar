import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import bcrypt from 'bcrypt';
import dayjs from 'dayjs';
import validator from 'validator';

// Execute the complete auth module with inert persistence and mail boundaries.
// No test imports the application environment, connects to Mongo, or sends mail.
const source = fs.readFileSync(new URL('./User.js', import.meta.url), 'utf8')
  .replace(/^import\s[\s\S]*?;\s*$/gm, '')
  .replace(/export /g, '');

function loadAuth({ user = null, registrationEnabled = true } = {}) {
  const state = { user, mails: [], writes: [], hashes: [] };
  function matches(filter) {
    return state.user && state.user.email === filter.email &&
      state.user.verificationCode === filter.verificationCode &&
      state.user.verificationCodeExpiresAt > filter.verificationCodeExpiresAt.$gt;
  }
  class User {
    constructor(data) { Object.assign(this, data, { _id: 'new-user' }); }
    async save() { state.user = this; return this; }
    static async findOne() { return state.user; }
    static async exists(filter) { return matches(filter) ? { _id: 'user' } : null; }
    static async updateOne(filter, update) {
      if (!matches(filter)) return { modifiedCount: 0 };
      state.writes.push(update);
      Object.assign(state.user, update.$set);
      return { modifiedCount: 1 };
    }
  }
  const context = vm.createContext({
    User, dayjs, validator,
    bcrypt: { compare: bcrypt.compare, hash: async (password, rounds) => {
      state.hashes.push(password);
      if (state.beforeHash) await state.beforeHash();
      return bcrypt.hash(password, rounds);
    } },
    getDBConnectionString: async () => {},
    hat: () => 'random-code-delivered-only-by-email',
    sendWelcomeEmail: async () => {},
    sendForgotPasswordEmailMailer: async (...args) => state.mails.push(args),
    generateAuthToken: () => 'verified-auth-token',
    formatUserClientProfile: (profile) => ({ email: profile.email }),
    isSupportedLanguage: () => true,
    normalizeNewsletterPreference: () => false,
    isPublicRegistrationEnabled: () => registrationEnabled,
    console,
  });
  return { state, ...vm.runInContext(`${source}\n;({ sendForgotPasswordEmail, resetUserPassword, registerUserByEmail, loginUserByEmail, updateUserPassword });`, context) };
}

test('password reset responses never disclose the saved account or reset token', async () => {
  const user = { email: 'person@example.com', username: 'person', password: 'private-hash', userApiKeys: ['private-key'], async save() {} };
  const auth = loadAuth({ user });
  const response = await auth.sendForgotPasswordEmail({ email: ' Person@Example.com ' });
  assert.deepEqual(Object.keys(response), ['message']);
  assert.equal(JSON.stringify(response).includes(user.verificationCode), false);
  assert.equal(auth.state.mails.length, 1);
  assert.equal(auth.state.mails[0][1], user.verificationCode);
  const unknown = await loadAuth().sendForgotPasswordEmail({ email: 'unknown@example.com' });
  assert.equal(JSON.stringify(unknown), JSON.stringify(response));
});

test('one reset code can change a password only once under concurrent submissions', async () => {
  const auth = loadAuth({ user: {
    email: 'person@example.com', verificationCode: 'secret-reset-code',
    verificationCodeExpiresAt: new Date(Date.now() + 60_000),
  } });
  const payload = { email: ' PERSON@example.com ', code: 'secret-reset-code', password: ' keep spaces ' };
  const results = await Promise.allSettled([auth.resetUserPassword(payload), auth.resetUserPassword(payload)]);
  assert.equal(results.filter((entry) => entry.status === 'fulfilled').length, 1);
  assert.equal(auth.state.writes.length, 1);
  assert.equal(auth.state.user.verificationCode, null);
  assert.equal(await bcrypt.compare(payload.password, auth.state.user.password), true);
  await assert.rejects(auth.resetUserPassword(payload), /Invalid or expired/);
});

test('expired, missing, and object-shaped reset codes cannot change a password', async () => {
  for (const expiry of [undefined, new Date(Date.now() - 1)]) {
    const auth = loadAuth({ user: { email: 'person@example.com', verificationCode: 'code', verificationCodeExpiresAt: expiry } });
    await assert.rejects(auth.resetUserPassword({ email: 'person@example.com', code: 'code', password: 'new password' }), /Invalid or expired/);
    assert.equal(auth.state.hashes.length, 0);
  }
  const auth = loadAuth();
  await assert.rejects(auth.resetUserPassword({ email: 'person@example.com', code: { $ne: null }, password: 'new password' }), /Invalid or expired/);
  await assert.rejects(auth.sendForgotPasswordEmail({ email: { $ne: null } }), /Email is required/);
});

test('a newer reset request invalidates an older submission while hashing is in progress', async () => {
  const auth = loadAuth({ user: {
    email: 'person@example.com', verificationCode: 'old-code',
    verificationCodeExpiresAt: new Date(Date.now() + 60_000), password: 'original-hash',
  } });
  auth.state.beforeHash = () => { auth.state.user.verificationCode = 'new-code'; };
  await assert.rejects(auth.resetUserPassword({ email: 'person@example.com', code: 'old-code', password: 'new password' }), /Invalid or expired/);
  assert.equal(auth.state.user.password, 'original-hash');
  assert.equal(auth.state.user.verificationCode, 'new-code');
  assert.equal(auth.state.writes.length, 0);
});

test('registration preserves password whitespace and the password works for login', async () => {
  const auth = loadAuth();
  const payload = { email: 'person@samsar.one', username: 'person', password: ' keep spaces ' };
  await auth.registerUserByEmail(payload);
  assert.equal(auth.state.hashes[0], payload.password);
  await auth.loginUserByEmail(payload);
  await assert.rejects(auth.loginUserByEmail({ ...payload, password: payload.password.trim() }), /Invalid email or password/);
});

test('standalone registration stays disabled', async () => {
  const auth = loadAuth({ registrationEnabled: false });
  await assert.rejects(auth.registerUserByEmail({}), (error) => error.statusCode === 403);
  assert.equal(auth.state.hashes.length, 0);
});

test('password changes hash only the new password and reject blank input', async () => {
  const user = { password: await bcrypt.hash('current password', 10), async save() {} };
  const auth = loadAuth({ user });
  await auth.updateUserPassword('user', { currentPassword: 'current password', newPassword: ' new password ' });
  assert.deepEqual(auth.state.hashes, [' new password ']);
  assert.equal(await bcrypt.compare(' new password ', user.password), true);
  await assert.rejects(auth.updateUserPassword('user', { currentPassword: 'current', newPassword: '  ' }), /required/);
});
