import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import VideoSession from '../schema/VideoSession.js';
import User from '../schema/User.js';
import { buildHostedAgentQuote, calculateHostedAgentUsage } from './HostedAgentUsage.js';
import { estimateExpressVideoCreditsForPreflight, assertSufficientExpressVideoCreditsForPreflight, chargeExpressVideoStageCredits } from '../models/ExpressVideoStageBilling.js';
import { EXPRESS_VIDEO_CREDITS_PER_SECOND_BY_MODEL, getAgentVideoCreditsPerSecond } from '../consts/pricing/ExpressVideoPricingDistribution.js';

for (const model of Object.keys(EXPRESS_VIDEO_CREDITS_PER_SECOND_BY_MODEL)) {
  for (const addons of [false, true]) {
    test(`${model}: real preflight pricing reconciles ${addons ? 'CTA/avatar addons' : 'base package'}`, () => {
      const estimate = estimateExpressVideoCreditsForPreflight({ durationSeconds: 68, videoModel: model,
        pricingRateClass: 'agent', expressCtaGeneration: addons, addNarratorAvatar: addons });
      const quote = buildHostedAgentQuote(estimate);
      const rate = getAgentVideoCreditsPerSecond(model) + (addons ? 5 : 0);
      assert.equal(quote.credits, rate * 68);
      const usage = calculateHostedAgentUsage({ hostedAgentBilling: { quote }, finalVideoDurationSeconds: 56 }, 'COMPLETED');
      assert.equal(usage.totalCharged, rate * 56);
      assert.equal(quote.credits - usage.totalCharged, rate * 12);
    });
  }
}
test('reused narrative and custom providers keep their existing allocation adjustments', () => {
  const reused = buildHostedAgentQuote(estimateExpressVideoCreditsForPreflight({ durationSeconds: 60, videoModel: 'KLINGIMGTOVID4',
    pricingRateClass: 'agent', expressGenerationNarrativeReused: true, excludedStageKeys: ['narrative_inference'] }));
  assert.equal(reused.rates.narrative_inference, undefined); assert.equal(reused.rates.pipeline, 8); assert.equal(reused.credits, 2160);
  const external = buildHostedAgentQuote(estimateExpressVideoCreditsForPreflight({ durationSeconds: 60, videoModel: 'KLINGIMGTOVID4',
    pricingRateClass: 'agent', samsarExternalProviderStages: { ai_video_generation: { model: 'external' } } }));
  assert.equal(external.rates.ai_video_generation, 0); assert.equal(external.credits, 16 * 60);
});
test('v2 stage helper records allocation without legacy wallet debit', async t => {
  t.mock.method(VideoSession, 'findById', () => ({ lean: async () => ({ hostedAgentBilling: { version: 2 } }) }));
  const calls = [];
  const result = await chargeExpressVideoStageCredits({ sessionId: 'session', stageKey: 'ai_video_generation' }, {
    connect: async () => {}, shouldBypassCredits: () => false,
    completeHostedStage: async (...args) => { calls.push(args); return { ok: true, creditsCharged: 0 }; },
    deductCredits: async () => { throw Error('unexpected second debit'); },
  });
  assert.equal(result.creditsCharged, 0); assert.deepEqual(calls, [['session', 'ai_video_generation']]);
});
test('billing state survives Mongoose hydration and wallet mutation markers are private', () => {
  const session = VideoSession.hydrate({ hostedAgentBilling: { version: 2, controlRevision: 3 }, finalVideoDurationSeconds: 56 });
  assert.equal(session.hostedAgentBilling.controlRevision, 3); assert.equal(session.toObject().finalVideoDurationSeconds, 56);
  assert.equal(User.schema.path('hostedAgentCreditMutations').options.select, false);
});
test('processor and listener settlement modules remain byte-identical', t => {
  const other = new URL('../../../samsar_express_video_listener/src/billing/', import.meta.url);
  if (!existsSync(other)) { t.skip('Sibling repository not present in this checkout'); return; }
  for (const file of ['HostedAgentUsage.js', 'HostedAgentSettlement.js', 'HostedAgentRuntime.js', 'HostedAgentLimits.js']) {
    assert.equal(readFileSync(new URL(file, import.meta.url), 'utf8'), readFileSync(new URL(file, other), 'utf8'), file);
  }
});

test('hosted fractional-duration preflight requires exactly the quote, retaining provider preflight behavior', async () => {
  const options = { hostedAgentBilling: true, userId: 'owner', payload: {}, durationSeconds: 10.01,
    videoModel: 'KLINGIMGTOVID4', pricingRateClass: 'agent' };
  const deps = { shouldBypassCredits: () => false, resolveCreditBalance: async () => 361, assertAPIKeyLimit: async () => {} };
  assert.equal((await assertSufficientExpressVideoCreditsForPreflight(options, deps)).requiredCredits, 361);
  await assert.rejects(assertSufficientExpressVideoCreditsForPreflight({ ...options, payload: { isExternalUserRequest: true } }, deps), { code: 'INSUFFICIENT_CREDITS' });
});
