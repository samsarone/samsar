import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXPRESS_VIDEO_BILLING_STAGES,
  resolveCumulativeLayerDurationSeconds,
  resolveExpressVideoBillingDurationSeconds,
  resolveExpressVideoStageCreditsPerSecond,
} from './ExpressVideoStageBilling.js';

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
