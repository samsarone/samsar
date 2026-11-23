import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import VideoSession from '../schema/VideoSession.js';
import { generateAuthToken } from '../models/Auth.js';
import { normalizePostProcessingPreferences } from '../models/PostProcessingPreferences.js';
import router from './video_sessions.js';

const handler = router.stack.find((layer) => layer.route?.path === '/post_processing_preferences').route.stack[0].handle;
const sessionId = '507f1f77bcf86cd799439011';
const owner = '507f1f77bcf86cd799439022';
function response() {
  return { code: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
}
function setup(t) {
  const secret = process.env.TOKEN_SECRET;
  process.env.TOKEN_SECRET = 'post-processing-preferences-test-secret';
  t.after(() => secret === undefined ? delete process.env.TOKEN_SECRET : (process.env.TOKEN_SECRET = secret));
  t.mock.method(mongoose, 'connect', async () => mongoose);
  return { authorization: `Bearer ${generateAuthToken(owner)}` };
}

test('post-processing preferences default off and expose only the three checkbox choices', () => {
  const defaults = { translationEnableSubtitles: false, translationTranslateOutro: false, translationTranslateFooter: false };
  assert.deepEqual(normalizePostProcessingPreferences(), defaults);
  assert.deepEqual(normalizePostProcessingPreferences({ prompt: 'private', translationEnableSubtitles: 'true' }), defaults);
  assert.equal(VideoSession.schema.path('postProcessingPreferences').instance, 'Mixed');
});

test('post-processing preferences require authentication before accessing a session', async (t) => {
  setup(t);
  const write = t.mock.method(VideoSession, 'findOneAndUpdate', () => assert.fail('Unauthenticated write'));
  const res = response();
  await handler({ headers: {}, body: { sessionId, preferences: { translationTranslateOutro: true } } }, res);
  assert.equal(res.code, 401);
  assert.equal(write.mock.callCount(), 0);
});

test('preference endpoint atomically patches owner choices and returns persisted defaults', async (t) => {
  const headers = setup(t);
  const stored = {};
  const writes = [];
  t.mock.method(VideoSession, 'findOneAndUpdate', (filter, update, options) => {
    assert.deepEqual(filter, { _id: sessionId, userId: owner });
    assert.equal(options.new, true);
    assert.deepEqual(options.projection, { postProcessingPreferences: 1 });
    writes.push(update.$set);
    for (const [key, value] of Object.entries(update.$set)) stored[key.split('.')[1]] = value;
    return { lean: async () => ({ postProcessingPreferences: { ...stored } }) };
  });
  for (const preferences of [
    { translationTranslateOutro: true }, { translationTranslateFooter: true }, { translationTranslateOutro: false },
  ]) {
    const res = response();
    await handler({ headers, body: { sessionId, preferences } }, res);
    assert.equal(res.code, 200);
    assert.deepEqual(res.data, { sessionId, postProcessingPreferences: normalizePostProcessingPreferences(stored) });
    assert.equal(res.headers['Cache-Control'], 'private, no-store');
  }
  assert.deepEqual(writes, [
    { 'postProcessingPreferences.translationTranslateOutro': true },
    { 'postProcessingPreferences.translationTranslateFooter': true },
    { 'postProcessingPreferences.translationTranslateOutro': false },
  ]);
  assert.deepEqual(stored, { translationTranslateOutro: false, translationTranslateFooter: true });
});

test('preference writes cannot update another owner session', async (t) => {
  const headers = setup(t);
  t.mock.method(VideoSession, 'findOneAndUpdate', (filter) => {
    assert.deepEqual(filter, { _id: sessionId, userId: owner });
    return { lean: async () => null };
  });
  const res = response();
  await handler({ headers, body: { sessionId, preferences: { translationEnableSubtitles: true } } }, res);
  assert.equal(res.code, 404);
});

test('preference endpoint rejects unknown, nonboolean and malformed updates before any write', async (t) => {
  const headers = setup(t);
  const write = t.mock.method(VideoSession, 'findOneAndUpdate', () => assert.fail('Invalid preference write'));
  for (const preferences of [null, [], {}, { inferenceModel: 'gemini-4-carbon' },
    { translationEnableSubtitles: 'true' }, { 'translationEnableSubtitles.$ne': true },
    { translationEnableSubtitles: true, prompt: 'private' }]) {
    const res = response();
    await handler({ headers, body: { sessionId, preferences } }, res);
    assert.equal(res.code, 400);
  }
  const res = response();
  await handler({ headers, body: { sessionId: 'not-an-id', preferences: { translationEnableSubtitles: true } } }, res);
  assert.equal(res.code, 400);
  assert.equal(write.mock.callCount(), 0);
});

test('preference endpoint hides database details on server failure', async (t) => {
  const headers = setup(t);
  t.mock.method(VideoSession, 'findOneAndUpdate', () => { throw new Error('PRIVATE DATABASE URI'); });
  const res = response();
  await handler({ headers, body: { sessionId, preferences: { translationTranslateFooter: false } } }, res);
  assert.equal(res.code, 500);
  assert.equal(res.data.error, 'Unable to save post-processing preferences.');
});
