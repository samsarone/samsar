import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXPRESS_VIDEO_BILLING_STAGES,
  buildStandaloneProviderBilledStageReceipt,
  chargeExpressVideoStageCredits,
  resolveCumulativeLayerDurationSeconds,
  resolveExpressVideoBillingDurationSeconds,
  resolveExpressVideoStageCreditsPerSecond,
} from './ExpressVideoStageBilling.js';
import { shouldBypassGenerationCredits } from './utils/EnvironmentUtils.js';

function getPath(target, dottedPath) {
  return dottedPath.split('.').reduce((current, key) => current?.[key], target);
}

function setPath(target, dottedPath, value) {
  const keys = dottedPath.split('.');
  const leafKey = keys.pop();
  const parent = keys.reduce((current, key) => {
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }
    return current[key];
  }, target);
  parent[leafKey] = value;
}

function applyUpdate(target, update = {}) {
  Object.entries(update.$set || {}).forEach(([key, value]) => setPath(target, key, value));
  Object.entries(update.$inc || {}).forEach(([key, value]) => {
    setPath(target, key, Number(getPath(target, key) || 0) + Number(value));
  });
}

function createQuery(value) {
  return {
    select() {
      return this;
    },
    async lean() {
      return value;
    },
  };
}

function createVideoSessionHarness(initialSession) {
  const state = structuredClone(initialSession);
  const calls = {
    findById: 0,
    findByIdAndUpdate: [],
    findOneAndUpdate: [],
  };

  const VideoSession = {
    findById(sessionId) {
      calls.findById += 1;
      return createQuery(sessionId === state._id ? state : null);
    },
    async findByIdAndUpdate(sessionId, update) {
      calls.findByIdAndUpdate.push({ sessionId, update });
      if (sessionId !== state._id) {
        return null;
      }
      applyUpdate(state, update);
      return state;
    },
    findOneAndUpdate(filter, update) {
      calls.findOneAndUpdate.push({ filter, update });
      if (filter._id !== state._id) {
        return createQuery(null);
      }

      const statusConstraint = Object.entries(filter)
        .find(([key]) => key.endsWith('.status'));
      const excludedStatuses = statusConstraint?.[1]?.$nin || [];
      if (statusConstraint && excludedStatuses.includes(getPath(state, statusConstraint[0]))) {
        return createQuery(null);
      }

      applyUpdate(state, update);
      return createQuery(state);
    },
  };

  return { VideoSession, calls, state };
}

function createBillingDependencies(harness, { bypassCredits, remainingCredits = 100 } = {}) {
  const calls = {
    dbConnections: 0,
    bypassChecks: 0,
    internalDebits: [],
    externalOperations: [],
    transactionsConstructed: [],
    transactionsSaved: 0,
  };

  class TestGenerationCreditTransaction {
    constructor(transaction) {
      calls.transactionsConstructed.push(transaction);
    }

    async save() {
      calls.transactionsSaved += 1;
    }
  }

  const trackExternalOperation = (name, result = null) => async (...args) => {
    calls.externalOperations.push({ name, args });
    return result;
  };

  return {
    calls,
    dependencies: {
      async getDBConnectionString() {
        calls.dbConnections += 1;
      },
      VideoSession: harness.VideoSession,
      User: {
        async findOneAndUpdate(...args) {
          calls.internalDebits.push(args);
          return { generationCredits: remainingCredits };
        },
      },
      ExternalUser: {
        findById: trackExternalOperation('ExternalUser.findById'),
        findByIdAndUpdate: trackExternalOperation('ExternalUser.findByIdAndUpdate'),
        findOneAndUpdate: trackExternalOperation('ExternalUser.findOneAndUpdate'),
      },
      ExternalUserRequest: {
        findOne: trackExternalOperation('ExternalUserRequest.findOne'),
        findByIdAndUpdate: trackExternalOperation('ExternalUserRequest.findByIdAndUpdate'),
      },
      GenerationCreditTransaction: TestGenerationCreditTransaction,
      shouldBypassGenerationCredits() {
        calls.bypassChecks += 1;
        return bypassCredits;
      },
    },
  };
}

