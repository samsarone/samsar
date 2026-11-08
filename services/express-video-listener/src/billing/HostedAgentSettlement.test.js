import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostedAgentSettlement } from './HostedAgentSettlement.js';
import { buildHostedAgentQuote, calculateHostedAgentUsage } from './HostedAgentUsage.js';
import { getExpressVideoStageCreditsPerSecond, EXPRESS_VIDEO_CREDITS_PER_SECOND_BY_MODEL } from '../consts/ExpressVideoPricingDistribution.js';

const models = { RUNWAYML: 30, 'VEO3.1I2V': 60, 'VEO3.1I2VFAST': 36, COSMOS3SUPERI2V: 20,
  SEEDANCEI2V: 30, 'SEEDANCE2.0I2V': 40, 'SEEDANCE2.5I2V': 60, KLINGIMGTOVID4: 36,
  KLINGIMGTOVID3PRO: 36, KLINGIMGTOVIDTURBO: 36, HAPPYHORSEI2V: 36 };
const get = (o, p) => p.split('.').reduce((v, key) => v?.[key], o);
function set(o, p, value) { const keys = p.split('.'); const last = keys.pop(); let v = o;
  for (const key of keys) v = v[key] ??= {}; v[last] = structuredClone(value); }
function matches(o, filter) { return Object.entries(filter).every(([key, value]) => {
  const actual = get(o, key);
  if (value && typeof value === 'object') {
    if ('$exists' in value) return (actual !== undefined) === value.$exists;
    if ('$gte' in value) return actual >= value.$gte;
    if ('$ne' in value) return actual !== value.$ne;
  }
  return actual === value;
}); }
function update(o, value) {
  for (const [key, v] of Object.entries(value.$set || {})) set(o, key, v);
  for (const [key, v] of Object.entries(value.$inc || {})) set(o, key, (get(o, key) || 0) + v);
}
const query = value => ({ select() { return this; }, lean: async () => structuredClone(value) });

