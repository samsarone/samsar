import assert from 'node:assert/strict';
import test from 'node:test';

import VideoSession from '../schema/VideoSession.js';
import {
  EXPRESS_VIDEO_BILLING_STAGES,
  buildStandaloneProviderBilledEstimate,
  buildStandaloneProviderBilledStageReceipt,
  buildInitialExpressVideoCreditCharges,
  buildInitialReusedNarrativeExpressVideoCreditCharges,
  assertSufficientExpressVideoCreditsForPreflight,
  chargeExpressVideoStageCredits,
  estimateExpressVideoCreditsForPreflight,
  resolveCumulativeLayerDurationSeconds,
  resolveExpressVideoBillingDurationSeconds,
} from './ExpressVideoStageBilling.js';

const EDITION_ENV_KEYS = [
  'SAMSAR_DEPLOYMENT_EDITION',
  'SAMSAR_EDITION',
  'CURRENT_ENV',
];

function setDeploymentEditionForTest(t, edition) {
  const snapshot = Object.fromEntries(
    EDITION_ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  process.env.SAMSAR_DEPLOYMENT_EDITION = edition;
  delete process.env.SAMSAR_EDITION;
  process.env.CURRENT_ENV = edition === 'standalone' ? 'docker' : 'production';
  t.after(() => {
    for (const key of EDITION_ENV_KEYS) {
      if (snapshot[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = snapshot[key];
      }
    }
  });
}

function setObjectPath(target, dottedPath, value) {
  const parts = dottedPath.split('.');
  let current = target;
  for (const part of parts.slice(0, -1)) {
    if (!current[part] || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts.at(-1)] = structuredClone(value);
}

function getObjectPath(target, dottedPath) {
  return dottedPath.split('.').reduce((value, part) => value?.[part], target);
}

function applyMongoUpdate(target, update = {}) {
  for (const [path, value] of Object.entries(update.$set || {})) {
    setObjectPath(target, path, value);
  }
  for (const [path, value] of Object.entries(update.$inc || {})) {
    setObjectPath(target, path, (Number(getObjectPath(target, path)) || 0) + Number(value));
  }
}

function installVideoSessionBillingHarness(t, initialSession) {
  const session = structuredClone(initialSession);
  const updates = [];
  const claims = [];

  t.mock.method(VideoSession, 'findById', () => ({
    select() {
      return this;
    },
    lean: async () => structuredClone(session),
  }));
  t.mock.method(VideoSession, 'findByIdAndUpdate', async (_sessionId, update) => {
    updates.push(structuredClone(update));
    applyMongoUpdate(session, update);
    return structuredClone(session);
  });
  t.mock.method(VideoSession, 'findOneAndUpdate', (_filter, update) => ({
    lean: async () => {
      claims.push(structuredClone(update));
      applyMongoUpdate(session, update);
      return structuredClone(session);
    },
  }));

  return {
    claims,
    getSession: () => structuredClone(session),
    updates,
  };
}

test('standalone provider-billed sessions expose no Samsar credit pricing', () => {
  assert.deepEqual(buildStandaloneProviderBilledEstimate(15), {
    durationSeconds: 15,
    totalCredits: 0,
    stages: {},
    requiredCredits: 0,
    availableCredits: null,
    creditsBypassed: true,
  });

  const waivedAt = new Date('2026-08-02T00:00:00.000Z');
  const receipt = buildStandaloneProviderBilledStageReceipt({
    stageKey: EXPRESS_VIDEO_BILLING_STAGES.AI_VIDEO_GENERATION,
    durationSeconds: 15,
    creditsPerSecond: 36,
    baseCreditsPerSecond: 36,
    surchargeCreditsPerSecond: 2,
    creditsCharged: 570,
    pricingAddons: {
      express_cta_generation: 2,
    },
    creditDistribution: {
      stageKey: EXPRESS_VIDEO_BILLING_STAGES.AI_VIDEO_GENERATION,
      credits: 570,
      creditsPerSecond: 38,
      durationSeconds: 15,
      pricingAddons: {
        express_cta_generation: 2,
      },
    },
  }, waivedAt);

  assert.equal(receipt.status, 'WAIVED');
  assert.equal(receipt.reason, 'standalone_provider_billed');
  assert.equal(receipt.creditsCharged, 0);
  assert.equal(receipt.creditsPerSecond, 0);
  assert.equal(receipt.baseCreditsPerSecond, 0);
  assert.equal(receipt.surchargeCreditsPerSecond, 0);
  assert.equal(receipt.creditDistribution.credits, 0);
  assert.equal(receipt.creditDistribution.creditsPerSecond, 0);
  assert.equal(Object.hasOwn(receipt, 'pricingAddons'), false);
  assert.equal(Object.hasOwn(receipt.creditDistribution, 'pricingAddons'), false);
  assert.equal(receipt.chargedAt, waivedAt);
  assert.equal(receipt.remainingCredits, null);
});

test('standalone preflight bypasses balance and API-key limit admission', async (t) => {
  setDeploymentEditionForTest(t, 'standalone');
  let balanceChecks = 0;
  let apiLimitChecks = 0;

  const result = await assertSufficientExpressVideoCreditsForPreflight({
    userId: '507f191e810c19729de860ea',
    payload: {
      apiKeyUsage: {
        apiKeyId: '507f1f77bcf86cd799439011',
        apiKeyUsageLimit: 0,
      },
    },
    routeType: 'text_to_video',
    durationSeconds: 15,
    videoModel: 'RUNWAYML',
    imageModel: 'GPTIMAGE2',
    expressGenerationType: 'TEXT_TO_VIDEO',
    expressCtaGeneration: true,
  }, {
    resolveCreditBalance: async () => {
      balanceChecks += 1;
      throw new Error('standalone preflight must not read a Samsar balance');
    },
    assertAPIKeyLimit: async () => {
      apiLimitChecks += 1;
      throw new Error('standalone preflight must not enforce a Samsar API credit limit');
    },
  });

  assert.deepEqual(result, {
    durationSeconds: 15,
    totalCredits: 0,
    stages: {},
    requiredCredits: 0,
    availableCredits: null,
    creditsBypassed: true,
  });
  assert.equal(balanceChecks, 0);
  assert.equal(apiLimitChecks, 0);
});

test('hosted preflight still checks balance and API-key admission', async (t) => {
  setDeploymentEditionForTest(t, 'production');
  const calls = [];

  const result = await assertSufficientExpressVideoCreditsForPreflight({
    userId: '507f191e810c19729de860ea',
    payload: {
      apiKeyUsage: {
        apiKeyId: '507f1f77bcf86cd799439011',
        apiKeyUsageLimit: 1000,
      },
    },
    routeType: 'text_to_video',
    durationSeconds: 10,
    videoModel: 'RUNWAYML',
    imageModel: 'GPTIMAGE2',
    expressGenerationType: 'TEXT_TO_VIDEO',
  }, {
    resolveCreditBalance: async (userId) => {
      calls.push({ type: 'balance', userId });
      return 1000;
    },
    assertAPIKeyLimit: async (userId, credits, options) => {
      calls.push({ type: 'api_limit', userId, credits, options });
    },
  });

  assert.equal(result.requiredCredits, 300);
  assert.equal(result.availableCredits, 1000);
  assert.equal(result.creditsBypassed, undefined);
  assert.deepEqual(calls, [
    { type: 'balance', userId: '507f191e810c19729de860ea' },
    {
      type: 'api_limit',
      userId: '507f191e810c19729de860ea',
      credits: 300,
      options: { apiKeyId: '507f1f77bcf86cd799439011' },
    },
  ]);
});

test('standalone stage billing is waived, zero-cost, and idempotent', async (t) => {
  setDeploymentEditionForTest(t, 'standalone');
  const harness = installVideoSessionBillingHarness(t, {
    _id: '507f1f77bcf86cd799439012',
    userId: '507f191e810c19729de860ea',
    expressGenerativeVideoModel: 'RUNWAYML',
    expressGenerationType: 'TEXT_TO_VIDEO',
    expressCtaGeneration: true,
    expressGenerationBillingDurationSeconds: 15,
    expressGenerationCreditCharges: {
      version: 1,
      durationSeconds: 15,
      totalCharged: 0,
      stages: {},
    },
  });
  let debitCalls = 0;
  const dependencies = {
    connect: async () => {},
    deductCredits: async () => {
      debitCalls += 1;
      throw new Error('standalone stage billing must not debit Samsar credits');
    },
  };

  const first = await chargeExpressVideoStageCredits({
    sessionId: '507f1f77bcf86cd799439012',
    stageKey: EXPRESS_VIDEO_BILLING_STAGES.NARRATIVE_INFERENCE,
    requestType: 'API',
  }, dependencies);
  const second = await chargeExpressVideoStageCredits({
    sessionId: '507f1f77bcf86cd799439012',
    stageKey: EXPRESS_VIDEO_BILLING_STAGES.NARRATIVE_INFERENCE,
    requestType: 'API',
  }, dependencies);

  assert.equal(first.ok, true);
  assert.equal(first.creditsBypassed, true);
  assert.equal(first.creditsCharged, 0);
  assert.equal(first.stage.status, 'WAIVED');
  assert.equal(first.stage.reason, 'standalone_provider_billed');
  assert.equal(first.stage.creditsPerSecond, 0);
  assert.equal(first.stage.creditDistribution.credits, 0);
  assert.equal(Object.hasOwn(first.stage, 'pricingAddons'), false);
  assert.equal(second.ok, true);
  assert.equal(second.alreadyCharged, true);
  assert.equal(second.stage.status, 'WAIVED');
  assert.equal(debitCalls, 0);
  assert.equal(harness.claims.length, 0);
  assert.equal(harness.updates.length, 1);
  assert.equal(harness.getSession().expressGenerationCreditCharges.totalCharged, 0);
});

test('hosted Express stage billing still debits and records a charged receipt', async (t) => {
  setDeploymentEditionForTest(t, 'production');
  const harness = installVideoSessionBillingHarness(t, {
    _id: '507f1f77bcf86cd799439012',
    userId: '507f191e810c19729de860ea',
    expressGenerativeVideoModel: 'RUNWAYML',
    expressGenerationType: 'TEXT_TO_VIDEO',
    expressCtaGeneration: true,
    expressGenerationBillingDurationSeconds: 10,
    expressGenerationCreditCharges: {
      version: 1,
      durationSeconds: 10,
      totalCharged: 0,
      stages: {},
    },
  });
  const debitCalls = [];

  const result = await chargeExpressVideoStageCredits({
    sessionId: '507f1f77bcf86cd799439012',
    stageKey: EXPRESS_VIDEO_BILLING_STAGES.NARRATIVE_INFERENCE,
    requestType: 'API',
  }, {
    connect: async () => {},
    deductCredits: async (userId, credits, options) => {
      debitCalls.push({ userId, credits, options });
      return { remainingCredits: 950 };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.creditsCharged, 50);
  assert.equal(result.remainingCredits, 950);
  assert.equal(result.stage.status, 'CHARGED');
  assert.deepEqual(result.stage.pricingAddons, { express_cta_generation: 1 });
  assert.equal(harness.claims.length, 1);
  assert.equal(harness.getSession().expressGenerationCreditCharges.totalCharged, 50);
  assert.equal(debitCalls.length, 1);
  assert.equal(debitCalls[0].userId, '507f191e810c19729de860ea');
  assert.equal(debitCalls[0].credits, 50);
  assert.equal(debitCalls[0].options.source, 'express_video_stage_narrative_inference');
});

test('standalone custom stages retain custom-success bookkeeping before credit waiver', async (t) => {
  setDeploymentEditionForTest(t, 'standalone');
  const customOperation = {
    adapterId: 'custom-image-adapter',
    operation: 'text_to_image',
  };
  const harness = installVideoSessionBillingHarness(t, {
    _id: '507f1f77bcf86cd799439012',
    userId: '507f191e810c19729de860ea',
    expressGenerativeVideoModel: 'RUNWAYML',
    expressGenerationImageModel: 'CUSTOM_TEXT_TO_IMAGE:custom-image-adapter',
    expressGenerationType: 'TEXT_TO_VIDEO',
    expressGenerationBillingDurationSeconds: 15,
    customAdapterOperationUsage: {
      [EXPRESS_VIDEO_BILLING_STAGES.IMAGE_GENERATION]: customOperation,
    },
    expressGenerationCreditCharges: {
      version: 1,
      durationSeconds: 15,
      totalCharged: 0,
      stages: {},
    },
  });
  let debitCalls = 0;

  const result = await chargeExpressVideoStageCredits({
    sessionId: '507f1f77bcf86cd799439012',
    stageKey: EXPRESS_VIDEO_BILLING_STAGES.IMAGE_GENERATION,
  }, {
    connect: async () => {},
    deductCredits: async () => {
      debitCalls += 1;
    },
  });

  const savedSession = harness.getSession();
  assert.equal(result.ok, true);
  assert.equal(result.customOperation, true);
  assert.equal(result.creditsCharged, 0);
  assert.equal(result.creditsBypassed, true);
  assert.equal(result.stage.status, 'CUSTOM_SUCCEEDED');
  assert.deepEqual(result.stage.customOperation, customOperation);
  assert.equal(result.stage.creditsPerSecond, 0);
  assert.equal(result.stage.baseCreditsPerSecond, 0);
  assert.equal(result.stage.surchargeCreditsPerSecond, 0);
  assert.equal(result.stage.creditDistribution.credits, 0);
  assert.equal(result.stage.creditDistribution.creditsPerSecond, 0);
  assert.equal(Object.hasOwn(result.stage, 'pricingAddons'), false);
  assert.equal(
    savedSession.expressGenerationCustomStageResults.image_generation.status,
    'CUSTOM_SUCCEEDED',
  );
  assert.ok(savedSession.expressGenerationCustomStageResults.image_generation.completedAt);
  assert.equal(debitCalls, 0);
  assert.equal(harness.claims.length, 0);
});

test('branched sessions freeze every stage to the materialized cumulative layer duration', () => {
  const session = {
    narrativeType: 'branched',
    layers: [
      { _id: 'shared-parent', duration: 7 },
      { _id: 'left-leaf', duration: 6 },
      { _id: 'right-leaf', duration: 8 },
      { _id: 'shared-outro', duration: 8 },
      { _id: 'shared-parent', duration: 7 },
    ],
    expressGenerationBillingDurationSeconds: 29,
    expressGenerationBillingStageDurations: {
      image_generation: 55,
      music_generation: 30,
      pipeline: 120,
    },
  };

  assert.equal(
    resolveExpressVideoBillingDurationSeconds(session, EXPRESS_VIDEO_BILLING_STAGES.IMAGE_GENERATION),
    29,
  );
  assert.equal(
    resolveExpressVideoBillingDurationSeconds(session, EXPRESS_VIDEO_BILLING_STAGES.MUSIC_GENERATION),
    29,
  );
  assert.equal(
    resolveExpressVideoBillingDurationSeconds(session, EXPRESS_VIDEO_BILLING_STAGES.PIPELINE),
    29,
  );
  assert.equal(resolveExpressVideoBillingDurationSeconds(session), 29);
  assert.equal(resolveCumulativeLayerDurationSeconds(session), 29);

  const fallbackSession = { ...session };
  delete fallbackSession.expressGenerationBillingDurationSeconds;
  assert.equal(
    resolveExpressVideoBillingDurationSeconds(
      fallbackSession,
      EXPRESS_VIDEO_BILLING_STAGES.PIPELINE,
    ),
    29,
  );
});

test('singular sessions retain configured and stage-specific duration billing', () => {
  const session = {
    narrativeType: 'singular',
    expressGenerationBillingDurationSeconds: 30,
    expressGenerationBillingStageDurations: {
      image_generation: 55,
      pipeline: 120,
    },
  };

  assert.equal(
    resolveExpressVideoBillingDurationSeconds(session, EXPRESS_VIDEO_BILLING_STAGES.IMAGE_GENERATION),
    55,
  );
  assert.equal(
    resolveExpressVideoBillingDurationSeconds(session, EXPRESS_VIDEO_BILLING_STAGES.PIPELINE),
    120,
  );
  assert.equal(resolveExpressVideoBillingDurationSeconds(session), 30);
});

test('NarrativeRequest-backed render preflight applies the full express model unit rate', () => {
  const estimate = estimateExpressVideoCreditsForPreflight({
    durationSeconds: 29,
    videoModel: 'RUNWAYML',
    expressGenerationNarrativeReused: true,
    excludedStageKeys: [EXPRESS_VIDEO_BILLING_STAGES.NARRATIVE_INFERENCE],
  });

  assert.equal(estimate.durationSeconds, 29);
  assert.equal(estimate.stages[EXPRESS_VIDEO_BILLING_STAGES.PIPELINE].creditsPerSecond, 8);
  assert.equal(estimate.totalCredits, 29 * 30);
});

test('preflight estimates retain all stages when exclusions are not provided', () => {
  const input = {
    durationSeconds: 30,
    videoModel: 'RUNWAYML',
    imageModel: 'GPTIMAGE2',
    backingTrackModel: 'ELEVENLABS_MUSIC',
    expressGenerationType: 'TEXT_TO_VIDEO',
    expressCtaGeneration: true,
  };

  const defaultEstimate = estimateExpressVideoCreditsForPreflight(input);
  const emptyExclusionEstimate = estimateExpressVideoCreditsForPreflight({
    ...input,
    excludedStageKeys: [],
  });

  assert.deepEqual(emptyExclusionEstimate, defaultEstimate);
  assert.ok(defaultEstimate.stages[EXPRESS_VIDEO_BILLING_STAGES.NARRATIVE_INFERENCE]);
});

test('preflight estimates exclude narrative inference from stages and total credits', () => {
  const input = {
    durationSeconds: 30,
    videoModel: 'RUNWAYML',
    imageModel: 'GPTIMAGE2',
    backingTrackModel: 'ELEVENLABS_MUSIC',
    expressGenerationType: 'TEXT_TO_VIDEO',
    expressCtaGeneration: true,
  };
  const baseline = estimateExpressVideoCreditsForPreflight(input);
  const narrativeStage = baseline.stages[EXPRESS_VIDEO_BILLING_STAGES.NARRATIVE_INFERENCE];
  const excluded = estimateExpressVideoCreditsForPreflight({
    ...input,
    excludedStageKeys: new Set([' NARRATIVE_INFERENCE ']),
  });

  assert.ok(narrativeStage.creditsCharged > 0);
  assert.equal(
    excluded.totalCredits,
    baseline.totalCredits - narrativeStage.creditsCharged,
  );
  assert.equal(
    Object.hasOwn(excluded.stages, EXPRESS_VIDEO_BILLING_STAGES.NARRATIVE_INFERENCE),
    false,
  );
  assert.equal(excluded.durationSeconds, baseline.durationSeconds);
});

test('reused narrative initial charges waive narrative inference without changing the base helper', () => {
  const sourceNarrativeRequestId = {
    toString() {
      return ' 6a5b4ebc50bad523109f66e7 ';
    },
  };
  const charges = buildInitialReusedNarrativeExpressVideoCreditCharges(
    '30',
    sourceNarrativeRequestId,
  );
  const narrativeStage = charges.stages[EXPRESS_VIDEO_BILLING_STAGES.NARRATIVE_INFERENCE];

  assert.deepEqual(buildInitialExpressVideoCreditCharges('30'), {
    version: 1,
    durationSeconds: 30,
    totalCharged: 0,
    stages: {},
  });
  assert.equal(charges.version, 1);
  assert.equal(charges.durationSeconds, 30);
  assert.equal(charges.totalCharged, 0);
  assert.deepEqual(narrativeStage, {
    stageKey: 'narrative_inference',
    statusKey: 'prompt_generation',
    stageLabel: 'Narrative inference',
    status: 'WAIVED',
    reason: 'reused_narrative_request',
    sourceNarrativeRequestId: '6a5b4ebc50bad523109f66e7',
    durationSeconds: 30,
    creditsPerSecond: 0,
    creditsCharged: 0,
    creditDistribution: {
      stageKey: 'narrative_inference',
      stageLabel: 'Narrative inference',
      credits: 0,
      creditsPerSecond: 0,
      durationSeconds: 30,
    },
  });
});
