import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_EXPRESS_STEP_MANUAL_STAGES,
  buildInitialExpressStepGeneration,
  resolveExpressStepManualStages,
} from './ExpressVideoStepState.js';

test('step video requests default to one-step auto advance', () => {
  assert.deepEqual(resolveExpressStepManualStages({}), []);

  const state = buildInitialExpressStepGeneration();
  assert.deepEqual(state.manual_step_stages, []);
  assert.deepEqual(state.manualStepStages, []);
  assert.equal(state.waiting_for_process_next, false);
});

test('explicit two-step requests keep the AI video checkpoint', () => {
  assert.deepEqual(
    resolveExpressStepManualStages({ auto_render_full_video: false }),
    DEFAULT_EXPRESS_STEP_MANUAL_STAGES,
  );

  const state = buildInitialExpressStepGeneration({
    manualStepStages: DEFAULT_EXPRESS_STEP_MANUAL_STAGES,
  });
  assert.deepEqual(state.manual_step_stages, ['ai_video_generation']);
  assert.deepEqual(state.manualStepStages, ['ai_video_generation']);
});

test('explicit one-step aliases clear manual checkpoints', () => {
  assert.deepEqual(resolveExpressStepManualStages({ auto_render_full_video: true }), []);
  assert.deepEqual(resolveExpressStepManualStages({ manual_step_stages: [] }), []);
  assert.deepEqual(resolveExpressStepManualStages({ manual_step_stages: false }), []);
});

test('explicit step mode takes precedence over stale manual stage flags', () => {
  assert.deepEqual(
    resolveExpressStepManualStages({
      generation_step_mode: 'one_step',
      auto_render_full_video: false,
      manual_step_stages: ['ai_video_generation'],
    }),
    [],
  );
  assert.deepEqual(
    resolveExpressStepManualStages({
      generationStepMode: 'two_step',
      auto_render_full_video: true,
      manual_step_stages: [],
    }),
    DEFAULT_EXPRESS_STEP_MANUAL_STAGES,
  );
});