function quote(model = 'KLINGIMGTOVID4', durationSeconds = 60) {
  const rates = Object.fromEntries(['narrative_inference', 'image_generation', 'speech_generation', 'music_generation',
    'lip_sync_generation', 'sound_effect_generation', 'pipeline', 'ai_video_generation']
    .map(stage => [stage, getExpressVideoStageCreditsPerSecond(stage, model, 'agent')]));
  return buildHostedAgentQuote({ durationSeconds, stages: Object.fromEntries(Object.entries(rates).map(([key, rate]) => [key, { creditsPerSecond: rate }])) }, { model });
}
function layer(id, duration = 30, done = false) {
  return { _id: id, duration, durationOffset: id === 'a' ? 0 : 30,
    imageSession: { generationStatus: done ? 'COMPLETED' : 'PENDING', activeGeneratedImage: done ? `${id}.png` : '' },
    aiVideoGenerationStatus: done ? 'COMPLETED' : 'PENDING', aiVideoLayer: done ? `${id}.mp4` : '',
    lipSyncVideoGenerationStatus: done ? 'COMPLETED' : 'PENDING', lipSyncVideoLayer: done ? `${id}-lip.mp4` : '',
    soundEffectVideoGenerationStatus: done ? 'COMPLETED' : 'PENDING', soundEffectVideoLayer: done ? `${id}-sfx.mp4` : '' };
}
function partial(session) {
  session.layers = [layer('a', 30, true), layer('b')];
  session.expressGenerationStatus = { prompt_generation: 'COMPLETED' };
  session.audioLayers = [
    { _id: 'speech-a', generationType: 'speech', connectedLayerId: 'a', generationStatus: 'COMPLETED', selectedLocalAudioLink: 'speech.wav', duration: 27 },
    { _id: 'music', generationType: 'music', generationStatus: 'COMPLETED', selectedLocalAudioLink: 'music.wav', startTime: 0, duration: 30 },
  ];
}
function harness({ credits = 100000, bypass = false, session: extra = {} } = {}) {
  const session = { _id: 'session', userId: 'owner', layers: [], ...extra };
  const owner = { _id: 'owner', generationCredits: credits };
  const ledger = new Map();
  const faults = { ledger: 0, receipt: 0, walletResponse: 0, beforeDebit: 0, duplicateLedger: 0 };
  const hooks = {};
  const VideoSession = {
    findById: () => query(session),
    async updateOne(filter, value) {
      if (!matches(session, filter)) return { matchedCount: 0, modifiedCount: 0 };
      if (faults.receipt && value.$set?.['hostedAgentBilling.netFunded'] !== undefined) { faults.receipt--; throw Error('receipt outage'); }
      update(session, value); await hooks.afterUpdate?.(filter, value); return { matchedCount: 1, modifiedCount: 1 };
    },
    findOneAndUpdate(filter, value) { if (!matches(session, filter)) return query(null); update(session, value); return query(session); },
  };
  const Model = {
    findById: () => query(owner),
    async updateOne(filter, value) { if (matches(owner, filter)) update(owner, value); },
    findOneAndUpdate(filter, value) {
      if (!matches(owner, filter)) return query(null);
      update(owner, value);
      if (faults.walletResponse) { faults.walletResponse--; return { lean: async () => { throw Error('wallet response lost'); } }; }
      return query(owner);
    },
  };
  const Ledger = { findById: id => query(ledger.get(id)), async updateOne(filter, value) {
    if (faults.ledger) { faults.ledger--; throw Error('ledger outage'); }
    if (!ledger.has(filter._id)) ledger.set(filter._id, structuredClone(value.$setOnInsert));
    if (faults.duplicateLedger) { faults.duplicateLedger--; throw Object.assign(Error('duplicate key'), { code: 11000 }); }
  } };
  const engine = createHostedAgentSettlement({ VideoSession, resolveAccount: async () => ({ Model, id: 'owner' }), Ledger, bypass: () => bypass, beforeDebit: async (...args) => {
    if (faults.beforeDebit) { faults.beforeDebit--; throw Object.assign(Error('limit'), { code: 'API_KEY_USAGE_LIMIT_EXCEEDED' }); }
    await hooks.beforeDebit?.(...args);
  } });
  return { session, owner, ledger, faults, hooks, engine, credits };
}
function assertBalance(h, expectedNet) {
  assert.equal(h.credits - h.owner.generationCredits, expectedNet);
  const entries = [...h.ledger.values()];
  assert.equal(entries.reduce((sum, item) => sum + (item.direction === 'debit' ? item.amount : -item.amount), 0), expectedNet);
  assert.equal(h.session.hostedAgentBilling.netFunded, expectedNet);
}

for (const model of Object.keys(models)) {
  for (const sourceState of ['ACTIVE', 'PAUSED', 'COMPLETED']) {
    test(`${model}: a ${sourceState} source quota cannot fund or refund a copied session`, async () => {
      const h = harness(); await h.engine.begin('session', quote(model));
      if (sourceState === 'PAUSED') { partial(h.session); await h.engine.transition('session', 'PAUSED'); }
      if (sourceState === 'COMPLETED') { h.session.finalVideoDurationSeconds = 60; await h.engine.transition('session', 'COMPLETED'); }
      const balance = h.owner.generationCredits;
      const original = structuredClone(h.session);
      h.session._id = 'copied-session';
      for (const outcome of ['FAILED', 'PAUSED', 'ACTIVE', 'COMPLETED']) {
        await assert.rejects(h.engine.transition('copied-session', outcome), { code: 'AGENT_BILLING_OWNER_MISMATCH' });
        assert.equal(h.owner.generationCredits, balance);
      }
      Object.assign(h.session, original);
      assert.equal(h.session.hostedAgentBilling.sessionId, 'session');
      if (sourceState !== 'COMPLETED') await h.engine.transition('session', 'FAILED');
      assert.ok(h.owner.generationCredits <= h.credits);
    });
  }
}

test('legacy unbound v2 billing needs evidence of funding for this session', async () => {
  const h = harness(); await h.engine.begin('session', quote());
  delete h.session.hostedAgentBilling.sessionId; delete h.session.hostedAgentBilling.userId;
  h.session._id = 'copy';
  await assert.rejects(h.engine.transition('copy', 'FAILED'), { code: 'AGENT_BILLING_OWNER_MISMATCH' });
  h.session._id = 'session'; await h.engine.transition('session', 'FAILED'); assertBalance(h, 0);
});

