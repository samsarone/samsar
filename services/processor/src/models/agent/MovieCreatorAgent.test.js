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
  const movieResourceList = {
    scenes: [
      { visual: 'Opening image.', type: 'base', duration: 7.875 },
      { visual: 'A door closes.', type: 'sound_effect', duration: 7.875 },
      { visual: 'An empty corridor.', type: 'base', duration: 7.875 },
      { visual: 'A clock advances.', type: 'base', duration: 7.875 },
      scene,
    ],
    sounds: [
      {
        type: 'sound_effect',
        subType: '',
        sceneIndex: 1,
        audio: 'A wooden door clicks shut.',
      },
      {
        type: 'speech',
        subType: 'narration',
        actor: 'Narrator',
        gender: 'F',
        sceneIndex: 3,
        audio: 'Time passes.',
      },
      speechItem,
    ],
  };

  const repaired = await rewriteNarrativeSpeechItemToFitScene({
    movieResourceList,
    scene,
    speechItem,
    maxCharacters: 9,
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
          const content = requests.length === 1
            ? JSON.stringify({ audio: 'Short.' })
            : (requests.length === 2 ? 'This replacement remains too long.' : 'Short.');
          return {
            model: 'qwen/qwen3.7-plus',
            choices: [{ message: { content } }],
            usage: { input_tokens: 10, output_tokens: 3 },
          };
        },
      },
    },
  });

  assert.equal(requests.length, 3);
  assert.equal(
    requests[0].messages[0].content,
    'Rewrite the target speech to fit its scene in at most 9 characters. ' +
      'Preserve its meaning, language, speaker, and tone, using movieResourceList only for ' +
      'context. Return only the rewritten speech text.',
  );
  assert.match(requests[1].messages[0].content, /at most 8 characters/);
  assert.match(requests[2].messages[0].content, /at most 7 characters/);
  assert.equal('response_format' in requests[0], false);
  const expectedUserPayload = {
    movieResourceList,
    targetSceneIndex: 4,
    targetSoundIndex: 2,
    originalAudioItem: speechItem,
    sceneDescription: scene.visual,
  };
  requests.forEach((request) => {
    assert.equal(request.messages.length, 2);
    assert.deepEqual(JSON.parse(request.messages[1].content), expectedUserPayload);
  });
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
  assert.equal(requests[0].max_tokens, 256);
  assert.equal(requests[0].reasoning.effort, 'low');
  assert.deepEqual(delays, [1000, 2000]);
  assert.equal(receipts.length, 3);
  assert.equal(receipts[2].stage, 'narrative_speech_repair');
  assert.equal(receipts[2].sceneIndex, 4);
  assert.equal(receipts[2].soundIndex, 2);
  assert.equal(repaired, 'Short.');
});

test('caps configured speech repair attempts at three', async () => {
  let requests = 0;
  const delays = [];
  const systemPrompts = [];
  const scene = { visual: 'A quiet sunrise.', duration: 5 };
  const speechItem = {
    type: 'speech',
    sceneIndex: 0,
    audio: 'This line needs repair.',
  };
  const movieResourceList = {
    scenes: [scene],
    sounds: [speechItem],
  };

  await assert.rejects(
    rewriteNarrativeSpeechItemToFitScene({
      movieResourceList,
      scene,
      speechItem,
      maxCharacters: 4,
      inferenceModel: 'QWEN3.7',
      options: {
        maxAttempts: 99,
        sceneIndex: 0,
        soundIndex: 0,
        dependencies: {
          openaiClient: {},
          sleep: async (delayMs) => delays.push(delayMs),
          createCompatibleChatCompletion: async (_client, request) => {
            requests += 1;
            systemPrompts.push(request.messages[0].content);
            return {
              model: 'qwen/qwen3.7-plus',
              choices: [{
                message: { content: 'Still too long.' },
              }],
            };
          },
        },
      },
    }),
    /Replacement speech has 15 characters; 2 are allowed/,
  );

  assert.equal(requests, 3);
  assert.match(systemPrompts[0], /at most 4 characters/);
  assert.match(systemPrompts[1], /at most 3 characters/);
  assert.match(systemPrompts[2], /at most 2 characters/);
  assert.deepEqual(delays, [1000, 2000]);
});
