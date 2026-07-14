import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveRequestInferenceAuthorization,
  resolveRequestInferenceModel,
  resolveRequestInferenceSettings,
  withInferenceAuthorization,
} from './RequestInferenceModel.js';

test('request model wins over session and saved user model', () => {
  assert.equal(resolveRequestInferenceModel({
    request: { inferenceModel: 'QWEN3.7' },
    session: { expressGenerationInferenceModel: 'gemini-3.1-pro' },
    user: { selectedInferenceModel: 'gpt-5.6-sol' },
  }), 'QWEN3.7');
});

test('queued payload fallback wins when the refreshed retry row has no model', () => {
  assert.equal(resolveRequestInferenceModel({
    request: {},
    fallbackRequest: { expressGenerationInferenceModel: 'QWEN3.7' },
    session: { expressGenerationInferenceModel: 'gemini-3.1-pro' },
  }), 'QWEN3.7');
});

test('session generation override wins over saved user setting', () => {
  assert.equal(resolveRequestInferenceModel({
    session: {
      expressGenerationInferenceModel: 'QWEN3.7',
      inferenceModel: 'gemini-3.1-pro',
    },
    user: { selectedInferenceModel: 'gpt-5.6-sol' },
  }), 'QWEN3.7');
});

test('falls back to saved user setting and normalizes aliases', () => {
  assert.equal(resolveRequestInferenceModel({
    user: { selectedInferenceModel: 'Qwen 3.7' },
  }), 'QWEN3.7');
});

test('inference authorization follows request, queued fallback, session, then user precedence', () => {
  assert.equal(resolveRequestInferenceAuthorization({
    request: { selectedInferenceModelAuthorization: 'native' },
    fallbackRequest: { selectedInferenceModelAuthorization: 'deployed' },
    session: { selectedInferenceModelAuthorization: 'deployed' },
    user: { selectedInferenceModelAuthorization: 'deployed' },
  }), 'native');
  assert.equal(resolveRequestInferenceAuthorization({
    fallbackRequest: { inference_model_authorization: 'deployed' },
    session: { selectedInferenceModelAuthorization: 'native' },
    user: { selectedInferenceModelAuthorization: 'native' },
  }), 'deployed');
  assert.equal(resolveRequestInferenceAuthorization({
    session: { expressGenerationInferenceModelAuthorization: 'native' },
    user: { selectedInferenceModelAuthorization: 'deployed' },
  }), 'native');
  assert.equal(resolveRequestInferenceAuthorization({
    user: { selectedInferenceModelAuthorization: 'deployed' },
  }), 'deployed');
});

test('inference settings keep authorization absent for automatic provider fallback', () => {
  assert.deepEqual(resolveRequestInferenceSettings({
    request: { inferenceModel: 'QWEN3.7' },
  }), {
    model: 'QWEN3.7',
    authorization: undefined,
  });

  const payload = { model: 'QWEN3.7', messages: [] };
  assert.equal(withInferenceAuthorization(payload), payload);
  assert.deepEqual(withInferenceAuthorization(payload, 'Samsar API Key'), {
    ...payload,
    authorization: 'deployed',
  });
});