test('post-processing is excluded from agent funding, allocations and refunds even with a stale copied quote', async () => {
  const h = harness(); await h.engine.begin('session', quote());
  const balance = h.owner.generationCredits;
  h.session._id = 'post-processing';
  h.session.postProcessingBilling = { version: 1, sessionId: 'post-processing', creditsCharged: 75 };
  await assert.rejects(h.engine.begin('post-processing', quote()), { code: 'POST_PROCESSING_BILLING_CONFLICT' });
  await h.engine.completeStage('post-processing', 'pipeline');
  for (const outcome of ['FAILED', 'PAUSED', 'COMPLETED']) await h.engine.transition('post-processing', outcome);
  assert.equal(h.owner.generationCredits, balance);
});

for (const [model, rate] of Object.entries(models)) {
  test(`${model}: full success and repeat callbacks reconcile to ${rate}/second`, async () => {
    const h = harness(); const q = quote(model);
    await Promise.all([h.engine.begin('session', q), h.engine.begin('session', q)]);
    assertBalance(h, 60 * rate);
    assert.equal(h.session.expressGenerationCreditCharges.totalCharged, 60 * rate);
    for (const stage of Object.keys(q.rates)) await h.engine.completeStage('session', stage);
    assert.equal(h.ledger.size, 1, 'stage completion must not debit the wallet');
    h.session.finalVideoDurationSeconds = 60;
    await Promise.all([h.engine.transition('session', 'COMPLETED'), h.engine.transition('session', 'COMPLETED')]);
    assertBalance(h, 60 * rate); assert.equal(h.ledger.size, 1);
  });
  for (const outcome of ['FAILED', 'PAUSED', 'CANCELLED']) {
    test(`${model}: ${outcome} retains only completed allocations and refunds once`, async () => {
      const h = harness(); await h.engine.begin('session', quote(model)); partial(h.session);
      await Promise.all([h.engine.transition('session', outcome), h.engine.transition('session', outcome)]);
      assertBalance(h, 30 * rate);
      assert.equal(h.session.hostedAgentBilling.totalRefunded, 30 * rate);
      h.session.layers[1] = layer('b', 30, true); // late provider callback
      await h.engine.transition('session', outcome);
      assertBalance(h, 30 * rate); assert.equal(h.ledger.size, 2);
    });
  }
  test(`${model}: pause/resume cycles charge the remaining allocation without rebilling completed work`, async () => {
    const h = harness(); const q = quote(model); await h.engine.begin('session', q); partial(h.session);
    await h.engine.transition('session', 'PAUSED');
    await h.engine.begin('session', q); assertBalance(h, 30 * rate); // duplicate admission is not resume
    await Promise.all([h.engine.transition('session', 'ACTIVE'), h.engine.transition('session', 'ACTIVE')]);
    assertBalance(h, 60 * rate);
    await h.engine.transition('session', 'PAUSED'); assertBalance(h, 30 * rate);
    await h.engine.transition('session', 'ACTIVE');
    h.session.finalVideoDurationSeconds = 50;
    await h.engine.transition('session', 'COMPLETED'); assertBalance(h, 50 * rate);
    await h.engine.transition('session', 'COMPLETED'); assertBalance(h, 50 * rate);
  });
  test(`${model}: final duration includes the outro and removed scenes are refunded`, async () => {
    const h = harness(); await h.engine.begin('session', quote(model, 68));
    h.session.layers = [{ _id: 'scene', duration: 48, durationOffset: 0 }, { _id: 'outro', duration: 8, durationOffset: 48 }];
    h.session.finalVideoDurationSeconds = 56;
    await h.engine.transition('session', 'COMPLETED'); assertBalance(h, 56 * rate);
    assert.equal(h.session.hostedAgentBilling.totalRefunded, 12 * rate);
  });
}

for (const fault of ['ledger', 'receipt', 'walletResponse']) {
  for (const refund of [false, true]) {
    test(`${fault}: ${refund ? 'refund' : 'funding'} recovers after money moves without another wallet mutation`, async () => {
      const h = harness(); const q = quote();
      if (refund) await h.engine.begin('session', q);
      h.faults[fault] = 1;
      const operation = () => refund ? h.engine.transition('session', 'FAILED') : h.engine.begin('session', q);
      await assert.rejects(operation()); await operation();
      assertBalance(h, refund ? 0 : q.credits);
      assert.equal(h.ledger.size, refund ? 2 : 1);
    });
  }
}

