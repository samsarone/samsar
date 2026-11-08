import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import User from '../schema/User.js';
import { generateAuthToken } from '../models/Auth.js';
import usersRouter from './users.js';

const handler = usersRouter.stack.find(layer => layer.route?.path === '/verify_token').route.stack[0].handle;
function response() {
  return { code: 200, headers: {}, set(headers) { Object.assign(this.headers, headers); },
    status(code) { this.code = code; return this; }, send(data) { this.data = data; return this; } };
}
function setup(t) {
  const previous = process.env.TOKEN_SECRET;
  process.env.TOKEN_SECRET = 'session-loading-test-only-token-secret-32-bytes';
  t.after(() => previous === undefined ? delete process.env.TOKEN_SECRET : (process.env.TOKEN_SECRET = previous));
  t.mock.method(mongoose, 'connect', async () => mongoose);
}
test('token bootstrap reads and normalizes the internal user once and still sanitizes the profile', async (t) => {
  setup(t);
  let saves = 0;
  const user = { _id: 'owner', password: 'hidden', authenticationKey: 'hidden',
    async save() { saves += 1; return this; } };
  const lookup = t.mock.method(User, 'findOne', async (filter) => {
    assert.equal(filter._id, 'owner'); return user;
  });
  const res = response();
  await handler({ query: {}, headers: { authorization: `Bearer ${generateAuthToken('owner')}` } }, res);
  assert.equal(res.code, 200);
  assert.equal(lookup.mock.callCount(), 1);
  assert.equal(saves, 1);
  assert.equal(res.data._id, 'owner');
  assert.equal(res.data.password, undefined);
  assert.equal(res.data.authenticationKey, undefined);
  assert.ok(res.data.selectedInferenceModel);
  assert.match(res.headers['Cache-Control'], /no-store/);
});
test('invalid tokens fail before reading user data', async (t) => {
  setup(t);
  const lookup = t.mock.method(User, 'findOne', async () => { throw new Error('Unexpected read'); });
  const res = response();
  await handler({ query: {}, headers: { authorization: 'Bearer invalid' } }, res);
  assert.equal(res.code, 400);
  assert.equal(lookup.mock.callCount(), 0);
});
