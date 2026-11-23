import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import mongoose from 'mongoose';
import { generateAuthToken } from '../models/Auth.js';
import VideoSession from '../schema/VideoSession.js';
import VideoGeneration from '../schema/VideoGeneration.js';
import User from '../schema/User.js';
import FrameGeneration from '../schema/FrameGeneration.js';
import AudioGeneration from '../schema/AudioGeneration.js';
import { setSessionQuickGenerationPending, markQuickPreparationFailed } from '../models/QuickSession.js';
import router from './video_sessions.js';

const handler = router.stack.find(layer => layer.route?.path === '/latest_render').route.stack[0].handle;
const owner = '507f1f77bcf86cd799439022';
const id = '507f1f77bcf86cd799439011';

function authenticate(t) {
  const previous = process.env.TOKEN_SECRET;
  process.env.TOKEN_SECRET = 'latest-render-lookup-test-only-secret';
  t.after(() => previous === undefined ? delete process.env.TOKEN_SECRET : (process.env.TOKEN_SECRET = previous));
  t.mock.method(mongoose, 'connect', async () => mongoose);
  return { authorization: `Bearer ${generateAuthToken(owner)}` };
}

async function request(headers = {}) {
  const res = {
    code: 200, headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; },
    json(data) { this.data = data; return this; },
  };
  await handler({ headers, query: { userId: 'another-account' } }, res);
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
  return res;
}

test('latest render requires authentication before looking up any sessions', async (t) => {
  authenticate(t);
  const query = t.mock.method(VideoSession, 'aggregate', () => assert.fail('Unauthorized query'));
  assert.equal((await request()).code, 401);
  assert.equal(query.mock.callCount(), 0);
});

test('latest render exposes only session ID and the current render state', async (t) => {
  const headers = authenticate(t);
  let session;
  t.mock.method(VideoSession, 'aggregate', async ([{ $match }]) => {
    assert.equal($match.userId, owner);
    return session ? [{ _id: id, ...session }] : [];
  });
  assert.equal((await request(headers)).data, null);
  for (const [record, status] of [
    [{ videoGenerationPending: true }, 'pending'],
    [{ expressGenerationPending: true, expressGenerationBuilder: { status: 'COMPLETED' } }, 'pending'],
    [{ expressGenerationPending: false, videoGenerationPending: false, expressGenerationStatus: { status: 'QUEUED' } }, 'pending'],
    [{ expressGenerationPending: true, expressGenerationFailed: true }, 'failed'],
    [{ expressGenerationPaused: true }, 'paused'],
    [{ expressGenerationCancelled: true, hasError: true }, 'cancelled'],
    [{ expressGenerationStatus: { status: 'FAILED' } }, 'failed'],
    [{ hasOutput: true, expressGenerationPending: true }, 'completed'],
    [{ hasOutput: true, postProcessingPreparationPending: true }, 'pending'],
    [{ videoGenerationPending: true, expressGenerationFailed: false,
      expressGenerationStatus: { video_generation: 'FAILED' } }, 'pending'],
    [{ videoGenerationPending: true, hasOutput: true, expressGenerationStatus: { video_generation: 'COMPLETED' } }, 'pending'],
    [{ expressStepGeneration: { status: 'COMPLETED', nextStep: 'image_generation', requiresUserAction: true } }, 'paused'],
    [{ expressStepGeneration: { next_step: 'audio_generation', waiting_for_process_next: true } }, 'paused'],
    [{ expressGenerationPending: false, videoGenerationPending: false }, 'cancelled'],
    [{ branches: [{ video: 'COMPLETED', hasOutput: true }, { video: 'RUNNING' }], hasOutput: true }, 'pending'],
    [{ branches: [{ video: 'COMPLETED', hasOutput: true }] }, 'completed'],
  ]) {
    session = record;
    const res = await request(headers);
    assert.equal(res.code, 200);
    assert.deepEqual(res.data, { sessionId: id, status });
  }
});