test('failed admission can close an unfunded operation without charging or granting credits', async () => {
  const h = harness({ credits: 0 }); await assert.rejects(h.engine.begin('session', quote()), { code: 'INSUFFICIENT_CREDITS' });
  await h.engine.transition('session', 'FAILED'); assertBalance(h, 0); assert.equal(h.ledger.size, 0);
});

test('unknown wallet outcome is recovered before terminal refund', async () => {
  const h = harness(); h.faults.walletResponse = 1; await assert.rejects(h.engine.begin('session', quote()));
  await h.engine.transition('session', 'FAILED'); assertBalance(h, 0); assert.equal(h.ledger.size, 2);
});

test('completed-stage allocation survives partial-layer flags and fractional credits round only once', async () => {
  const h = harness(); await h.engine.begin('session', quote('KLINGIMGTOVID4', 10.01));
  await h.engine.completeStage('session', 'image_generation');
  await h.engine.transition('session', 'PAUSED'); assertBalance(h, 21);
  await h.engine.transition('session', 'ACTIVE'); h.session.finalVideoDurationSeconds = 10.01;
  await h.engine.transition('session', 'COMPLETED'); assertBalance(h, 361);
});

test('branched settlement counts shared layers and outro once, not the sum of exported paths', async () => {
  const h = harness(); await h.engine.begin('session', quote('RUNWAYML', 38));
  h.session.narrativeType = 'branched';
  h.session.layers = [{ _id: 'root', duration: 5 }, { _id: 'left', duration: 5 }, { _id: 'right', duration: 10 },
    { _id: 'root', duration: 5 }, { _id: 'outro', duration: 8 }];
  h.session.finalVideoDurationSeconds = 18;
  await h.engine.transition('session', 'COMPLETED'); assertBalance(h, 28 * 30);
});

test('outputs without successful statuses, failed attempts and duplicate audio do not inflate usage', async () => {
  const h = harness(); await h.engine.begin('session', quote()); partial(h.session);
  h.session.layers.push(structuredClone(h.session.layers[0]));
  h.session.layers[1].aiVideoLayer = 'failed-output.mp4'; h.session.layers[1].aiVideoGenerationStatus = 'FAILED';
  h.session.audioLayers.push({ ...h.session.audioLayers[0], _id: 'speech-retry' }, { ...h.session.audioLayers[1], _id: 'music-alternative' });
  assert.equal(calculateHostedAgentUsage(h.session, 'PAUSED').totalCharged, 1080);
});

test('standalone, adapter jobs and previously charged legacy requests keep their billing paths', async () => {
  for (const options of [{ bypass: true }, { session: { videoBillingPolicy: 'adapter' } }, { session: { isExternalUserRequest: true } }, { session: { custom_adapters: { image_to_video: 'custom' } } },
    { session: { samsarExternalProviderStages: { ai_video_generation: { model: 'external' } } } },
    { session: { expressGenerationCreditCharges: { totalCharged: 100 } } }]) {
    const h = harness(options); await h.engine.begin('session', quote());
    assert.equal(h.owner.generationCredits, h.credits); assert.equal(h.ledger.size, 0);
    assert.equal(h.session.hostedAgentBilling, undefined);
  }
});

test('a saved quote survives model/rate changes and final duration cannot exceed the prepaid ceiling', async () => {
  const h = harness(); await h.engine.begin('session', quote('RUNWAYML'));
  await h.engine.begin('session', quote('VEO3.1I2V'));
  h.session.expressGenerativeVideoModel = 'VEO3.1I2V'; h.session.finalVideoDurationSeconds = 90;
  await h.engine.transition('session', 'COMPLETED'); assertBalance(h, 1800);
});

