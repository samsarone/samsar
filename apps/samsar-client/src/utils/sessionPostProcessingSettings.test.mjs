import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSessionInferenceSettings } from './sessionPostProcessingSettings.mjs';

test('post-processing keeps the session model and effort when account defaults differ', () => {
  assert.deepEqual(resolveSessionInferenceSettings({
    expressGenerationInferenceModel: 'claude-opus-5.5',
    expressGenerationInferenceEffort: 'xhigh',
  }, { inferenceModel: 'gemini-4-carbon', inferenceEffort: 'high' }), {
    inferenceModel: 'claude-opus-5.5', inferenceEffort: 'xhigh',
  });
});

test('nested session settings take precedence over response-level defaults', () => {
  assert.deepEqual(resolveSessionInferenceSettings({
    inferenceModel: 'gemini-4-carbon', inferenceEffort: 'high',
    session: { inference_model: 'claude-fable-5.1', reasoning_effort: 'xhigh' },
  }), { inferenceModel: 'claude-fable-5.2', inferenceEffort: 'xhigh' });
});

test('reads legacy builder and input settings and reasoning effort', () => {
  assert.deepEqual(resolveSessionInferenceSettings({
    expressGenerationBuilder: { inference_model: 'gpt-6.2-astra' },
    input: { reasoning: { effort: 'xhigh' } },
  }), { inferenceModel: 'gpt-6.2-astra', inferenceEffort: 'xhigh' });
});

test('preserves legacy model suffix effort unless the session records an explicit effort', () => {
  assert.deepEqual(resolveSessionInferenceSettings({
    metadata: { inferenceModel: 'claude-opus-5.5-xhigh' },
  }), { inferenceModel: 'claude-opus-5.5', inferenceEffort: 'xhigh' });
  assert.deepEqual(resolveSessionInferenceSettings({
    inferenceModel: 'claude-opus-5.5-xhigh', inferenceEffort: 'high',
  }), { inferenceModel: 'claude-opus-5.5', inferenceEffort: 'high' });
});

test('does not import a different account effort when the source model is recorded', () => {
  assert.deepEqual(resolveSessionInferenceSettings({ inferenceModel: 'claude-opus-5.5' }, {
    inferenceModel: 'gpt-6.2-astra', inferenceEffort: 'xhigh',
  }), { inferenceModel: 'claude-opus-5.5', inferenceEffort: 'high' });
});

test('uses explicit compatibility defaults only when historical settings are absent', () => {
  assert.deepEqual(resolveSessionInferenceSettings({}, {
    selectedInferenceModel: 'gpt-6.2-astra-xhigh',
  }), { inferenceModel: 'gpt-6.2-astra', inferenceEffort: 'xhigh' });
  assert.deepEqual(resolveSessionInferenceSettings(null), { inferenceModel: '', inferenceEffort: 'high' });
});

test('retains an unavailable historical model instead of replacing it with an account default', () => {
  assert.deepEqual(resolveSessionInferenceSettings({
    inference_model: 'historical-private-model', inferenceEffort: 'xhigh',
  }, { inferenceModel: 'gemini-4-carbon' }), {
    inferenceModel: 'historical-private-model', inferenceEffort: 'xhigh',
  });
});
