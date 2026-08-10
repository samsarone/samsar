import test from 'node:test';
import assert from 'node:assert/strict';

import User from '../schema/User.js';
import { ensureDefaultTextModelsForUser } from './User.js';

test('migrates legacy GPT 5.6 Sol aliases while preserving explicit effort precedence', async () => {
  const explicitHigh = {
    selectedInferenceModel: 'gpt-5.6-sol-xhigh',
    selectedInferenceEffort: 'high',
    async save() {},
  };
  await ensureDefaultTextModelsForUser(explicitHigh);
  assert.equal(explicitHigh.selectedInferenceModel, 'gpt-5.6-sol');
  assert.equal(explicitHigh.selectedInferenceEffort, 'high');

  const explicitXHigh = {
    selectedInferenceModel: 'gpt-5.6-sol-high',
    selectedInferenceEffort: 'xhigh',
    async save() {},
  };
  await ensureDefaultTextModelsForUser(explicitXHigh);
  assert.equal(explicitXHigh.selectedInferenceModel, 'gpt-5.6-sol');
  assert.equal(explicitXHigh.selectedInferenceEffort, 'xhigh');
});

test('uses the legacy GPT 5.6 Sol suffix when no explicit effort exists', async () => {
  const user = {
    selectedInferenceModel: 'gpt-5.6-sol-xhigh',
    async save() {},
  };
  await ensureDefaultTextModelsForUser(user);
  assert.equal(user.selectedInferenceModel, 'gpt-5.6-sol');
  assert.equal(user.selectedInferenceEffort, 'xhigh');
});

test('migrates a hydrated legacy xhigh user before the schema high default can override it', async () => {
  const user = User.hydrate({
    _id: '507f191e810c19729de860ea',
    selectedInferenceModel: 'gpt-5.6-sol-xhigh',
  });
  let saveCount = 0;
  user.save = async () => {
    saveCount += 1;
  };

  assert.equal(user.selectedInferenceEffort, 'high');
  assert.equal(user.$isDefault('selectedInferenceEffort'), true);

  await ensureDefaultTextModelsForUser(user);

  assert.equal(user.selectedInferenceModel, 'gpt-5.6-sol');
  assert.equal(user.selectedInferenceEffort, 'xhigh');
  assert.equal(saveCount, 1);
});

test('preserves an explicitly persisted high effort while migrating a legacy xhigh model', async () => {
  const user = User.hydrate({
    _id: '507f191e810c19729de860eb',
    selectedInferenceModel: 'gpt-5.6-sol-xhigh',
    selectedInferenceEffort: 'high',
  });
  user.save = async () => {};

  assert.equal(user.$isDefault('selectedInferenceEffort'), false);

  await ensureDefaultTextModelsForUser(user);

  assert.equal(user.selectedInferenceModel, 'gpt-5.6-sol');
  assert.equal(user.selectedInferenceEffort, 'high');
});
