import assert from 'node:assert/strict';
import test from 'node:test';

import { rewriteNarrativeSpeechItemToFitScene } from './MovieCreatorAgent.js';

test('rewrites only speech audio with the full narrative prompt and preserves item metadata', async () => {
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
      maxAttempts: 2,
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
          const audio = requests.length === 1
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

  assert.equal(requests.length, 2);
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
  assert.match(requests[1].messages.at(-1).content, /prior correction was invalid/i);
  assert.equal(requests[0].max_tokens, 8192);
  assert.deepEqual(delays, [1000]);
  assert.equal(receipts.length, 2);
  assert.equal(receipts[1].stage, 'narrative_speech_repair');
  assert.equal(receipts[1].sceneIndex, 4);
  assert.equal(receipts[1].soundIndex, 2);
  assert.deepEqual(repaired, { ...speechItem, audio: 'Brief line.' });
});