for (const [model, rate] of Object.entries(models)) {
  for (const [stage, key] of [['image_generation', 'image'], ['ai_video_generation', 'ai'], ['lip_sync_generation', 'lip'], ['sound_effect_generation', 'sound'], ['speech_generation', 'speech'], ['music_generation', 'music']]) {
    test(`${model}: only completed ${stage} layers are retained on failure`, async () => {
      const h = harness(); const q = quote(model); await h.engine.begin('session', q);
      h.session.layers = [layer('a', 10), layer('b', 50)];
      const a = h.session.layers[0];
      if (key === 'image') a.imageSession = layer('a', 10, true).imageSession;
      else if (key === 'speech' || key === 'music') h.session.audioLayers = [{ _id: 'audio', generationType: key,
        connectedLayerId: 'a', generationStatus: 'COMPLETED', selectedRemoteAudioLink: 'audio.wav', duration: 10 }];
      else {
        const prefix = key === 'ai' ? 'ai' : key === 'lip' ? 'lipSync' : 'soundEffect';
        a[`${prefix}VideoGenerationStatus`] = 'COMPLETED'; a[`${prefix}VideoLayer`] = 'clip.mp4';
      }
      await h.engine.transition('session', 'FAILED'); assertBalance(h, 10 * q.rates[stage]);
    });
  }
  test(`${model}: resume then failure charges only newly completed allocations`, async () => {
    const h = harness(); await h.engine.begin('session', quote(model)); partial(h.session);
    await h.engine.control('session', 'PAUSED', { expressGenerationPaused: true });
    await h.engine.control('session', 'ACTIVE');
    h.session.layers[1].imageSession = layer('b', 30, true).imageSession;
    await h.engine.transition('session', 'FAILED'); assertBalance(h, 30 * rate + 60);
  });
}

test('a completed render arriving during pause waits for resume before final reconciliation', async () => {
  const h = harness(); await h.engine.begin('session', quote()); partial(h.session);
  await h.engine.control('session', 'PAUSED', { expressGenerationPaused: true });
  h.session.videoLink = 'finished.mp4'; h.session.finalVideoDurationSeconds = 50;
  assert.equal((await h.engine.transition('session', 'COMPLETED')).blocked, true);
  assertBalance(h, 1080);
  await h.engine.control('session', 'ACTIVE', { videoGenerationPending: true });
  assert.equal(h.session.videoGenerationPending, false, 'reuse the finished artifact');
  await h.engine.transition('session', 'COMPLETED'); assertBalance(h, 1800);
});

test('closing a paused session never charges late provider results', async () => {
  const h = harness(); await h.engine.begin('session', quote()); partial(h.session);
  await h.engine.control('session', 'PAUSED', { expressGenerationPaused: true });
  h.session.layers[1] = layer('b', 30, true);
  await h.engine.control('session', 'CANCELLED'); assertBalance(h, 1080);
  assert.equal((await h.engine.transition('session', 'COMPLETED')).blocked, true);
  await assert.rejects(h.engine.control('session', 'ACTIVE'));
});

test('resume admission rejection retains the paused charge and keeps work stopped', async () => {
  for (const limit of [false, true]) {
    const h = harness(); await h.engine.begin('session', quote()); partial(h.session);
    await h.engine.control('session', 'PAUSED', { expressGenerationPaused: true });
    if (limit) h.faults.beforeDebit = 1;
    else h.owner.generationCredits = 0;
    const balance = h.owner.generationCredits;
    await assert.rejects(h.engine.control('session', 'ACTIVE'), { code: limit ? 'API_KEY_USAGE_LIMIT_EXCEEDED' : 'INSUFFICIENT_CREDITS' });
    assert.equal(h.session.hostedAgentBilling.state, 'PAUSED');
    assert.equal(h.session.hostedAgentBilling.pendingOperation, null);
    assert.equal(h.session.expressGenerationPending, false);
    assert.equal(h.owner.generationCredits, balance);
    assert.equal(h.session.hostedAgentBilling.netFunded, 1080);
  }
});

test('new pause fences an in-flight resume before its wallet debit and activation', async () => {
  const h = harness(); await h.engine.begin('session', quote()); partial(h.session);
  await h.engine.control('session', 'PAUSED', { expressGenerationPaused: true });
  let entered; const waiting = new Promise(resolve => { entered = resolve; });
  let release; const blocked = new Promise(resolve => { release = resolve; });
  h.hooks.beforeDebit = async () => { entered(); await blocked; };
  const resume = h.engine.control('session', 'ACTIVE');
  await waiting;
  await h.engine.control('session', 'PAUSED', { expressGenerationPaused: true });
  release(); await assert.rejects(resume, { code: 'AGENT_CONTROL_SUPERSEDED' });
  assertBalance(h, 1080); assert.equal(h.session.expressGenerationPending, false);
});

