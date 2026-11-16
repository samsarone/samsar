import assert from 'node:assert/strict';
import test from 'node:test';

import User from '../schema/User.js';
import { ensureDefaultTextModelsForUser } from './User.js';
import { getDefaultUserInferenceModel } from '../consts/InferenceModels.js';

test('new users default to Claude Opus 5.5, GPT Image 2.6, and Kling 4', () => {
  const user = new User();
  assert.equal(user.selectedInferenceModel, 'claude-opus-5.5');
  assert.equal(user.selectedAssistantModel, 'claude-opus-5.5');
  assert.equal(user.agentImageModel, 'GPTIMAGE2.5');
  assert.equal(user.agentVideoModel, 'KLINGIMGTOVID4');
  assert.equal(user.selectedInferenceEffort, 'high');
});

test('missing text preferences receive the new defaults without replacing explicit choices', async () => {
  const missing = { async save() {} };
  await ensureDefaultTextModelsForUser(missing);
  assert.equal(missing.selectedInferenceModel, 'claude-opus-5.5');
  assert.equal(missing.selectedAssistantModel, 'claude-opus-5.5');

  const existing = User.hydrate({
    selectedInferenceModel: 'gpt-6-astra',
    selectedAssistantModel: 'gemini-4-carbon',
    selectedInferenceEffort: 'xhigh',
    agentImageModel: 'NANOBANANA2',
    agentVideoModel: 'RUNWAYML',
  });
  existing.save = async () => {};
  await ensureDefaultTextModelsForUser(existing);
  assert.equal(existing.selectedInferenceModel, 'gpt-6-astra');
  assert.equal(existing.selectedAssistantModel, 'gemini-4-carbon');
  assert.equal(existing.selectedInferenceEffort, 'xhigh');
  assert.equal(existing.agentImageModel, 'NANOBANANA2');
  assert.equal(existing.agentVideoModel, 'RUNWAYML');
});

test('system inference defaults to Claude and honors an explicit environment selection', () => {
  const savedUserModel = process.env.USER_INFERENCE_MODEL;
  const savedDefaultModel = process.env.DEFAULT_USER_INFERENCE_MODEL;
  try {
    delete process.env.USER_INFERENCE_MODEL;
    delete process.env.DEFAULT_USER_INFERENCE_MODEL;
    assert.equal(getDefaultUserInferenceModel(), 'claude-opus-5.5');
    process.env.DEFAULT_USER_INFERENCE_MODEL = 'gpt-6-astra';
    assert.equal(getDefaultUserInferenceModel(), 'gpt-6-astra');
    process.env.USER_INFERENCE_MODEL = 'gemini-4-carbon';
    assert.equal(getDefaultUserInferenceModel(), 'gemini-4-carbon');
  } finally {
    if (savedUserModel === undefined) delete process.env.USER_INFERENCE_MODEL;
    else process.env.USER_INFERENCE_MODEL = savedUserModel;
    if (savedDefaultModel === undefined) delete process.env.DEFAULT_USER_INFERENCE_MODEL;
    else process.env.DEFAULT_USER_INFERENCE_MODEL = savedDefaultModel;
  }
});