for (const stageKey of ['ai_video_generation', 'lip_sync_generation', 'sound_effect_generation']) {
  test(`usage-billed reroll ${stageKey} cannot also incur a flat agent stage debit`, async () => {
    const harness = createVideoSessionHarness({ _id: 'reroll', userId: 'owner',
      videoBillingPolicy: 'adapter', expressGenerativeVideoModel: 'RUNWAYML', totalDuration: 10 });
    const { dependencies, calls } = createBillingDependencies(harness, { bypassCredits: false });
    const result = await chargeExpressVideoStageCredits({ sessionId: 'reroll', stageKey }, dependencies);
    assert.equal(result.adapterBilled, true);
    assert.equal(result.creditsCharged, 0);
    assert.equal(calls.internalDebits.length, 0);
    assert.equal(calls.externalOperations.length, 0);
  });
}

test('standalone provider billing waives listener stage credits', () => {
  assert.equal(shouldBypassGenerationCredits({
    SAMSAR_DEPLOYMENT_EDITION: 'standalone',
    SAMSAR_RUNTIME: 'docker',
  }), true);
  assert.equal(shouldBypassGenerationCredits({
    SAMSAR_DEPLOYMENT_EDITION: 'production',
    SAMSAR_RUNTIME: 'docker',
  }), false);

  const waivedAt = new Date('2026-08-02T00:00:00.000Z');
  const receipt = buildStandaloneProviderBilledStageReceipt({
    stageKey: EXPRESS_VIDEO_BILLING_STAGES.AI_VIDEO_GENERATION,
    durationSeconds: 15,
    creditsPerSecond: 36,
    creditsCharged: 540,
    pricingAddons: { providerMarkup: 42 },
    creditDistribution: {
      stageKey: EXPRESS_VIDEO_BILLING_STAGES.AI_VIDEO_GENERATION,
      credits: 540,
      creditsPerSecond: 36,
      durationSeconds: 15,
      pricingAddons: { providerMarkup: 42 },
    },
  }, waivedAt);

  assert.equal(receipt.status, 'WAIVED');
  assert.equal(receipt.reason, 'standalone_provider_billed');
  assert.equal(receipt.creditsCharged, 0);
  assert.equal(receipt.creditsPerSecond, 0);
  assert.equal(receipt.creditDistribution.credits, 0);
  assert.equal(receipt.creditDistribution.creditsPerSecond, 0);
  assert.equal(receipt.chargedAt, waivedAt);
  assert.equal(receipt.remainingCredits, null);
  assert.equal(Object.hasOwn(receipt, 'pricingAddons'), false);
  assert.equal(Object.hasOwn(receipt.creditDistribution, 'pricingAddons'), false);
});

test('standalone stage billing is waived, side-effect-free, and idempotent', async () => {
  const harness = createVideoSessionHarness({
    _id: 'standalone-session',
    userId: 'standalone-user',
    expressGenerativeVideoModel: 'RUNWAYML',
    expressGenerationType: 'TEXT_TO_VIDEO',
    totalDuration: 15,
  });
  const { dependencies, calls } = createBillingDependencies(harness, {
    bypassCredits: true,
  });

  const firstResult = await chargeExpressVideoStageCredits({
    sessionId: harness.state._id,
    stageKey: EXPRESS_VIDEO_BILLING_STAGES.AI_VIDEO_GENERATION,
  }, dependencies);

  assert.equal(firstResult.ok, true);
  assert.equal(firstResult.creditsBypassed, true);
  assert.equal(firstResult.creditsCharged, 0);
  assert.equal(firstResult.stage.status, 'WAIVED');
  assert.equal(firstResult.stage.reason, 'standalone_provider_billed');
  assert.equal(firstResult.stage.videoGenerationModel, 'RUNWAYML');
  assert.equal(firstResult.stage.creditsCharged, 0);
  assert.equal(firstResult.stage.creditsPerSecond, 0);
  assert.equal(firstResult.stage.creditDistribution.credits, 0);
  assert.equal(firstResult.stage.creditDistribution.creditsPerSecond, 0);
  assert.equal(calls.internalDebits.length, 0);
  assert.equal(calls.externalOperations.length, 0);
  assert.equal(calls.transactionsConstructed.length, 0);
  assert.equal(calls.transactionsSaved, 0);
  assert.equal(harness.calls.findOneAndUpdate.length, 0);
  assert.equal(harness.calls.findByIdAndUpdate.length, 1);

  const secondResult = await chargeExpressVideoStageCredits({
    sessionId: harness.state._id,
    stageKey: EXPRESS_VIDEO_BILLING_STAGES.AI_VIDEO_GENERATION,
  }, dependencies);

  assert.equal(secondResult.ok, true);
  assert.equal(secondResult.alreadyCharged, true);
  assert.equal(secondResult.stage.status, 'WAIVED');
  assert.equal(harness.calls.findByIdAndUpdate.length, 1);
  assert.equal(harness.calls.findOneAndUpdate.length, 0);
  assert.equal(calls.internalDebits.length, 0);
  assert.equal(calls.externalOperations.length, 0);
  assert.equal(calls.transactionsConstructed.length, 0);
  assert.equal(calls.transactionsSaved, 0);
});