test('accepted Quick renders enter preparation before their worker jobs, and failures apply to that submission only', async (t) => {
  authenticate(t);
  t.mock.method(VideoSession, 'findOne', async () => ({ userId: owner, expressGenerationPending: true }));
  t.mock.method(User, 'findById', async () => ({ autoRechargeEnabled: false }));
  t.mock.method(User, 'updateOne', async () => ({ modifiedCount: 1 }));
  for (const model of [VideoGeneration, FrameGeneration, AudioGeneration]) t.mock.method(model, 'deleteMany', async () => ({}));
  const writes = t.mock.method(VideoSession, 'updateOne', async () => ({ matchedCount: 1 }));
  const payload = { sessionId: id, imageModel: 'GPTIMAGE2.5', aspectRatio: '1:1', lineItems: ['a landscape'] };
  const requestedAt = await setSessionQuickGenerationPending(owner, payload, { awaitingPreparation: true });
  const [, accepted] = writes.mock.calls[0].arguments;
  assert.ok(requestedAt instanceof Date);
  assert.equal(accepted.renderRequestedAt, requestedAt);
  assert.equal(accepted.expressGenerationStatus.status, 'QUEUED');
  assert.equal(accepted.expressGenerationPending, false);
  assert.equal(accepted.videoGenerationPending, false);
  await markQuickPreparationFailed(owner, id, requestedAt, new Error('Preparation failed'));
  const [filter, failed] = writes.mock.calls[1].arguments;
  assert.equal(filter.renderRequestedAt, requestedAt);
  assert.equal(filter.userId, owner);
  assert.equal(failed.$set.expressGenerationFailed, true);
  assert.equal(failed.$set['expressGenerationStatus.status'], 'FAILED');
  assert.equal(failed.$set.videoGenerationPending, false);
  await setSessionQuickGenerationPending(owner, payload);
  const [, preparedLegacy] = writes.mock.calls[2].arguments;
  assert.equal(preparedLegacy.expressGenerationStatus.status, undefined);
  assert.equal(preparedLegacy.expressGenerationPending, undefined);
});

test('latest render ranks actual submissions and skips drafts, Studio copies, and other identities', {
  skip: !process.env.LATEST_RENDER_TEST_MONGO_URL && 'Set LATEST_RENDER_TEST_MONGO_URL to run with MongoDB',
}, async (t) => {
  const dbName = `latest_render_test_${randomUUID().replaceAll('-', '')}`;
  const connection = await mongoose.createConnection(process.env.LATEST_RENDER_TEST_MONGO_URL, { dbName }).asPromise();
  const collection = connection.collection(VideoSession.collection.name);
  const jobs = connection.collection(VideoGeneration.collection.name);
  t.after(async () => {
    try { await connection.dropDatabase(); } finally { await connection.close(); }
  });
  const headers = authenticate(t);
  t.mock.method(VideoSession, 'aggregate', (pipeline) => collection.aggregate(pipeline).toArray());
  const insert = async (date, fields = {}) => (await collection.insertOne({
    userId: owner, createdAt: new Date(2025, 0, date), ...fields,
  })).insertedId.toString();
  const blank = new VideoSession({ userId: owner, inputPrompt: 'Unsubmitted' }).toObject();
  await insert(30, blank);
  await insert(29, { isExpressGeneration: true, expressGenerationPending: false,
    builderStatus: 'DRAFT', builderSessionSubType: 'interactive_video_draft' });
  await insert(28, { videoLink: 'copied.mp4', postProcessingBilling: { operation: 'copy_studio' } });
  await insert(27, { videoGenerationPending: true, isExternalUserRequest: true });
  await insert(26, { videoGenerationPending: true, externalRequestUserId: 'partner-customer' });
  await insert(25, { videoGenerationPending: true, userId: 'another-account' });
  await insert(24, { videoGenerationPending: true, isGuestSession: true });
  assert.equal((await request(headers)).data, null);

  await insert(10, { isExpressGeneration: true, expressGenerationPending: true, updatedAt: new Date(2025, 0, 31) });
  const terminal = await insert(11, { expressGenerationFailed: true });
  assert.deepEqual((await request(headers)).data, { sessionId: terminal, status: 'failed' });
  const builder = await insert(1, { videoGenerationPending: true, expressGenerationBuilder: { queuedAt: new Date(2025, 0, 12) } });
  assert.deepEqual((await request(headers)).data, { sessionId: builder, status: 'pending' });
  const studio = await insert(2, { videoGenerationPending: true, renderRequestedAt: new Date(2025, 0, 13) });
  assert.deepEqual((await request(headers)).data, { sessionId: studio, status: 'pending' });
  const copyRender = await insert(3, { videoLink: 'render.mp4', postProcessingBilling: { operation: 'copy_studio' },
    renderRequestedAt: new Date(2025, 0, 14) });
  assert.deepEqual((await request(headers)).data, { sessionId: copyRender, status: 'completed' });
  const olderStudio = await insert(1, { videoGenerationPending: true, expressGenerationPending: false });
  await jobs.createIndex({ videoSessionId: 1, renderPathId: 1, renderPlanVersion: 1 });
  await jobs.insertOne({ videoSessionId: olderStudio, createdAt: new Date(2025, 0, 15) });
  assert.deepEqual((await request(headers)).data, { sessionId: olderStudio, status: 'pending' });
  await insert(3, { renderRequestedAt: new Date(2025, 0, 12), quickSessionCreatedAt: new Date(2025, 0, 22), videoLink: 'old-quick.mp4' });
  assert.deepEqual((await request(headers)).data, { sessionId: olderStudio, status: 'pending' });
  const earlierExpress = await insert(4, { isExpressGeneration: true, expressGenerationPending: true, videoGenerationPending: true });
  await jobs.insertOne({ videoSessionId: earlierExpress, createdAt: new Date(2025, 0, 16) });
  assert.deepEqual((await request(headers)).data, { sessionId: olderStudio, status: 'pending' });
});
