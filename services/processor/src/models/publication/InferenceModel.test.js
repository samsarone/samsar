import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getStoredSessionInferenceModel,
  resolvePublicationMetadataInferenceModel,
} from './InferenceModel.js';

test('prefers the inference model persisted for express generation', () => {
  const sessionData = {
    expressGenerationInferenceModel: 'QWEN3.8',
    inferenceModel: 'gemini-3.1-pro',
  };

  assert.equal(getStoredSessionInferenceModel(sessionData), 'QWEN3.8');
  assert.equal(
    resolvePublicationMetadataInferenceModel(sessionData, 'gpt-5.6-sol'),
    'QWEN3.8',
  );
});

test('uses the standard or legacy persisted session inference model', () => {
  assert.equal(
    resolvePublicationMetadataInferenceModel({ inferenceModel: 'gemini-3.1-pro' }),
    'gemini-3.1-pro',
  );
  assert.equal(
    resolvePublicationMetadataInferenceModel({
      metadata: { inference_model: 'qwen3.8-max' },
    }),
    'QWEN3.8',
  );
});

test('falls back to the user inference model for older sessions', () => {
  assert.equal(
    resolvePublicationMetadataInferenceModel({}, 'gemini-3.1-pro'),
    'gemini-3.1-pro',
  );
  assert.equal(resolvePublicationMetadataInferenceModel({}), 'gpt-5.6-sol');
});