test('hosted Runway stage billing still debits and records a charged receipt', async () => {
  const harness = createVideoSessionHarness({
    _id: 'runway-hosted-session',
    userId: 'hosted-user',
    expressGenerativeVideoModel: 'RUNWAYML',
    expressGenerationType: 'TEXT_TO_VIDEO',
    totalDuration: 2,
  });
  const { dependencies, calls } = createBillingDependencies(harness, {
    bypassCredits: false,
    remainingCredits: 72,
  });

  const result = await chargeExpressVideoStageCredits({
    sessionId: harness.state._id,
    stageKey: EXPRESS_VIDEO_BILLING_STAGES.AI_VIDEO_GENERATION,
  }, dependencies);

  assert.equal(result.ok, true);
  assert.equal(result.creditsCharged, 28);
  assert.equal(result.remainingCredits, 72);
  assert.equal(result.stage.status, 'CHARGED');
  assert.equal(result.stage.creditsPerSecond, 14);
  assert.equal(result.stage.videoGenerationModel, 'RUNWAYML');
  assert.equal(harness.calls.findOneAndUpdate.length, 1);
  assert.equal(harness.calls.findByIdAndUpdate.length, 1);
  assert.equal(calls.internalDebits.length, 1);
  assert.equal(calls.externalOperations.length, 0);
  assert.equal(calls.transactionsConstructed.length, 1);
  assert.equal(calls.transactionsConstructed[0].amount, 28);
  assert.equal(calls.transactionsSaved, 1);
  assert.equal(harness.state.expressGenerationCreditCharges.totalCharged, 28);
});

for (const [rateClass, totalRate, videoRate] of [
  ['agent', 60, 44],
  ['vidgenie', 60, 44],
  [' Agent ', 60, 44],
  ['studio', 50, 34],
  [undefined, 50, 34],
  ['unknown', 50, 34],
]) {
  test(`Seedance 2.5 ${rateClass ?? 'historical'} stage settlement uses its quoted workflow rate`, async () => {
    const harness = createVideoSessionHarness({
      _id: 'seedance-hosted-session',
      userId: 'hosted-user',
      expressGenerativeVideoModel: 'SEEDANCE2.5I2V',
      expressGenerationPricingRateClass: rateClass,
      expressGenerationBillingDurationSeconds: 10,
    });
    const { dependencies, calls } = createBillingDependencies(harness, { bypassCredits: false });
    const stages = Object.values(EXPRESS_VIDEO_BILLING_STAGES)
      .filter(stage => stage !== EXPRESS_VIDEO_BILLING_STAGES.NARRATOR_AVATAR_GENERATION);

    for (const stageKey of stages) {
      const result = await chargeExpressVideoStageCredits({ sessionId: harness.state._id, stageKey }, dependencies);
      assert.equal(result.ok, true);
    }

    const videoReceipt = harness.state.expressGenerationCreditCharges.stages.ai_video_generation;
    assert.equal(videoReceipt.creditsPerSecond, videoRate);
    assert.equal(videoReceipt.creditsCharged, 10 * videoRate);
    assert.equal(harness.state.expressGenerationCreditCharges.totalCharged, 10 * totalRate);
    assert.equal(calls.internalDebits.reduce((sum, args) => sum - args[1].$inc.generationCredits, 0), 10 * totalRate);

    const repeated = await chargeExpressVideoStageCredits({
      sessionId: harness.state._id,
      stageKey: EXPRESS_VIDEO_BILLING_STAGES.AI_VIDEO_GENERATION,
    }, dependencies);
    assert.equal(repeated.alreadyCharged, true);
    assert.equal(calls.internalDebits.length, stages.length);
    assert.equal(calls.transactionsSaved, stages.length);
  });
}

