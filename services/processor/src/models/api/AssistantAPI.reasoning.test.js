import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildResponsesRequest,
  getAssistantCompletionTimeoutMs,
} from './AssistantAPI.js';

test('forces xhigh reasoning for GPT 5.6 Sol assistant requests', () => {
  const request = buildResponsesRequest({
    model: 'gpt-5.6-sol',
    inputMessages: [{ role: 'user', content: 'hello' }],
    payload: { reasoning: { effort: 'low' } },
  });

  assert.deepEqual(request.reasoning, { effort: 'xhigh' });
});

test('assistant completions default to a ten-minute timeout', () => {
  assert.equal(getAssistantCompletionTimeoutMs({}), 10 * 60 * 1000);
  assert.equal(getAssistantCompletionTimeoutMs({ timeout: 4321 }), 4321);
});
