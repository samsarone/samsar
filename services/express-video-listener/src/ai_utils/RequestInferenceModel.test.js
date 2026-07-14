import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveRequestInferenceAuthorization,
  resolveRequestInferenceModel,
} from './RequestInferenceModel.js';

test('an explicit request model wins over session and saved user settings', () => {
  assert.equal(resolveRequestInferenceModel({
    request: { inferenceModel: 'QWEN3.7' },
    session: { expressGenerationInferenceModel: 'gemini-3.1-pro' },
    user: { selectedInferenceModel: 'gpt-5.6-sol' },
  }), 'QWEN3.7');
});

test('the express session model wins over the account setting and generic session model', () => {
  assert.equal(resolveRequestInferenceModel({
    session: {
      expressGenerationInferenceModel: 'QWEN3.7',
      inferenceModel: 'gemini-3.1-pro',
    },
    user: { selectedInferenceModel: 'gpt-5.6-sol' },
  }), 'QWEN3.7');
});

test('falls back to the account setting and normalizes display labels', () => {
  assert.equal(resolveRequestInferenceModel({
    user: { selectedInferenceModel: 'Qwen 3.7' },
  }), 'QWEN3.7');
});

test('request authorization wins over express session and account settings', () => {
  assert.equal(resolveRequestInferenceAuthorization({
    request: { selectedInferenceModelAuthorization: 'native' },
    session: { expressGenerationInferenceModelAuthorization: 'deployed' },
    user: { selectedInferenceModelAuthorization: 'deployed' },
  }), 'native');
});

test('express session authorization wins over generic session authorization', () => {
  assert.equal(resolveRequestInferenceAuthorization({
    session: {
      expressGenerationInferenceModelAuthorization: 'deployed',
      inferenceModelAuthorization: 'native',
    },
    user: { selectedInferenceModelAuthorization: 'native' },
  }), 'deployed');
});

test('authorization falls back to the account and remains absent when not configured', () => {
  assert.equal(resolveRequestInferenceAuthorization({
    user: { selectedInferenceModelAuthorization: 'samsar_api_key' },
  }), 'deployed');
  assert.equal(resolveRequestInferenceAuthorization(), '');
});
