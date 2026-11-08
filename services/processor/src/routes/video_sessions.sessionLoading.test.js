import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import VideoSession from '../schema/VideoSession.js';
import { generateAuthToken } from '../models/Auth.js';
import router from './video_sessions.js';
const handler = router.stack.find(layer => layer.route?.path === '/session_details').route.stack[0].handle;
const id = '507f1f77bcf86cd799439011';
function response() {
  return { code: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; }, send(data) { this.data = data; return this; } };
}
function setup(t) {
  t.mock.method(mongoose, 'connect', async () => mongoose);
  t.mock.method(console, 'error', () => {});
}
test('guest read rejection sends a 500 response instead of escaping the Express 4 handler', async t => {
  setup(t);
  t.mock.method(VideoSession, 'findOne', async () => { throw new Error('Database unavailable'); });
  const res = response();
  await handler({ headers: {}, query: { id } }, res);
  assert.equal(res.code, 500);
  assert.equal(res.data.error, 'Database unavailable');
  assert.match(res.headers['Cache-Control'], /no-store/);
});
test('missing guest session returns 404 instead of a successful empty payload', async t => {
  setup(t);
  t.mock.method(VideoSession, 'findOne', async filter => {
    assert.deepEqual(filter, { _id: id, isGuestSession: true });
    return null;
  });
  const res = response();
  await handler({ headers: {}, query: { id } }, res);
  assert.equal(res.code, 404);
});
test('malformed guest ids produce a completed 400 response', async t => {
  setup(t);
  t.mock.method(VideoSession, 'findOne', async () => { const error = new Error('Invalid id'); error.name = 'CastError'; throw error; });
  const res = response();
  await handler({ headers: {}, query: { id: '[object Object]' } }, res);
  assert.equal(res.code, 400);
});
test('owner database failures are server errors rather than legacy-fallback 400 responses', async t => {
  setup(t);
  const secret = process.env.TOKEN_SECRET;
  process.env.TOKEN_SECRET = 'session-loading-test-only-secret';
  t.after(() => secret === undefined ? delete process.env.TOKEN_SECRET : (process.env.TOKEN_SECRET = secret));
  t.mock.method(VideoSession, 'findById', () => ({ select: async () => { throw new Error('Database unavailable'); } }));
  const res = response();
  await handler({ headers: { authorization: `Bearer ${generateAuthToken('owner')}` }, query: { id } }, res);
  assert.equal(res.code, 500);
});
