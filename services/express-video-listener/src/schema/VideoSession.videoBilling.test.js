import test from 'node:test';
import assert from 'node:assert/strict';
import VideoSession from './VideoSession.js';
import AIVideoLayerGeneration from './AIVideoLayerGeneration.js';
import { buildRetryableImageToVideoQueuePayload } from '../ai_video/utils/AIVideoQueuePayload.js';
import {
  chargeExpressVideoStageCredits,
  resolveExpressVideoStageCreditsPerSecond,
} from '../ExpressVideoStageBilling.js';

const billing = {
  videoBillingPolicy: 'adapter',
  videoBillingAPIKeyUsage: { apiKeyId: 'key-1', requestId: 'request-1', nested: { caller: 'studio' } },
  videoBillingDebits: { 'provider-call': 84 },
  videoCreditsCharged: 84,
  videoRemainingCredits: 0,
};

test('Seedance agent pricing class survives hydration and tracked session assignment', () => {
  const session = VideoSession.hydrate({
    expressGenerativeVideoModel: 'SEEDANCE2.5I2V',
    expressGenerationPricingRateClass: 'agent',
  });
  assert.equal(session.expressGenerationPricingRateClass, 'agent');
  assert.equal(resolveExpressVideoStageCreditsPerSecond(session, 'ai_video_generation'), 44);
  session.expressGenerationPricingRateClass = 'vidgenie';
  assert.equal(session.toObject().expressGenerationPricingRateClass, 'vidgenie');
  assert.equal(session.isModified('expressGenerationPricingRateClass'), true);
  const historical = VideoSession.hydrate({ expressGenerativeVideoModel: 'SEEDANCE2.5I2V' });
  assert.equal(resolveExpressVideoStageCreditsPerSecond(historical, 'ai_video_generation'), 34);
});

test('persisted reroll billing fields remain directly readable after session hydration', () => {
  const session = VideoSession.hydrate({ userId: 'owner', ...billing });
  for (const [key, value] of Object.entries(billing)) assert.deepEqual(session[key], value, key);
  const payload = buildRetryableImageToVideoQueuePayload({
    videoSessionId: String(session._id), layerId: 'scene-zero', model: 'HAPPYHORSEI2V',
    videoBillingPolicy: session.videoBillingPolicy,
    videoBillingAPIKeyUsage: session.videoBillingAPIKeyUsage,
  });
  const hydratedQueue = AIVideoLayerGeneration.hydrate(new AIVideoLayerGeneration(payload).toObject());
  assert.equal(hydratedQueue.videoBillingPolicy, 'adapter');
  assert.deepEqual(hydratedQueue.videoBillingAPIKeyUsage, billing.videoBillingAPIKeyUsage);
});

test('queue hydration preserves sealed provider receipt and billing failure metadata', () => {
  const nativeReceipt = { adapter: 'alibabaCloud', model: 'happyhorse-1.1-i2v',
    seconds: 5, resolution: '720P', region: 'international', staticVideoTariffVersion: '2026-10-24' };
  const job = AIVideoLayerGeneration.hydrate({ ...billing,
    videoBillingNativeReceipt: nativeReceipt, videoBillingError: 'temporary debit outage' });
  assert.deepEqual(job.videoBillingNativeReceipt, nativeReceipt);
  assert.equal(job.videoBillingError, 'temporary debit outage');
  assert.deepEqual(job.toObject().videoBillingNativeReceipt, nativeReceipt);
});

test('F2P: newly assigned billing fields serialize on hydrated sessions and queues', () => {
  const session = VideoSession.hydrate({ userId: 'owner' });
  Object.assign(session, billing);
  for (const [key, value] of Object.entries(billing)) {
    assert.deepEqual(session.toObject()[key], value, key);
    assert.equal(session.isModified(key), true, key);
  }
  const job = AIVideoLayerGeneration.hydrate({ model: 'HAPPYHORSEI2V' });
  job.videoBillingNativeReceipt = { adapter: 'alibabaCloud', seconds: 15 };
  job.videoBillingError = 'retry debit';
  assert.deepEqual(job.toObject().videoBillingNativeReceipt, { adapter: 'alibabaCloud', seconds: 15 });
  assert.equal(job.toObject().videoBillingError, 'retry debit');
});

test('hydrated adapter rerolls bypass flat Express video, lip-sync, and sound stage debits', async () => {
  const session = VideoSession.hydrate({ userId: 'owner', ...billing });
  for (const stageKey of ['ai_video_generation', 'lip_sync_generation', 'sound_effect_generation']) {
    const result = await chargeExpressVideoStageCredits({ sessionId: 'reroll', stageKey }, {
      getDBConnectionString: async () => {},
      VideoSession: { findById: () => ({ lean: async () => session.toObject() }) },
      User: { findOneAndUpdate: async () => assert.fail('Adapter rerolls must not incur flat stage charges') },
    });
    assert.equal(result.adapterBilled, true);
    assert.equal(result.creditsCharged, 0);
  }
});

test('ordinary and historical sessions retain the pipeline queue policy without adapter opt-in', () => {
  for (const raw of [{ videoBillingPolicy: 'pipeline' }, {}]) {
    const session = VideoSession.hydrate(raw);
    const payload = buildRetryableImageToVideoQueuePayload({ model: 'RUNWAYML',
      videoBillingPolicy: session.videoBillingPolicy, videoBillingAPIKeyUsage: session.videoBillingAPIKeyUsage });
    assert.equal(payload.videoBillingPolicy, 'pipeline');
    assert.equal(payload.videoBillingAPIKeyUsage, null);
    assert.equal(session.videoCreditsCharged, undefined);
    assert.equal(session.videoBillingDebits, undefined);
  }
});
