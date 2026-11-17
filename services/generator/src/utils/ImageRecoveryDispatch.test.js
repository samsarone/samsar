import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareImageRecoveryDispatch } from './ImageRecoveryDispatch.js';

function fixture() {
  const payload = { _id: 'queued-image', videoSessionId: 'session', layerId: 'scene-five',
    imageRecoveryId: 'recovery-one', apiGenerationStatus: 'INIT', rowLocked: true };
  const session = { _id: 'session', expressGenerationPending: true,
    expressImageRecovery: { id: 'recovery-one' },
    hostedAgentBilling: { version: 2, state: 'ACTIVE', pendingOperation: null },
    layers: [{ _id: 'scene-five', imageSession: { generationStatus: 'PENDING' } }] };
  const deleted = [], updates = [], reads = [];
  const dependencies = {
    now: 1000,
    VideoSession: { findById(id) {
      reads.push(id);
      return { select() { return this; }, lean: async () => structuredClone(session) };
    } },
    ImageGeneration: {
      async deleteOne(filter) { deleted.push(filter); return { deletedCount: 1 }; },
      async updateOne(filter, update) { updates.push({ filter, update }); return { matchedCount: 1 }; },
    },
  };
  return { payload, session, dependencies, deleted, updates, reads };
}

test('ordinary rerolls and accepted recovery requests bypass the new-submission fence', async () => {
  const h = fixture();
  const unused = { VideoSession: { findById() { assert.fail('existing calls must not recheck dispatch admission'); } } };
  assert.equal(await prepareImageRecoveryDispatch({ ...h.payload, imageRecoveryId: undefined }, unused), true);
  assert.equal(await prepareImageRecoveryDispatch({ ...h.payload, apiGenerationStatus: 'PENDING' }, unused), true);
});

test('a funded current recovery may start a new image submission', async () => {
  const h = fixture();
  assert.equal(await prepareImageRecoveryDispatch(h.payload, h.dependencies), true);
  assert.deepEqual(h.reads, ['session']);
  assert.deepEqual(h.deleted, []);
  assert.deepEqual(h.updates, []);
});

test('post-processing recovery uses its own funding policy despite a copied old agent receipt', async () => {
  const h = fixture();
  h.session.postProcessingBilling = { version: 1 };
  h.session.hostedAgentBilling.state = 'FAILED';
  assert.equal(await prepareImageRecoveryDispatch(h.payload, h.dependencies), true);
  assert.deepEqual(h.deleted, []);
  assert.deepEqual(h.updates, []);
});

test('a planned AI-video flag without completed status or an asset still permits missing-image recovery', async () => {
  const h = fixture();
  h.session.layers[0].hasAiVideoLayer = true;
  h.session.layers[0].aiVideoGenerationStatus = 'PENDING';
  h.session.layers[0].aiVideoLayer = '  ';
  assert.equal(await prepareImageRecoveryDispatch(h.payload, h.dependencies), true);
  assert.deepEqual(h.deleted, []);
  assert.deepEqual(h.updates, []);
});

for (const [name, change] of [
  ['an overlay image', h => { h.session.layers[0].imageSession.activeItemList = [{ type: 'image', src: 'logo.png' }]; }],
  ['a non-base image', h => { h.session.layers[0].imageSession.activeItemList = [{ type: 'image', is_base_image: false, src: 'overlay.png' }]; }],
  ['a base image with an empty source', h => { h.session.layers[0].imageSession.activeItemList = [{ type: 'image', is_base_image: true, src: '  ' }]; }],
  ['a rejected filter candidate', h => { h.session.layers[0].filterPasses = [{ src: 'rejected.png', score: 46 }]; }],
]) {
  test(`recovery still dispatches when the only existing image evidence is ${name}`, async () => {
    const h = fixture(); change(h);
    assert.equal(await prepareImageRecoveryDispatch(h.payload, h.dependencies), true);
    assert.deepEqual(h.deleted, []);
    assert.deepEqual(h.updates, []);
  });
}

for (const [name, change] of [
  ['cancelled after the outbox inserted the job', h => { h.session.expressGenerationCancelled = true; }],
  ['failed after queuing', h => { h.session.expressGenerationFailed = true; }],
  ['a newer recovery plan replaced the queued plan', h => { h.session.expressImageRecovery.id = 'new-recovery'; }],
  ['the layer finished after queuing', h => { h.session.layers[0].imageSession.generationStatus = 'COMPLETED'; }],
  ['an accepted generated image arrived after queuing', h => { h.session.layers[0].imageSession.activeGeneratedImage = 'accepted.png'; }],
  ['an accepted selected image arrived after queuing', h => { h.session.layers[0].imageSession.activeSelectedImage = 'chosen.png'; }],
  ['an accepted base image exists only in the active canvas items', h => { h.session.layers[0].imageSession.activeItemList = [{ type: 'image', is_base_image: true, src: 'accepted-base.png' }]; }],
  ['the AI video completed after the image recovery was queued', h => { h.session.layers[0].aiVideoGenerationStatus = 'COMPLETED'; }],
  ['a usable local AI-video asset already exists', h => { h.session.layers[0].aiVideoLayer = 'clips/completed.mp4'; }],
  ['a usable remote AI-video asset already exists', h => { h.session.layers[0].aiVideoRemoteLink = 'https://media.example/completed.mp4'; }],
  ['the layer was removed from the current timeline', h => { h.session.layers = []; }],
  ['the parent was deleted', h => { h.dependencies.VideoSession.findById = () => ({ select() { return this; }, lean: async () => null }); }],
]) {
  test(`recovery does not dispatch when ${name}`, async () => {
    const h = fixture(); change(h);
    assert.equal(await prepareImageRecoveryDispatch(h.payload, h.dependencies), false);
    assert.deepEqual(h.deleted, [{ _id: 'queued-image', imageRecoveryId: 'recovery-one', apiGenerationStatus: 'INIT' }]);
    assert.deepEqual(h.updates, []);
  });
}

for (const [name, change] of [
  ['paused', h => { h.session.expressGenerationPaused = true; }],
  ['not runnable', h => { h.session.expressGenerationPending = false; }],
  ['not funded', h => { h.session.hostedAgentBilling.state = 'PAUSED'; }],
  ['funding is still settling', h => { h.session.hostedAgentBilling.pendingOperation = { id: 'funding-op' }; }],
]) {
  test(`recovery defers a job for 15 seconds while the parent is ${name}`, async () => {
    const h = fixture(); change(h);
    assert.equal(await prepareImageRecoveryDispatch(h.payload, h.dependencies), false);
    assert.deepEqual(h.deleted, []);
    assert.deepEqual(h.updates, [{ filter: { _id: 'queued-image', imageRecoveryId: 'recovery-one', apiGenerationStatus: 'INIT' },
      update: { $set: { rowLocked: false, nextAttemptAfter: new Date(16000) } } }]);
    assert.equal(h.payload.apiGenerationStatus, 'INIT');
    assert.equal(h.payload.imageSubmissionAttempt, undefined, 'deferral must not start a provider submission intent');
  });
}

test('the dispatch fence never deletes or unlocks a row that advanced to an accepted request during the read', async () => {
  const h = fixture();
  h.session.expressGenerationCancelled = true;
  h.dependencies.ImageGeneration.deleteOne = async filter => {
    assert.equal(filter.apiGenerationStatus, 'INIT', 'a concurrent accepted PENDING row must not match');
    return { deletedCount: 0 };
  };
  assert.equal(await prepareImageRecoveryDispatch(h.payload, h.dependencies), false);
  assert.deepEqual(h.updates, []);
});
