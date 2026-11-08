import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import User from '../../schema/User.js';
import VideoSession from '../../schema/VideoSession.js';
import Ledger from '../../schema/GenerationCreditTransaction.js';
import { admitPostProcessing } from './PostProcessingBilling.js';
import { stripInheritedBilling, postProcessingReceipt } from '../../billing/PostProcessingBilling.js';
import { chargeExpressVideoStageCredits } from '../ExpressVideoStageBilling.js';
import { EXPRESS_VIDEO_CREDITS_PER_SECOND_BY_MODEL } from '../../consts/pricing/ExpressVideoPricingDistribution.js';
import { applyUpdate, matches, query, clone } from '../../test_helpers/BillingMemoryModel.js';

function harness(t) {
  const ready = mongoose.connection.readyState; mongoose.connection.readyState = 1;
  t.after(() => { mongoose.connection.readyState = ready; });
  const user = { _id: '507f191e810c19729de860ea', generationCredits: 10000, autoRechargeEnabled: false };
  const session = { _id: '507f191e810c19729de860ef', userId: user._id, expressGenerationPending: false };
  const entries = []; const faults = {};
  for (const [Model, document] of [[User, user], [VideoSession, session]]) {
    t.mock.method(Model, 'findById', () => query(document));
    t.mock.method(Model, 'findOne', filter => query(matches(document, filter) ? document : null));
    t.mock.method(Model, 'findOneAndUpdate', (filter, update) => query(matches(document, filter) ? applyUpdate(document, update) : null));
    t.mock.method(Model, 'updateOne', async (filter, update) => {
      if (!matches(document, filter)) return { matchedCount: 0 };
      applyUpdate(document, update); return { matchedCount: 1 };
    });
  }
  t.mock.method(Ledger, 'findOne', filter => query(entries.find(item => matches(item, filter))));
  t.mock.method(Ledger.prototype, 'save', async function save() {
    if (faults.ledger) { faults.ledger--; throw Error('ledger outage'); }
    if (entries.some(entry => entry.idempotencyKey === this.idempotencyKey)) throw Object.assign(Error('duplicate'), { code: 11000 });
    entries.push(clone(this.toObject())); return this;
  });
  const admit = (priceCredits, extra = {}) => admitPostProcessing({ sessionId: session._id,
    userId: user._id, operation: 'update_outro_image', priceCredits, ...extra });
  return { user, session, entries, faults, admit };
}

for (const model of Object.keys(EXPRESS_VIDEO_CREDITS_PER_SECOND_BY_MODEL)) {
  test(`${model}: reused media transfers neither original funding nor receipts to a separately charged request`, async t => {
    const h = harness(t);
    const source = { _id: 'original', userId: h.user._id,
      hostedAgentBilling: { version: 2, sessionId: 'original', netFunded: 3600,
        quote: { model, credits: 3600 }, pendingOperation: { id: 'original-refund' } },
      postProcessingBilling: { creditsCharged: 1000, refundLimit: 1000 },
      sessionReceipt: { refunded: 3600 }, expressGenerationCreditCharges: { totalCharged: 3600, stages: { pipeline: { status: 'CHARGED' } } },
      externalRequestId: 'original-external', isExternalUserRequest: true,
      legacyProvisionalRefund: { amount: 3600 }, provisionalCredits: 3600,
      finalVideoDurationSeconds: 60, videoCreditsCharged: 3600,
      videoBillingDebits: { original: 3600 }, expressGenerationPaused: true,
      layers: [{ aiVideoLayer: 'reused.mp4', duration: 60 }], audioLayers: [{ selectedLocalAudioLink: 'reused.wav' }],
    };
    const before = clone(source);
    await h.admit(75);
    const copy = stripInheritedBilling(clone(source)); delete copy._id;
    await VideoSession.updateOne({ _id: h.session._id }, { $set: copy });
    assert.deepEqual(source, before);
    assert.deepEqual(h.session.layers, source.layers); assert.deepEqual(h.session.audioLayers, source.audioLayers);
    assert.equal(h.user.generationCredits, 9925);
    assert.equal(h.session.postProcessingBilling.sessionId, h.session._id);
    assert.equal(h.session.postProcessingBilling.creditsCharged, 75);
    assert.equal(h.session.postProcessingBilling.refundLimit, 75);
    assert.equal(h.session.hostedAgentBilling, undefined);
    assert.equal(h.session.externalRequestId, undefined);
    assert.equal(h.session.legacyProvisionalRefund, undefined);
    assert.equal(h.session.provisionalCredits, 0);
    assert.equal(h.session.finalVideoDurationSeconds, undefined);
    assert.equal(h.session.sessionReceipt.totalCharged, 75);
    assert.deepEqual(h.session.expressGenerationCreditCharges.stages, {});
    for (const stageKey of ['speech_generation', 'image_generation', 'ai_video_generation', 'lip_sync_generation', 'pipeline']) {
      const result = await chargeExpressVideoStageCredits({ sessionId: h.session._id, stageKey }, {
        connect: async () => {}, shouldBypassCredits: () => false,
        deductCredits: async () => assert.fail('No agent allocation may be charged'),
        completeHostedStage: async () => assert.fail('No source agent allocation may be recorded'),
      });
      assert.equal(result.creditsCharged, 0);
    }
    assert.equal(h.user.generationCredits, 9925);
  });
}

test('post-processing admission retries recover a paid debit after a ledger outage', async t => {
  const h = harness(t); h.faults.ledger = 1;
  await assert.rejects(h.admit(75));
  assert.equal(h.user.generationCredits, 9925);
  await Promise.all([h.admit(75), h.admit(75)]);
  assert.equal(h.user.generationCredits, 9925); assert.equal(h.entries.length, 1);
  assert.equal(h.session.postProcessingBilling.creditsCharged, 75);
  assert.equal(h.session.postProcessingBilling.status, 'FUNDED');
});

test('an insufficient balance leaves an unfunded post-processing record with no refund entitlement', async t => {
  const h = harness(t); h.user.generationCredits = 5;
  await assert.rejects(h.admit(75), { code: 'INSUFFICIENT_CREDITS' });
  assert.equal(h.user.generationCredits, 5);
  assert.equal(h.session.postProcessingBilling.refundLimit, 0);
  assert.equal(h.session.expressGenerationPending, false);
});

test('external post-processing cannot claim an internal refund for the externally reserved fee', async t => {
  const h = harness(t); await h.admit(75, { external: true });
  assert.equal(h.user.generationCredits, 10000); assert.equal(h.entries.length, 0);
  assert.equal(h.session.postProcessingBilling.priceCredits, 75);
  assert.equal(h.session.postProcessingBilling.mode, 'external');
  assert.equal(h.session.postProcessingBilling.refundLimit, 0);
});

test('a free post-processing operation has its own zero-cost receipt', async t => {
  const h = harness(t); await h.admit(0, { operation: 'add_subtitles', mode: 'free' });
  assert.equal(h.user.generationCredits, 10000);
  assert.equal(h.session.postProcessingBilling.creditsCharged, 0);
  assert.equal(postProcessingReceipt(h.session.postProcessingBilling, 'COMPLETED').totalCharged, 0);
});

test('status receipts never report refunds above this post-processing charge', () => {
  const receipt = postProcessingReceipt({ operation: 'translate_video', creditsCharged: 180, creditsRefunded: 3600 }, 'FAILED');
  assert.equal(receipt.refunded, 180); assert.equal(receipt.totalCharged, 0); assert.equal(receipt.stageBilling, false);
});
