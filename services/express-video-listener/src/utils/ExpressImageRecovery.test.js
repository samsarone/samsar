import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureExpressImageRecoveryRequests } from './ExpressImageRecovery.js';

function harness() {
  const session = { _id: 'session', expressGenerationPending: true,
    hostedAgentBilling: { version: 2, state: 'ACTIVE', pendingOperation: null },
    layers: [{ _id: 'done', imageSession: { generationStatus: 'COMPLETED' } },
      { _id: 'retry', imageSession: { generationStatus: 'PENDING' } }],
    expressImageRecovery: { version: 1, id: 'repair', sessionId: 'session', status: 'PENDING',
      jobs: [{ _id: 'a', layerId: 'done' }, { _id: 'b', layerId: 'retry', prompt: 'Original scene', videoSessionId: 'session' }] } };
  const rows = new Map(), writes = [];
  const dependencies = {
    ImageGeneration: { findOne: async ({ layerId }) => [...rows.values()].find(j => j.layerId === layerId),
      updateOne: async (filter, update, options) => { assert.equal(options.upsert, true);
        if (!rows.has(filter._id)) rows.set(filter._id, structuredClone(update.$setOnInsert)); } },
    VideoSession: {
      findOne: () => ({ lean: async () => session.expressGenerationPaused || session.expressGenerationCancelled ||
        session.expressGenerationFailed || !session.expressGenerationPending ? null : structuredClone(session) }),
      findOneAndUpdate: (filter, update) => ({ lean: async () => {
        if (session.expressImageRecovery.status !== 'PENDING' &&
          !(session.expressImageRecovery.status === 'QUEUING' && session.expressImageRecovery.leaseUntil <= new Date())) return null;
        for (const [key, value] of Object.entries(update.$set)) session.expressImageRecovery[key.split('.').at(-1)] = value;
        return structuredClone(session);
      } }),
      updateOne: async (filter, update) => { writes.push({ filter, update });
        if (update.$set['expressImageRecovery.status']) session.expressImageRecovery.status = update.$set['expressImageRecovery.status']; },
    },
  };
  return { session, rows, writes, dependencies };
}

test('normal funded resume queues only unfinished images once with stable IDs', async () => {
  const h = harness();
  await ensureExpressImageRecoveryRequests(h.session, h.dependencies);
  await ensureExpressImageRecoveryRequests(h.session, h.dependencies);
  assert.equal(h.rows.size, 1); assert.equal(h.rows.get('b').prompt, 'Original scene');
  assert.equal(h.writes[0].filter['expressImageRecovery.id'], 'repair');
  assert.equal(h.writes[0].update.$set['expressImageRecovery.status'], 'QUEUED');
});

test('paused, failed and unfunded recovery cannot queue billable provider work', async () => {
  for (const field of ['expressGenerationPaused', 'expressGenerationFailed', 'expressGenerationCancelled']) {
    const h = harness(); h.session[field] = true;
    assert.equal(await ensureExpressImageRecoveryRequests(h.session, h.dependencies), false);
    assert.equal(h.rows.size, 0);
  }
  for (const state of ['FAILED', 'PAUSED']) {
    const h = harness(); h.session.hostedAgentBilling.state = state;
    assert.equal(await ensureExpressImageRecoveryRequests(h.session, h.dependencies), false);
    assert.equal(h.rows.size, 0);
  }
});

test('a retained accepted image request is reused rather than replaced during recovery', async () => {
  const h = harness(); h.rows.set('accepted', { _id: 'accepted', layerId: 'retry', apiRequestId: 'existing-provider-id' });
  await ensureExpressImageRecoveryRequests(h.session, h.dependencies);
  assert.equal(h.rows.size, 1); assert.equal(h.rows.get('accepted').apiRequestId, 'existing-provider-id');
});

test('concurrent listener ticks have one recovery queue owner', async () => {
  const h = harness();
  const outcomes = await Promise.all([
    ensureExpressImageRecoveryRequests(h.session, h.dependencies),
    ensureExpressImageRecoveryRequests(h.session, h.dependencies),
  ]);
  assert.deepEqual(outcomes.sort(), [false, true]);
  assert.equal(h.rows.size, 1);
  assert.equal(h.writes.length, 1);
});

test('cancellation after the queue claim fences remaining image recovery jobs', async () => {
  const h = harness();
  h.dependencies.VideoSession.findOne = () => ({ lean: async () => { h.session.expressGenerationCancelled = true; return null; } });
  assert.equal(await ensureExpressImageRecoveryRequests(h.session, h.dependencies), false);
  assert.equal(h.rows.size, 0);
  assert.equal(h.writes.length, 0);
});

for (const completedVideo of [
  { aiVideoGenerationStatus: 'COMPLETED' },
  { aiVideoLayer: 'already-rendered.mp4', hasAiVideoLayer: false },
  { aiVideoRemoteLink: 'https://media.example/already-rendered.mp4' },
]) {
  test(`video completed while awaiting queueing is preserved: ${Object.keys(completedVideo).join(',')}`, async () => {
    const h = harness();
    const oldFindOne = h.dependencies.VideoSession.findOne;
    h.dependencies.VideoSession.findOne = (...args) => {
      Object.assign(h.session.layers[1], completedVideo);
      return oldFindOne(...args);
    };
    await ensureExpressImageRecoveryRequests(h.session, h.dependencies);
    assert.equal(h.rows.size, 0);
    const repaired = h.writes.find(write => write.filter['layers._id'] === 'retry');
    assert.equal(repaired.update.$set['layers.$.imageSession.generationStatus'], 'COMPLETED');
    assert.equal(Object.keys(repaired.update.$set).some(key => key.includes('aiVideo')), false);
  });
}

test('video enablement without a completed clip still queues the unfinished image', async () => {
  const h = harness();
  h.session.layers[1].hasAiVideoLayer = true;
  h.session.layers[1].aiVideoGenerationStatus = 'INIT';
  await ensureExpressImageRecoveryRequests(h.session, h.dependencies);
  assert.equal(h.rows.size, 1);
});

test('fresh selected base images are preserved but overlays, empty sources and rejected candidates still need generation', async () => {
  for (const [items, keep] of [
    [[{ type: 'image', is_base_image: true, src: 'accepted-base.png' }], true],
    [[{ type: 'image', src: 'overlay-logo.png' }], false],
    [[{ type: 'image', is_base_image: true, src: ' ' }], false],
  ]) {
    const h = harness(); h.session.layers[1].imageSession.activeItemList = items;
    h.session.layers[1].filterPasses = [{ score: 46, src: 'rejected-candidate.png' }];
    await ensureExpressImageRecoveryRequests(h.session, h.dependencies);
    assert.equal(h.rows.size, keep ? 0 : 1);
  }
});
