import assert from 'node:assert/strict';
import test from 'node:test';

import { INFERENCE_MODELS } from '../../consts/InferenceModels.js';
import { createCompatibleChatCompletion } from './OpenAICompat.js';

test('forces xhigh reasoning for GPT 5.6 Sol Responses requests', async () => {
  let capturedPath;
  let capturedBody;
  const openaiClient = {
    async post(path, options) {
      capturedPath = path;
      capturedBody = options.body;
      return {
        id: 'resp-test',
        model: 'gpt-5.6-sol',
        output_text: 'ok',
      };
    },
  };

  const response = await createCompatibleChatCompletion(openaiClient, {
    model: 'gpt-5.6-sol',
    messages: [{ role: 'user', content: 'hello' }],
    reasoning: { effort: 'low' },
  });

  assert.equal(capturedPath, '/responses');
  assert.deepEqual(capturedBody.reasoning, { effort: 'xhigh' });
  assert.equal(response.choices[0].message.content, 'ok');
});

test('preserves GPT 5.6 Luna and forces xhigh for publication metadata requests', async () => {
  let capturedBody;
  const openaiClient = {
    async post(_path, options) {
      capturedBody = options.body;
      return {
        id: 'resp-metadata-test',
        model: INFERENCE_MODELS.PublicationMetadata,
        output_text: 'metadata',
      };
    },
  };

  await createCompatibleChatCompletion(openaiClient, {
    model: INFERENCE_MODELS.PublicationMetadata,
    messages: [{ role: 'user', content: 'generate metadata' }],
    reasoning: { effort: 'low' },
  });

  assert.equal(capturedBody.model, 'gpt-5.6-luna');
  assert.deepEqual(capturedBody.reasoning, { effort: 'xhigh' });
});