test('a previously charged Seedance agent stage is not repriced or deducted again', async () => {
  const previousReceipt = { status: 'CHARGED', creditsPerSecond: 34, creditsCharged: 340 };
  const harness = createVideoSessionHarness({
    _id: 'previous-seedance-session',
    userId: 'owner',
    expressGenerativeVideoModel: 'SEEDANCE2.5I2V',
    expressGenerationPricingRateClass: 'agent',
    expressGenerationBillingDurationSeconds: 10,
    expressGenerationCreditCharges: { totalCharged: 340, stages: { ai_video_generation: previousReceipt } },
  });
  const { dependencies, calls } = createBillingDependencies(harness, { bypassCredits: false });
  const result = await chargeExpressVideoStageCredits({
    sessionId: harness.state._id,
    stageKey: EXPRESS_VIDEO_BILLING_STAGES.AI_VIDEO_GENERATION,
  }, dependencies);

  assert.equal(result.alreadyCharged, true);
  assert.deepEqual(result.stage, previousReceipt);
  assert.equal(harness.state.expressGenerationCreditCharges.totalCharged, 340);
  assert.equal(calls.internalDebits.length, 0);
  assert.equal(harness.calls.findByIdAndUpdate.length, 0);
});

test('Seedance agent pricing still bypasses standalone and adapter-billed video charges', async () => {
  for (const mode of ['standalone', 'adapter']) {
    const harness = createVideoSessionHarness({
      _id: 'provider-billed-seedance',
      userId: 'owner',
      expressGenerativeVideoModel: 'SEEDANCE2.5I2V',
      expressGenerationPricingRateClass: 'agent',
      expressGenerationBillingDurationSeconds: 10,
      ...(mode === 'adapter' ? { videoBillingPolicy: 'adapter' } : {}),
    });
    const { dependencies, calls } = createBillingDependencies(harness, { bypassCredits: mode === 'standalone' });
    const result = await chargeExpressVideoStageCredits({
      sessionId: harness.state._id,
      stageKey: EXPRESS_VIDEO_BILLING_STAGES.AI_VIDEO_GENERATION,
    }, dependencies);
    assert.equal(result.ok, true);
    assert.equal(result.creditsCharged, 0);
    assert.equal(calls.internalDebits.length, 0);
    assert.equal(calls.externalOperations.length, 0);
    assert.equal(calls.transactionsSaved, 0);
  }
});

test('agent rate selection preserves other video models and reused narrative allocations', () => {
  for (const [model, expectedRate] of [
    ['RUNWAYML', 30], ['VEO3.1I2V', 60], ['VEO3.1I2VFAST', 36], ['COSMOS3SUPERI2V', 20],
    ['SEEDANCEI2V', 30], ['SEEDANCE2.0I2V', 40], ['KLINGIMGTOVID4', 36],
    ['KLINGIMGTOVID3PRO', 36], ['KLINGIMGTOVIDTURBO', 36], ['HAPPYHORSEI2V', 36],
  ]) {
    for (const rateClass of ['studio', 'agent', 'vidgenie']) {
      const session = { expressGenerativeVideoModel: model, expressGenerationPricingRateClass: rateClass };
      assert.equal(resolveExpressVideoStageCreditsPerSecond(session, 'ai_video_generation'), expectedRate - 16, model);
    }
  }
  const reusedSession = {
    expressGenerativeVideoModel: 'SEEDANCE2.5I2V',
    expressGenerationPricingRateClass: 'agent',
    expressGenerationNarrativeReused: true,
  };
  const chargedStages = Object.values(EXPRESS_VIDEO_BILLING_STAGES)
    .filter(stage => !['narrator_avatar_generation', 'narrative_inference'].includes(stage));
  assert.equal(chargedStages.reduce((total, stage) => total + resolveExpressVideoStageCreditsPerSecond(reusedSession, stage), 0), 60);
});

