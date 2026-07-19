import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXPRESS_VIDEO_BILLING_STAGES,
  buildInitialExpressVideoCreditCharges,
  buildInitialReusedNarrativeExpressVideoCreditCharges,
  estimateExpressVideoCreditsForPreflight,
  resolveCumulativeLayerDurationSeconds,
  resolveExpressVideoBillingDurationSeconds,
} from './ExpressVideoStageBilling.js';

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
