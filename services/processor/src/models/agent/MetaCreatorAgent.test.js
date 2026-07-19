import assert from 'node:assert/strict';
import test from 'node:test';

import { extractMetaForMovieResourceList } from './MetaCreatorAgent.js';

test('metadata agent sends the flat resource list and original prompt and reports usage', async () => {
  let completionPayload = null;
  let receipt = null;
  const result = await extractMetaForMovieResourceList(
    {
      scenes: [{ sceneIndex: 0, visual: 'A doorway opens.', internal: 'omit me' }],
      sounds: [{ type: 'speech', sceneIndex: 0, audio: 'Come through.' }],
    },
    {
      originalPrompt: 'A hopeful escape.',
      inferenceModel: 'gpt-5.6-sol',
      createChatCompletion: async (_client, payload) => {
        completionPayload = payload;
        return {
          model: 'gpt-5.6-luna',
          usage: { input_tokens: 100, output_tokens: 20 },
          choices: [{
            message: {
              content: JSON.stringify({
                title: 'The Open Door',
                description: 'A traveler chooses whether to cross the threshold.',
              }),
            },
          }],
        };
      },
      onInferenceResponse: (value) => {
        receipt = value;
      },
    },
  );

  assert.deepEqual(result, {
    title: 'The Open Door',
    description: 'A traveler chooses whether to cross the threshold.',
  });
  assert.equal(completionPayload.model, 'gpt-5.6-luna');
  assert.equal(completionPayload.reasoning.effort, 'xhigh');
  const userContent = completionPayload.messages.find((message) => message.role === 'user').content;
  assert.match(userContent, /A hopeful escape/);
  assert.match(userContent, /A doorway opens/);
  assert.match(userContent, /Come through/);
  assert.doesNotMatch(userContent, /omit me/);
  assert.deepEqual(receipt, {
    stage: 'publication_metadata_generation',
    attempt: 1,
    model: 'gpt-5.6-luna',
    usage: { input_tokens: 100, output_tokens: 20 },
  });
});

test('metadata usage is reported before malformed structured output is rejected', async () => {
  let receiptSeen = false;
  await assert.rejects(
    extractMetaForMovieResourceList(
      { scenes: [{ visual: 'A scene' }], sounds: [] },
      {
        createChatCompletion: async () => ({
          model: 'gpt-5.6-luna',
          usage: { input_tokens: 10, output_tokens: 2 },
          choices: [{ message: { content: 'not json' } }],
        }),
        onInferenceResponse: () => {
          receiptSeen = true;
        },
      },
    ),
  );
  assert.equal(receiptSeen, true);
});