test('recovery completes a resume after an unknown wallet response without another charge', async () => {
  const h = harness(); await h.engine.begin('session', quote()); partial(h.session);
  await h.engine.control('session', 'PAUSED', { expressGenerationPaused: true });
  h.faults.walletResponse = 1; await assert.rejects(h.engine.control('session', 'ACTIVE'));
  await h.engine.recoverControl(structuredClone(h.session));
  assertBalance(h, 2160); assert.equal(h.session.expressGenerationPending, true);
  assert.equal(h.ledger.size, 3);
});

test('pause checkpoints retain disjoint completed layers that later leave the timeline', async () => {
  const h = harness(); await h.engine.begin('session', quote());
  h.session.layers = [layer('a', 10, true)];
  await h.engine.transition('session', 'PAUSED'); await h.engine.transition('session', 'ACTIVE');
  h.session.layers = [layer('c', 20, true)];
  await h.engine.transition('session', 'FAILED');
  assertBalance(h, 30 * (2 + 20 + 1 + 1));
});

test('native audio and narrator avatar allocations require completed media', async () => {
  const h = harness(); const q = quote(); q.rates.narrator_avatar_generation = 4; q.rate += 4; q.credits += 240;
  await h.engine.begin('session', q);
  h.session.layers = [{ ...layer('a', 10), isAudioVideoLayer: true, aiVideoGenerationStatus: 'COMPLETED', aiVideoRemoteLink: 'native.mp4' }];
  h.session.narratorAvatarVideoStatus = 'COMPLETED'; h.session.narratorAvatarVideoUrl = 'avatar.mp4';
  await h.engine.transition('session', 'FAILED'); assertBalance(h, 10 * 21 + 60 * 4);
});

test('stage advancement requires a settled active funding operation', async () => {
  const h = harness(); await h.engine.begin('session', quote()); await h.engine.transition('session', 'PAUSED');
  assert.equal((await h.engine.completeStage('session', 'pipeline')).paused, true);
  assert.equal(h.session.hostedAgentBilling.completedStages.pipeline, undefined);
  assertBalance(h, 0);
});

test('concurrent deterministic ledger upsert accepts the identical winning record', async () => {
  const h = harness(); h.faults.duplicateLedger = 1;
  await h.engine.begin('session', quote()); assertBalance(h, 2160); assert.equal(h.ledger.size, 1);
});
test('completed image edits count even when the original generation status is unchanged', async () => {
  const h = harness(); await h.engine.begin('session', quote());
  h.session.layers = [{ _id: 'edited', duration: 10, imageSession: { editStatus: 'COMPLETED', activeEditedImage: 'edited.png' } }];
  await h.engine.transition('session', 'FAILED'); assertBalance(h, 20);
});

test('the interruption matrix covers every fixed-price video model and historical alias', () => {
  assert.deepEqual(Object.keys(models).sort(), Object.keys(EXPRESS_VIDEO_CREDITS_PER_SECOND_BY_MODEL).sort());
});

test('a concurrent funding retry does not fail its API limit after the winning debit is recorded', async () => {
  const h = harness(); let count = 0;
  let secondEntered; const second = new Promise(resolve => { secondEntered = resolve; });
  let firstFinished; const finished = new Promise(resolve => { firstFinished = resolve; });
  h.hooks.beforeDebit = async () => {
    count++;
    if (count === 1) { await second; return; }
    secondEntered(); await finished;
    throw Object.assign(Error('limit now includes the winning debit'), { code: 'API_KEY_USAGE_LIMIT_EXCEEDED' });
  };
  h.hooks.afterUpdate = async (_filter, update) => {
    if (update.$set?.['hostedAgentBilling.netFunded'] === 2160) firstFinished();
  };
  await Promise.all([h.engine.begin('session', quote()), h.engine.begin('session', quote())]);
  assert.equal(count, 2); assertBalance(h, 2160); assert.equal(h.ledger.size, 1);
});
