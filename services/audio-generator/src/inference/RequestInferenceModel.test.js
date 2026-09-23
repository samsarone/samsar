import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveRequestInferenceAuthorization,
  resolveRequestInferenceModel,
  resolveRequestInferenceSettings,
  withInferenceAuthorization,
} from './RequestInferenceModel.js';

test('request model wins over session and saved user settings', () => {
  assert.equal(resolveRequestInferenceModel({
    request: { inferenceModel: 'QWEN3.8' },
    session: { expressGenerationInferenceModel: 'gemini-3.1-pro' },
    user: { selectedInferenceModel: 'gpt-6-astra' },
  }), 'QWEN3.8');
});

test('session generation override wins over saved user setting', () => {
  assert.equal(resolveRequestInferenceModel({
    session: {
      expressGenerationInferenceModel: 'QWEN3.8',
      inferenceModel: 'gemini-3.1-pro',
    },
    user: { selectedInferenceModel: 'gpt-6-astra' },
  }), 'QWEN3.8');
});

test('saved user setting is used when no request or session model exists', () => {
  assert.equal(resolveRequestInferenceModel({
    user: { selectedInferenceModel: 'Qwen 3.8' },
  }), 'QWEN3.8');
});

test('keeps Kimi K3 as the express-generation inference override', () => {
  assert.equal(resolveRequestInferenceModel({
    request: { expressGenerationInferenceModel: 'Kimi K3' },
    session: { expressGenerationInferenceModel: 'gpt-6-astra' },
  }), 'kimi-k3');
});

test('inference authorization follows request, session, then user precedence', () => {
  assert.equal(resolveRequestInferenceAuthorization({
    request: { selectedInferenceModelAuthorization: 'native' },
    session: { selectedInferenceModelAuthorization: 'deployed' },
    user: { selectedInferenceModelAuthorization: 'deployed' },
  }), 'native');
  assert.equal(resolveRequestInferenceAuthorization({
    session: { expressGenerationInferenceModelAuthorization: 'deployed' },
    user: { selectedInferenceModelAuthorization: 'native' },
  }), 'deployed');
  assert.equal(resolveRequestInferenceAuthorization({
    user: { selectedInferenceModelAuthorization: 'Samsar API Key' },
  }), 'deployed');
});

test('inference settings preserve absent authorization for automatic fallback', () => {
  assert.deepEqual(resolveRequestInferenceSettings({
    request: { inferenceModel: 'QWEN3.8' },
  }), {
    model: 'QWEN3.8',
    authorization: undefined,
  });

  const payload = { model: 'QWEN3.8', messages: [] };
  assert.equal(withInferenceAuthorization(payload), payload);
  assert.deepEqual(withInferenceAuthorization(payload, 'deployed'), {
    ...payload,
    authorization: 'deployed',
  });
});

test('inference settings preserve saved effort and explicit legacy override precedence', () => {
  assert.deepEqual(resolveRequestInferenceSettings({
    session: { inferenceModel: 'gpt-6-astra', inferenceEffort: 'xhigh' },
  }), {
    model: 'gpt-6-astra-xhigh',
    effort: 'xhigh',
    authorization: undefined,
  });
  assert.deepEqual(resolveRequestInferenceSettings({
    request: { inferenceModel: 'gpt-6-astra-xhigh', effort: 'high' },
  }), {
    model: 'gpt-6-astra',
    effort: 'high',
    authorization: undefined,
  });
});
