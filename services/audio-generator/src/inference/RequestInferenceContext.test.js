import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveInferenceModelFromContext,
  resolveInferenceSettingsFromContext,
} from './RequestInferenceContext.js';

test('inference context keeps a queued request override', async () => {
  assert.equal(await resolveInferenceModelFromContext({
    request: {
      inferenceModel: 'QWEN3.7',
      sessionId: 'not-fetched-when-request-model-exists',
    },
  }), 'QWEN3.7');
});

test('inference context prefers the session override over the saved user setting', async () => {
  assert.equal(await resolveInferenceModelFromContext({
    request: {},
    session: { expressGenerationInferenceModel: 'Qwen 3.7' },
    user: { selectedInferenceModel: 'gemini-3.1-pro' },
  }), 'QWEN3.7');
});

test('inference settings resolve model and authorization independently by precedence', async () => {
  assert.deepEqual(await resolveInferenceSettingsFromContext({
    request: {
      inferenceModel: 'QWEN3.7',
      selectedInferenceModelAuthorization: 'deployed',
    },
    session: {
      expressGenerationInferenceModel: 'gemini-3.1-pro',
      selectedInferenceModelAuthorization: 'native',
    },
    user: {
      selectedInferenceModel: 'gpt-5.6-sol',
      selectedInferenceModelAuthorization: 'native',
    },
  }), {
    model: 'QWEN3.7',
    authorization: 'deployed',
  });

  assert.deepEqual(await resolveInferenceSettingsFromContext({
    request: { inferenceModel: 'QWEN3.7' },
    session: { selectedInferenceModelAuthorization: 'native' },
    user: { selectedInferenceModelAuthorization: 'deployed' },
  }), {
    model: 'QWEN3.7',
    authorization: 'native',
  });
});
