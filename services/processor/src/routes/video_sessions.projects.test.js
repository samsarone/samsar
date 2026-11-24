import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import mongoose from 'mongoose';
import { generateAuthToken } from '../models/Auth.js';
import { createNewBlankQuickSession } from '../models/QuickSession.js';
import VideoSession from '../schema/VideoSession.js';
import videoRouter from './video_sessions.js';
import vidgenieRouter from './vidgpt.js';

const owner = new mongoose.Types.ObjectId().toString();

async function call(router, path, { headers = {}, body = {}, query = {} } = {}) {
  const handler = router.stack.find(layer => layer.route?.path === path).route.stack[0].handle;
  const res = {
    code: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; },
    send(data) { this.data = data; return this; }, json(data) { this.data = data; return this; },
  };
  await handler({ headers, body, query }, res);
  return res;
}

test('listing projects requires authentication', async () => {
  assert.equal((await call(videoRouter, '/list')).code, 401);
});

const mongoUri = process.env.PROJECT_LIST_TEST_MONGO_URL;
test('Projects lists editor drafts and submitted videos before scene preparation with accurate filters and counts', {
  skip: !mongoUri && 'Set PROJECT_LIST_TEST_MONGO_URL to run with MongoDB',
}, async (t) => {
  await mongoose.connect(mongoUri, { dbName: `samsar_project_list_test_${randomUUID().replaceAll('-', '')}` });
  t.after(async () => {
    try { await mongoose.connection.dropDatabase(); } finally { await mongoose.disconnect(); }
  });
  const secret = process.env.TOKEN_SECRET;
  process.env.TOKEN_SECRET = randomUUID();
  t.after(() => secret === undefined ? delete process.env.TOKEN_SECRET : (process.env.TOKEN_SECRET = secret));
  const headers = { authorization: `Bearer ${generateAuthToken(owner)}` };
  const list = async (query = {}) => {
    const res = await call(videoRouter, '/list', { headers, query: { limit: 40, ...query } });
    assert.equal(res.code, 200);
    assert.equal(res.headers['Cache-Control'], 'private, no-store');
    return res.data;
  };
  const studio = await call(videoRouter, '/create_video_session', { headers, body: { prompts: [] } });
  assert.equal(studio.code, 200);
  const vidgenie = await call(vidgenieRouter, '/create_blank', { headers });
  const signup = await call(videoRouter, '/create_signup_project', { headers, body: { editor: 'vidgenie' } });
  await createNewBlankQuickSession(owner); // An internal helper shell is not an editor draft.
  const drafts = await list();
  assert.equal(drafts.total, 3);
  for (const [id, editor, count] of [
    [studio.data._id.toString(), 'studio', 1], [vidgenie.data.sessionId, 'vidgenie', 0], [signup.data.sessionId, 'vidgenie', 0],
  ]) {
    const row = drafts.data.find(project => String(project.id) === id);
    assert.equal(row.projectEditor, editor);
    assert.equal(row.layerCount, count);
    assert.equal(row.isListedProject, true);
    assert.equal(row.renderStatus, null);
    assert.equal(row.name, null);
  }

  const insert = async fields => (await VideoSession.collection.insertOne({
    userId: owner, sessionType: 'video', layers: [], createdAt: new Date(), ...fields,
  })).insertedId.toString();
  const step = { isStepVideoGeneration: true, isExpressGeneration: true, expressGenerationPending: true,
    expressStepGeneration: { routeType: 'text_to_video' } };
  const builder = { expressGenerationBuilder: { routeType: 'image_list_to_video', status: 'QUEUED', queuedAt: new Date() } };
  const started = await insert({ ...step, aspectRatio: '9:16', inputPrompt: '  A night\ntrain  across the mountains  ' });
  const queued = await insert({ ...builder, layers: null, videoGenerationPending: true, sessionName: 'Named render', inputPrompt: 'Other text' });
  const exported = await insert({ renderRequestedAt: new Date(), videoGenerationPending: true, layers: [{}] });
  const approved = await insert({ ...step, expressStepGeneration: { routeType: 'image_to_video', nextStep: 'ai_video_generation', requiresUserAction: true } });
  const composed = await insert({ layers: [{}, {}], videoLink: 'render.mp4', ispublishedVideo: true });
  const imported = await insert({ ...step, userId: 'source-owner', editableShareEnabled: true, editableShareImportedUserIds: [owner], inputPrompt: 'Owner-only prompt' });

  for (const fields of [
    { layers: [{}] }, { isExpressGeneration: true, expressGenerationPending: true, expressGenerationType: 'TEXT_TO_VIDEO' },
    { ...step, expressStepGeneration: { routeType: 'lip_sync' }, layers: [{}] },
    { ...step, isExternalVideoGeneration: true }, { ...step, externalRequestUserId: 'partner' },
    { ...step, isExternalUserRequest: true }, { ...step, isGuestSession: true },
    { ...step, userId: 'another-owner' }, { ...step, sessionType: 'image' }, { ...step, sessionType: null },
    { ...step, userId: 'source-owner', editableShareEnabled: false, editableShareImportedUserIds: [owner] },
  ]) await insert(fields);
  const projects = await list();
  assert.equal(projects.total, 9);
  assert.equal(projects.data.length, 9);
  const byId = new Map(projects.data.map(row => [String(row.id), row]));
  for (const id of [started, queued, exported]) assert.equal(byId.get(id).renderStatus, 'pending');
  assert.equal(byId.get(queued).layerCount, 0);
  assert.equal(byId.get(approved).renderStatus, 'paused');
  assert.equal(byId.get(imported).isImportedSession, true);
  assert.equal(byId.get(imported).name, null);
  assert.equal(byId.get(started).name, 'A night train across the mountains');
  assert.equal(byId.get(queued).name, 'Named render');
  assert.equal(byId.get(composed).renderStatus, 'completed');
  assert.deepEqual((await list({ aspectRatio: '9:16' })).data.map(row => String(row.id)), [started]);
  assert.deepEqual((await list({ publishedStatus: 'Published', renderType: 'Rendered' })).data.map(row => String(row.id)), [composed]);
  assert.equal((await list({ renderType: 'Pending' })).total, 8);
  const page = await list({ page: 2, limit: 4 });
  assert.equal(page.totalPages, 3);
  assert.deepEqual(page.data.map(row => row.id), projects.data.slice(4, 8).map(row => row.id));
});
