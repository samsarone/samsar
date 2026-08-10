import assert from 'node:assert/strict';
import test from 'node:test';
import OpenAI from 'openai';

import { sendAssistantMessageRequest } from './OpenAI.js';
import { getGPT56SolReasoningEffort } from './GoogleGemini.js';

test('native OpenAI layer inference preserves GPT 5.6 Sol XHigh effort', async (t) => {
  const previous = {
    CURRENT_ENV: process.env.CURRENT_ENV,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  process.env.CURRENT_ENV = 'production';
  process.env.OPENAI_API_KEY = 'native-openai-test-key';

  let capturedBody;
  t.mock.method(OpenAI.prototype, 'post', async (path, options) => {
    assert.equal(path, '/responses');
    capturedBody = options.body;
    return { model: 'gpt-5.6-sol', output_text: 'ok' };
  });

  const response = await sendAssistantMessageRequest(
    [{ role: 'user', content: 'analyze deeply' }],
    'gpt-5.6-sol',
    {
      inferenceEffort: 'xhigh',
      selectedInferenceModelAuthorization: 'native',
    },
  );

  assert.equal(response.content, 'ok');
  assert.equal(capturedBody.model, 'gpt-5.6-sol');
  assert.deepEqual(capturedBody.reasoning, { effort: 'xhigh' });
});

test('legacy Sol suffixes infer effort while explicit effort takes precedence', () => {
  assert.equal(getGPT56SolReasoningEffort('gpt-5.6-sol-high'), 'high');
  assert.equal(getGPT56SolReasoningEffort('gpt-5.6-sol-xhigh'), 'xhigh');
  assert.equal(getGPT56SolReasoningEffort('gpt-5.6-sol-xhigh', 'high'), 'high');
});
