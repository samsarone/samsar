import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';

import User from '../../schema/User.js';
import { verifyAuthToken } from '../Auth.js';
import { loginUserByEmail } from './User.js';

test('email login applies assistant defaults while preserving saved model choices', async (t) => {
  const previousSecret = process.env.TOKEN_SECRET;
  process.env.TOKEN_SECRET = 'email-login-model-defaults-test-only';
  t.after(() => {
    if (previousSecret === undefined) delete process.env.TOKEN_SECRET;
    else process.env.TOKEN_SECRET = previousSecret;
  });
  t.mock.method(mongoose, 'connect', async () => mongoose);
  t.mock.method(bcrypt, 'compare', async () => true);

  let currentUser;
  t.mock.method(User, 'findOne', async (filter) => {
    assert.deepEqual(filter, { email: 'person@example.com' });
    return currentUser;
  });

  for (const assistantModel of [undefined, null, '', '   ', 'gemini-4-carbon']) {
    await t.test(`assistant preference ${JSON.stringify(assistantModel)}`, async () => {
      currentUser = User.hydrate({
        _id: '507f191e810c19729de860ea',
        email: 'person@example.com',
        password: 'test-password-hash',
        selectedInferenceModel: 'gpt-6.2-astra',
        selectedInferenceEffort: 'xhigh',
        ...(assistantModel !== undefined ? { selectedAssistantModel: assistantModel } : {}),
      });
      let saveCount = 0;
      currentUser.save = async () => { saveCount += 1; };

      const profile = await loginUserByEmail({ email: ' Person@Example.com ', password: 'password' });

      assert.equal(profile.selectedInferenceModel, 'gpt-6.2-astra');
      assert.equal(profile.selectedInferenceEffort, 'xhigh');
      assert.equal(profile.selectedAssistantModel, assistantModel?.trim() || 'claude-opus-5.5');
      assert.equal(verifyAuthToken(profile.authToken)._id, currentUser._id.toString());
      assert.equal(profile.password, undefined);
      if (assistantModel === null || assistantModel === '' || assistantModel === '   ') {
        assert.equal(saveCount, 1);
      }
    });
  }
});
