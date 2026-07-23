import assert from 'node:assert/strict';
import test from 'node:test';

import { rewriteNarrativeSpeechItemToFitScene } from './MovieCreatorAgent.js';

test('retries invalid speech repairs three times with backoff and preserves item metadata', async () => {
  const requests = [];
  const receipts = [];
  const delays = [];
  const scene = {
    visual: 'A detective studies a photograph beneath a desk lamp.',
    type: 'narration',
    speaker: '',
    duration: 7.875,
    startTime: 0,
    endTime: 7.875,
  };
  const speechItem = {
    type: 'speech',
    subType: 'narration',
    actor: 'Narrator',
    gender: 'F',
    Identity: 'Detached observer',
    isHuman: true,
    sceneIndex: 4,
    audio: 'This first line is much too long.',
    duration: 7.875,
    startTime: 31.5,
    endTime: 39.375,
  };

  const repaired = await rewriteNarrativeSpeechItemToFitScene({
    narrativeSystemPrompt: 'FULL NARRATIVE SYSTEM PROMPT\nFinal Response Format: {...}',
    scene,
    speechItem,
    maxCharacters: 12,
    inferenceModel: 'QWEN3.7',
    options: {
      externalRequestContext: {
        sessionId: 'session-1',
        requestKey: 'text_to_video:speech-repair-1-4-2',
      },
      sceneIndex: 4,
      soundIndex: 2,
      onInferenceResponse: (receipt) => receipts.push(receipt),
      dependencies: {
        openaiClient: {},
        sleep: async (delayMs) => delays.push(delayMs),
        createCompatibleChatCompletion: async (_client, request) => {
          requests.push(request);
          const audio = requests.length < 3
            ? 'This replacement remains too long.'
            : 'Brief line.';
          return {
            model: 'qwen/qwen3.7-plus',
            choices: [{ message: { content: JSON.stringify({ audio }) } }],
            usage: { input_tokens: 10, output_tokens: 3 },
          };
        },
      },
    },
  });

  assert.equal(requests.length, 3);
  assert.equal(requests[0].messages[0].content, 'FULL NARRATIVE SYSTEM PROMPT\nFinal Response Format: {...}');
  assert.match(requests[0].messages[1].content, /return only \{"audio":"\.\.\."\}/);
  assert.deepEqual(JSON.parse(requests[0].messages[2].content), { scene, speechItem });
  assert.equal(
    requests[0].externalRequestContext.requestKey,
    'text_to_video:speech-repair-1-4-2:attempt-1',
  );
  assert.equal(
    requests[1].externalRequestContext.requestKey,
    'text_to_video:speech-repair-1-4-2:attempt-2',
  );
  assert.equal(
    requests[2].externalRequestContext.requestKey,
    'text_to_video:speech-repair-1-4-2:attempt-3',
  );
  assert.match(requests[1].messages.at(-1).content, /prior correction was invalid/i);
  assert.equal(requests[0].max_tokens, 8192);
  assert.deepEqual(delays, [1000, 2000]);
  assert.equal(receipts.length, 3);
  assert.equal(receipts[2].stage, 'narrative_speech_repair');
  assert.equal(receipts[2].sceneIndex, 4);
  assert.equal(receipts[2].soundIndex, 2);
  assert.deepEqual(repaired, { ...speechItem, audio: 'Brief line.' });
});

test('caps configured speech repair attempts at three', async () => {
  let requests = 0;
  const delays = [];

  await assert.rejects(
    rewriteNarrativeSpeechItemToFitScene({
      narrativeSystemPrompt: 'FULL NARRATIVE SYSTEM PROMPT',
      scene: { visual: 'A quiet sunrise.', duration: 5 },
      speechItem: {
        type: 'speech',
        sceneIndex: 0,
        audio: 'This line needs repair.',
      },
      maxCharacters: 4,
      inferenceModel: 'QWEN3.7',
      options: {
        maxAttempts: 99,
        dependencies: {
          openaiClient: {},
          sleep: async (delayMs) => delays.push(delayMs),
          createCompatibleChatCompletion: async () => {
            requests += 1;
            return {
              model: 'qwen/qwen3.7-plus',
              choices: [{
                message: { content: JSON.stringify({ audio: 'Still too long.' }) },
              }],
            };
          },
        },
      },
    }),
    /Replacement speech has 15 characters; 4 are allowed/,
  );

  assert.equal(requests, 3);
  assert.deepEqual(delays, [1000, 2000]);
});