test('custom stage remains CUSTOM_SUCCEEDED before standalone bypass handling', async () => {
  const customOperation = { adapterId: 'custom-video-adapter', operation: 'image_to_video' };
  const harness = createVideoSessionHarness({
    _id: 'custom-stage-session',
    userId: 'custom-user',
    expressGenerativeVideoModel: 'RUNWAYML',
    expressGenerationType: 'TEXT_TO_VIDEO',
    totalDuration: 8,
    customAdapterOperationUsage: {
      [EXPRESS_VIDEO_BILLING_STAGES.AI_VIDEO_GENERATION]: customOperation,
    },
  });
  const { dependencies, calls } = createBillingDependencies(harness, {
    bypassCredits: true,
  });

  const result = await chargeExpressVideoStageCredits({
    sessionId: harness.state._id,
    stageKey: EXPRESS_VIDEO_BILLING_STAGES.AI_VIDEO_GENERATION,
  }, dependencies);

  assert.equal(result.ok, true);
  assert.equal(result.customOperation, true);
  assert.equal(result.creditsCharged, 0);
  assert.equal(result.stage.status, 'CUSTOM_SUCCEEDED');
  assert.equal(result.stage.creditsCharged, 0);
  assert.equal(result.stage.creditsPerSecond, 0);
  assert.equal(result.stage.creditDistribution.credits, 0);
  assert.equal(result.stage.creditDistribution.creditsPerSecond, 0);
  assert.equal(Object.hasOwn(result.stage, 'pricingAddons'), false);
  assert.equal(Object.hasOwn(result.stage.creditDistribution, 'pricingAddons'), false);
  assert.deepEqual(result.stage.customOperation, customOperation);
  assert.equal(
    harness.state.expressGenerationCustomStageResults.ai_video_generation.status,
    'CUSTOM_SUCCEEDED',
  );
  assert.equal(calls.bypassChecks, 1);
  assert.equal(calls.internalDebits.length, 0);
  assert.equal(calls.externalOperations.length, 0);
  assert.equal(calls.transactionsConstructed.length, 0);
  assert.equal(calls.transactionsSaved, 0);
});

test('branched stage billing freezes the materialized cumulative duration across retiming', () => {
  const session = {
    narrativeType: 'branched',
    layers: [
      { _id: 'shared', duration: 4 },
      { _id: 'left', duration: 6 },
      { _id: 'right', duration: 8 },
      { _id: 'outro', duration: 8 },
      { _id: 'shared', duration: 4 },
    ],
    expressGenerationBillingDurationSeconds: 12,
    expressGenerationBillingStageDurations: { pipeline: 22 },
  };

  assert.equal(resolveCumulativeLayerDurationSeconds(session), 26);
  assert.equal(
    resolveExpressVideoBillingDurationSeconds(session, EXPRESS_VIDEO_BILLING_STAGES.PIPELINE),
    12,
  );
  assert.equal(
    resolveExpressVideoBillingDurationSeconds(session, EXPRESS_VIDEO_BILLING_STAGES.AI_VIDEO_GENERATION),
    12,
  );

  delete session.expressGenerationBillingDurationSeconds;
  assert.equal(
    resolveExpressVideoBillingDurationSeconds(session, EXPRESS_VIDEO_BILLING_STAGES.PIPELINE),
    26,
  );
});

test('reused narrative rendering reallocates the waived inference rate to the render pipeline', () => {
  const session = {
    expressGenerativeVideoModel: 'RUNWAYML',
    expressGenerationNarrativeReused: true,
  };
  assert.equal(
    resolveExpressVideoStageCreditsPerSecond(
      session,
      EXPRESS_VIDEO_BILLING_STAGES.PIPELINE,
    ),
    8,
  );
  assert.equal(
    resolveExpressVideoStageCreditsPerSecond(
      { ...session, expressGenerationNarrativeReused: false },
      EXPRESS_VIDEO_BILLING_STAGES.PIPELINE,
    ),
    4,
  );
  assert.equal([
    EXPRESS_VIDEO_BILLING_STAGES.IMAGE_GENERATION,
    EXPRESS_VIDEO_BILLING_STAGES.SPEECH_GENERATION,
    EXPRESS_VIDEO_BILLING_STAGES.MUSIC_GENERATION,
    EXPRESS_VIDEO_BILLING_STAGES.SOUND_EFFECT_GENERATION,
    EXPRESS_VIDEO_BILLING_STAGES.LIP_SYNC_GENERATION,
    EXPRESS_VIDEO_BILLING_STAGES.AI_VIDEO_GENERATION,
    EXPRESS_VIDEO_BILLING_STAGES.PIPELINE,
  ].reduce((total, stageKey) => (
    total + resolveExpressVideoStageCreditsPerSecond(session, stageKey)
  ), 0), 30);
});

test('singular listener billing retains its existing stage override behavior', () => {
  const session = {
    narrativeType: 'singular',
    layers: [{ _id: 'linear', duration: 10 }],
    expressGenerationBillingDurationSeconds: 10,
    expressGenerationBillingStageDurations: { pipeline: 14 },
  };

  assert.equal(
    resolveExpressVideoBillingDurationSeconds(session, EXPRESS_VIDEO_BILLING_STAGES.PIPELINE),
    14,
  );
  assert.equal(resolveExpressVideoBillingDurationSeconds(session), 10);
});
