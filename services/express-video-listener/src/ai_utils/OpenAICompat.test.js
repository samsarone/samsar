import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRequestOptions, createCompatibleChatCompletion } from './OpenAICompat.js';

test('OpenAI-compatible dispatch disables hidden SDK retries after media normalization', () => {
  assert.deepEqual(
    buildRequestOptions({ timeout: 2500, maxRetries: 7 }),
    { timeout: 2500, maxRetries: 0 },
  );
});

test('responses dispatch passes maxRetries zero to the SDK', async () => {
  let receivedOptions;
  const openaiClient = {
    post: async (_path, options) => {
      receivedOptions = options;
      return { output_text: 'ok' };
    },
  };

  await createCompatibleChatCompletion(openaiClient, {
    model: 'gpt-4.1',
    messages: [{ role: 'user', content: 'hello' }],
    maxRetries: 9,
  });

  assert.equal(receivedOptions.maxRetries, 0);
});
