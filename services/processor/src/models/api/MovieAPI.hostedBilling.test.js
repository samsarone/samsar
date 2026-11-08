import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import VideoSession from '../../schema/VideoSession.js';
import Builder from '../../schema/ExpressGenerationBuilderRequest.js';
import { hostedAgentBuilderTestHooks as hooks } from './MovieAPI.js';

function fixture(t, routeType = 'text_to_video') {
  const events = [];
  const session = { _id: '507f1f77bcf86cd799439011' };
  let job;
  t.mock.method(mongoose, 'connect', async () => mongoose);
  t.mock.method(VideoSession, 'findById', () => ({ select() { return this; }, lean: async () => structuredClone(session) }));
  t.mock.method(VideoSession, 'findOne', () => ({ select() { return this; }, lean: async () => structuredClone(session) }));
  t.mock.method(VideoSession, 'findByIdAndUpdate', async () => {});
  t.mock.method(Builder, 'findOneAndUpdate', (filter, update) => {
    if (!filter.$or) {
      job = { _id: 'builder', sessionId: filter.sessionId, ...structuredClone(update.$set) };
      events.push('persist'); return {};
    }
    if (job.status !== 'QUEUED') return { lean: async () => null };
    Object.assign(job, update.$set); events.push('claim');
    return { lean: async () => structuredClone(job) };
  });
  t.mock.method(Builder, 'updateOne', async (_filter, update) => {
    Object.assign(job, update.$set); if (update.$unset?.payload !== undefined) delete job.payload;
  });
  const operations = {
    begin: async () => { assert.ok(job.payload, 'persist work before funding'); events.push('fund');
      session.hostedAgentBilling = { version: 2, state: 'ACTIVE' }; return { ok: true, billing: session.hostedAgentBilling }; },
    defer: () => events.push('defer'),
    processText: async () => events.push('text'),
    processImageList: async () => events.push('images'),
  };
  const admission = { routeType, estimate: { durationSeconds: 60 }, metadata: { pricingRateClass: 'agent' } };
  const schedule = () => hooks.scheduleTextToVideoBuilderSession(session._id, 'owner', { prompt: 'story' }, null, 'video_create', admission, operations);
  return { session, events, operations, schedule, job: () => job };
}
for (const route of ['text_to_video', 'image_list_to_video']) {
  test(`${route}: funding follows durable queue save and restart can run the saved request`, async t => {
    const h = fixture(t, route); await h.schedule();
    assert.deepEqual(h.events, ['persist', 'fund', 'defer']);
    assert.equal(h.job().billingAdmission.metadata.pricingRateClass, 'agent');
    assert.equal(await hooks.runPersistedTextToVideoBuilderSession(h.session._id, h.operations), true);
    assert.equal(h.job().status, 'COMPLETED'); assert.equal(h.job().payload, undefined);
    assert.equal(h.events.at(-1), route === 'text_to_video' ? 'text' : 'images');
    assert.equal(await hooks.runPersistedTextToVideoBuilderSession(h.session._id, h.operations), false);
  });
  test(`${route}: paused queued work waits and resumes without reporting a failed request`, async t => {
    const h = fixture(t, route); await h.schedule();
    h.session.hostedAgentBilling.state = 'PAUSED'; h.session.expressGenerationPaused = true;
    assert.equal(await hooks.runPersistedTextToVideoBuilderSession(h.session._id, h.operations), false);
    assert.equal(h.job().status, 'QUEUED'); assert.equal(h.events.filter(e => e === 'fund').length, 1);
    h.session.hostedAgentBilling.state = 'ACTIVE'; h.session.expressGenerationPaused = false;
    assert.equal(await hooks.runPersistedTextToVideoBuilderSession(h.session._id, h.operations), true);
  });
}
test('interruption before funding leaves a recoverable saved request', async t => {
  const h = fixture(t); const begin = h.operations.begin;
  h.operations.begin = async () => { throw Error('processor restarted'); };
  await assert.rejects(h.schedule(), /processor restarted/);
  assert.equal(h.job().status, 'QUEUED'); assert.deepEqual(h.events, ['persist']);
  h.operations.begin = begin;
  assert.equal(await hooks.runPersistedTextToVideoBuilderSession(h.session._id, h.operations), true);
});
test('pause racing builder admission queues the work instead of failing it', async t => {
  const h = fixture(t); await h.schedule();
  h.operations.begin = async () => { h.session.hostedAgentBilling.state = 'PAUSED'; return { billing: h.session.hostedAgentBilling }; };
  assert.equal(await hooks.runPersistedTextToVideoBuilderSession(h.session._id, h.operations), false);
  assert.equal(h.job().status, 'QUEUED'); assert.equal(h.events.includes('text'), false);
});
test('a terminal request cannot restart a saved builder', async t => {
  const h = fixture(t); await h.schedule(); h.session.hostedAgentBilling.state = 'COMPLETED';
  assert.equal(await hooks.runPersistedTextToVideoBuilderSession(h.session._id, h.operations), false);
  assert.equal(h.events.includes('text'), false);
});
test('repeated admission with an existing session ID returns that request without resetting it', async t => {
  const h = fixture(t); await h.schedule(); h.session.hostedAgentBilling.state = 'PAUSED';
  assert.deepEqual(await hooks.existingHostedAdmissionResponse('owner', { session_id: h.session._id }), {
    request_id: h.session._id, session_id: h.session._id,
  });
});

test('starting full agent generation from a post-processing result admits a new request', async () => {
  const source = { _id: 'post-session', userId: 'owner', postProcessingBilling: { version: 1, creditsCharged: 75 } };
  const before = structuredClone(source); const created = [];
  const id = await hooks.getOrCreateSessionId('owner', { session_id: source._id }, {
    load: async () => source,
    create: async (...args) => { created.push(args); return 'new-agent-session'; },
  });
  assert.equal(id, 'new-agent-session'); assert.deepEqual(source, before);
  assert.deepEqual(created, [['owner', { expressGenerationPending: false }]]);
});

test('ordinary sessions retain their existing admission identity', async () => {
  const id = await hooks.getOrCreateSessionId('owner', { session_id: 'ordinary' }, {
    load: async () => ({ _id: 'ordinary', userId: 'owner' }), create: async () => assert.fail('Unexpected new session'),
  });
  assert.equal(id, 'ordinary');
});

test('a post-processing result is not mistaken for an admission retry of its source agent', async t => {
  const h = fixture(t); await h.schedule();
  h.session.postProcessingBilling = { version: 1, creditsCharged: 75 };
  assert.equal(await hooks.existingHostedAdmissionResponse('owner', { session_id: h.session._id }), null);
});
