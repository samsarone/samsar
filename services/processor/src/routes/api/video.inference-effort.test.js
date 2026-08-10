import assert from 'node:assert/strict';
import test from 'node:test';

import { copyInferenceEffortOverrides } from './video.js';

test('image-list route preserves every supported inference effort input shape', () => {
  assert.deepEqual(copyInferenceEffortOverrides({}), {});
  assert.deepEqual(copyInferenceEffortOverrides({ effort: 'xhigh' }), {
    effort: 'xhigh',
  });
  assert.deepEqual(copyInferenceEffortOverrides({ reasoning_effort: 'xhigh' }), {
    reasoning_effort: 'xhigh',
  });
  assert.deepEqual(copyInferenceEffortOverrides({ reasoningEffort: 'xhigh' }), {
    reasoningEffort: 'xhigh',
  });
  assert.deepEqual(copyInferenceEffortOverrides({ reasoning: { effort: 'xhigh', summary: 'auto' } }), {
    reasoning: { effort: 'xhigh' },
  });
});

test('image-list route retains alias precedence inputs for downstream validation', () => {
  assert.deepEqual(copyInferenceEffortOverrides({
    effort: 'high',
    reasoning_effort: 'xhigh',
    reasoningEffort: 'xhigh',
    reasoning: { effort: 'xhigh' },
  }), {
    effort: 'high',
    reasoning_effort: 'xhigh',
    reasoningEffort: 'xhigh',
    reasoning: { effort: 'xhigh' },
  });
});
