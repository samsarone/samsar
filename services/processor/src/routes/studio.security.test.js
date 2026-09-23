import assert from 'node:assert/strict';
import test from 'node:test';
import videoRouter from './video_sessions.js';
import imageRouter from './image_sessions.js';
import usersRouter from './users.js';
import mongoose from 'mongoose';
import VideoSession from '../schema/VideoSession.js';
import { generateAuthToken } from '../models/Auth.js';

function handler(router, path, method) {
  return router.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]).route.stack[0].handle;
}

function response() {
  return { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; },
    set(headers) { Object.assign(this.headers, headers); return this; },
    send(body) { this.body = body; return this; }, json(body) { this.body = body; return this; } };
}

test('all private generation/edit polling routes reject requests without authentication', async () => {
  for (const router of [videoRouter, imageRouter]) {
    for (const path of ['/generate_status', '/edit_status']) {
      const res = response();
      await handler(router, path, 'get')({ headers: {}, query: { id: 'private-session', layerId: 'private-layer' } }, res);
      assert.equal(res.statusCode, 401, path);
    }
  }
  for (const [path, method] of [['/generate_mask_status', 'get'], ['/segmentation_image', 'post']]) {
    const res = response();
    await handler(videoRouter, path, method)({ headers: {}, query: {}, body: {} }, res);
    assert.equal(res.statusCode, 401, path);
  }
});

test('legacy profile sign-in responds Gone with no token and no caching', async () => {
  const res = response();
  await handler(usersRouter, '/verify', 'post')({ body: { fid: 'victim', isAdminUser: true } }, res);
  assert.equal(res.statusCode, 410);
  assert.equal(res.body.authToken, undefined);
  assert.match(res.headers['Cache-Control'], /no-store/);
});

test('legacy frame mutation routes reject another account before accessing frame data', async (t) => {
  t.mock.method(mongoose, 'connect', async () => mongoose);
  t.mock.method(VideoSession, 'findById', async (id) => ({ userId: id === 'own-project' ? 'stranger' : 'owner' }));
  t.mock.method(VideoSession, 'findOne', () => { throw new Error('Unauthorized frame data lookup'); });
  const previousSecret = process.env.TOKEN_SECRET;
  process.env.TOKEN_SECRET = 'test-only-source-route-signing-secret-32-characters';
  t.after(() => {
    if (previousSecret === undefined) delete process.env.TOKEN_SECRET;
    else process.env.TOKEN_SECRET = previousSecret;
  });
  const headers = { authorization: `Bearer ${generateAuthToken('stranger')}` };
  for (const path of ['/refresh_session_layers', '/update_pending_session_frames', '/update_layer_frames']) {
    const res = response();
    await handler(videoRouter, path, 'post')({ headers, body: { id: 'private-project', sessionId: 'private-project' } }, res);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(VideoSession.findOne.mock.callCount(), 0);
  for (const path of ['/refresh_session_layers', '/update_pending_session_frames']) {
    const res = response();
    await handler(videoRouter, path, 'post')({ headers, body: { id: 'private-project', sessionId: 'own-project' } }, res);
    assert.equal(res.statusCode, 400, 'a second ID cannot authorize a different target');
  }
  assert.equal(VideoSession.findOne.mock.callCount(), 0);
});
