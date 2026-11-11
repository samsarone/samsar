import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveRequestInferenceAuthorization,
  resolveRequestInferenceSettings,
  resolveRequestInferenceModel,
} from './RequestInferenceModel.js';

test('an explicit request model wins over session and saved user settings', () => {
  assert.equal(resolveRequestInferenceModel({
    request: { inferenceModel: 'QWEN3.8' },
    session: { expressGenerationInferenceModel: 'gemini-4-carbon' },
    user: { selectedInferenceModel: 'gpt-6-astra' },
  }), 'QWEN3.8');
});

test('the express session model wins over the account setting and generic session model', () => {
  assert.equal(resolveRequestInferenceModel({
    session: {
      expressGenerationInferenceModel: 'QWEN3.8',
      inferenceModel: 'gemini-4-carbon',
    },
    user: { selectedInferenceModel: 'gpt-6-astra' },
  }), 'QWEN3.8');
});

test('preserves Kimi K3 from the express request through the canonical model contract', () => {
  assert.equal(resolveRequestInferenceModel({
    request: { expressGenerationInferenceModel: 'Kimi K3' },
    session: { expressGenerationInferenceModel: 'gemini-4-carbon' },
    user: { selectedInferenceModel: 'gpt-6-astra' },
  }), 'kimi-k3');
});

test('falls back to the account setting and normalizes display labels', () => {
  assert.equal(resolveRequestInferenceModel({
    user: { selectedInferenceModel: 'Qwen 3.8 Max' },
  }), 'QWEN3.8');
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

test('separates canonical GPT 6 Astra from effort while retaining legacy suffixes', () => {
  assert.deepEqual(resolveRequestInferenceSettings({
    session: { inferenceModel: 'gpt-6-astra', inferenceEffort: 'xhigh' },
  }), {
    model: 'gpt-6-astra-xhigh',
    effort: 'xhigh',
    authorization: '',
  });
  assert.deepEqual(resolveRequestInferenceSettings({
    request: { inferenceModel: 'gpt-6-astra-xhigh', effort: 'high' },
  }), {
    model: 'gpt-6-astra',
    effort: 'high',
    authorization: '',
  });
});

for (const model of ['gpt-6-astra', 'gpt-6.1-sol', 'claude-opus-5.5', 'claude-fable-5.1']) {
  test(`${model} retains queued model and effort ahead of changed user preferences`, () => {
    assert.deepEqual(resolveRequestInferenceSettings({
      fallbackRequest: { inferenceModel: model, inferenceEffort: 'xhigh' },
      user: { selectedInferenceModel: 'gpt-6-astra', selectedInferenceEffort: 'high' },
    }), { model: `${model}-xhigh`, effort: 'xhigh', authorization: '' });
    assert.deepEqual(resolveRequestInferenceSettings({
      request: { inferenceModel: `${model}-xhigh`, effort: 'high' },
    }), { model, effort: 'high', authorization: '' });
  });
}
