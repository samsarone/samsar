import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAssistantReasoningEffort,
  sendAssistantOpenAICompletionRequest,
} from './OpenAI.js';

test('standalone native OpenAI assistant preserves canonical GPT 6 Astra XHigh effort', async () => {
  let capturedBody;
  const client = {
    async post(path, options) {
      assert.equal(path, '/responses');
      capturedBody = options.body;
      return { model: 'gpt-6-astra', output_text: 'ok' };
    },
  };

  const effort = getAssistantReasoningEffort('gpt-6-astra', {
    reasoning_effort: 'xhigh',
  });
  const response = await sendAssistantOpenAICompletionRequest(
    [{ role: 'user', content: 'analyze deeply' }],
    'gpt-6-astra',
    effort,
    { maxRetries: 0 },
    { client },
  );

  assert.equal(effort, 'xhigh');
  assert.equal(capturedBody.model, 'gpt-6-astra');
  assert.deepEqual(capturedBody.reasoning, { effort: 'xhigh' });
  assert.equal(response.outputText, 'ok');
});

test('legacy GPT 6 Astra model suffixes infer effort unless explicitly overridden', () => {
  assert.equal(getAssistantReasoningEffort('gpt-6-astra-high'), 'high');
  assert.equal(getAssistantReasoningEffort('gpt-6-astra-xhigh'), 'xhigh');
  assert.equal(
    getAssistantReasoningEffort('gpt-6-astra-xhigh', { effort: 'high' }),
    'high',
  );
});
