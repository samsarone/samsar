import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveBackingTrackRetryInferenceModel,
  resolveBackingTrackRetryInferenceSettings,
} from './BackingTrackPromptUtils.js';

test('backing-track retry keeps the queued request inference model', async () => {
  assert.equal(await resolveBackingTrackRetryInferenceModel({
    request: {
      inferenceModel: 'QWEN3.8',
      sessionId: 'not-fetched-when-request-model-exists',
    },
  }), 'QWEN3.8');
});

test('backing-track retry uses a session override before the saved user model', async () => {
  assert.equal(await resolveBackingTrackRetryInferenceModel({
    request: {},
    session: { expressGenerationInferenceModel: 'QWEN3.8' },
    user: { selectedInferenceModel: 'gemini-3.1-pro' },
  }), 'QWEN3.8');
});

test('backing-track retry carries the matching authorization precedence', async () => {
  assert.deepEqual(await resolveBackingTrackRetryInferenceSettings({
    request: { inferenceModel: 'QWEN3.8' },
    session: { selectedInferenceModelAuthorization: 'deployed' },
    user: { selectedInferenceModelAuthorization: 'native' },
  }), {
    model: 'QWEN3.8',
    authorization: 'deployed',
  });
});
