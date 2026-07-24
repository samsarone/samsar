import assert from 'node:assert/strict';
import test from 'node:test';

import {
  generateBranchMovieResourceList,
  generateBranchedMovieResourceList,
  generateChildMovieResourceList,
  generateDivergencePaths,
} from './BranchingNarrativeAgent.js';

function completion(content, model = 'QWEN3.7') {
  return {
    model,
    usage: { input_tokens: 100, output_tokens: 30 },
    choices: [{ message: { role: 'assistant', content } }],
  };
}

function buildParentMovieResourceList() {
  return {
    metadata: { source: 'singular-request' },
    scenes: [
      {
        visual: 'Bangkok dawn light spreads across a quiet riverside skyline.',
        type: 'narration',
        duration: 5,
        startTime: 0,
        endTime: 5,
        speaker: '',
      },
      {
        visual: 'A ferry gate unlocks beside the empty pier.',
        type: 'base',
        duration: 5,
        startTime: 5,
        endTime: 10,
        speaker: '',
      },
      {
        visual: 'Ada, a young woman in a blue work jacket, studies the river map.',
        type: 'character',
        duration: 5,
        startTime: 10,
        endTime: 15,
        speaker: 'Ada',
      },
      {
        visual: 'Rain rattles against the corrugated ferry shelter roof.',
        type: 'sound_effect',
        duration: 5,
        startTime: 15,
        endTime: 20,
        speaker: '',
      },
    ],
    sounds: [
      {
        audio: 'The city wakes before the sun reaches the water.',
        startTime: 0,
        duration: 4,
        endTime: 4,
        type: 'speech',
        sceneIndex: 0,
        subType: 'narration',
        actor: 'Narrator',
        gender: 'F',
        Identity: 'Narrator',
        isHuman: false,
        speaker: 'nova',
        provider: 'OPENAI',
      },
      {
        audio: 'The old route is still open.',
        startTime: 10,
        duration: 4,
        endTime: 14,
        type: 'speech',
        sceneIndex: 2,
        subType: 'character',
        actor: 'Ada',
        gender: 'F',
        Identity: 'Ada, young ferry dispatcher',
        isHuman: true,
        speaker: 'coral',
        provider: 'OPENAI',
        speakerVoiceId: 'coral',
        speakerLabel: 'Coral',
        speakerCharacterName: 'Ada',
        Affect: 'Focused',
        Tone: 'Quiet urgency',
        instructions: 'Personality/affect: Focused',
      },
      {
        audio: 'Heavy tropical rain striking a metal roof.',
        startTime: 15,
        duration: 5,
        endTime: 20,
        type: 'sound_effect',
        sceneIndex: 3,
        subType: '',
        actor: '',
        gender: '',
        Identity: '',
        isHuman: false,
      },
    ],
  };
}

function buildValidSuffix() {
  return {
    scenes: [
      {
        visual: 'Ada, a young woman in a blue work jacket, folds the river map and runs toward the waiting ferry.',
        type: 'character',
        duration: 5,
        startTime: 10,
        endTime: 15,
        speaker: 'Ada',
      },
      {
        visual: 'The ferry pulls into the brightening river while rain clouds break over Bangkok.',
        type: 'base',
        duration: 5,
        startTime: 15,
        endTime: 20,
        speaker: '',
      },
    ],
    sounds: [
      {
        audio: 'We take the river before the storm closes in.',
        startTime: 10,
        duration: 4,
        endTime: 14,
        type: 'speech',
        sceneIndex: 2,
        subType: 'character',
        actor: 'Ada',
        gender: 'F',
        Identity: 'Ada, young ferry dispatcher',
        isHuman: true,
      },
    ],
  };
}

test('generates exactly two divergence paths and meters invalid structured attempts before retrying', async () => {
  const parentMovieResourceList = buildParentMovieResourceList();
  const requests = [];
  const receipts = [];
  const delays = [];
  const responses = [
    completion(JSON.stringify({
      paths: [{ path_name: 'Only path', path_description: 'This is not enough.' }],
    })),
    completion(JSON.stringify({
      paths: [
        {
          path_name: 'Take the river',
          path_description: 'Ada boards the ferry and races downstream to reach the old crossing.',
        },
        {
          path_name: 'Stay at the pier',
          path_description: 'Ada remains ashore and traces the warning to a hidden signal station.',
        },
      ],
    })),
  ];

  const paths = await generateDivergencePaths({
    themeJson: { actors: [{ name: 'Ada', keywords: ['young woman'] }] },
    parentMovieResourceList,
    originalPrompt: 'A ferry dispatcher makes a difficult choice.',
    divergenceSceneIndex: 1,
    inferenceModel: 'QWEN3.7',
    externalRequestContext: { sessionId: 'branch-request-1', userId: 'user-1' },
    requestKey: 'narrative:create_branching:level-1:root:paths',
    maxAttempts: 2,
    retryDelayMs: 1,
    onInferenceResponse: (receipt) => receipts.push(receipt),
    dependencies: {
      createCompatibleChatCompletion: async (_client, request) => {
        requests.push(request);
        return responses.shift();
      },
      sleep: async (delayMs) => delays.push(delayMs),
    },
  });

  assert.equal(paths.length, 2);
  assert.deepEqual(paths.map((path) => path.path_name), [
    'Take the river',
    'Stay at the pier',
  ]);
  assert.equal(receipts.length, 2);
  assert.deepEqual(receipts.map((receipt) => receipt.attempt), [1, 2]);
  assert.ok(receipts.every((receipt) => receipt.stage === 'branch_divergence_generation'));
  assert.deepEqual(delays, [1]);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].messages.length, requests[0].messages.length + 1);
  assert.match(requests[1].messages.at(-1).content, /prior response was invalid/i);
  assert.match(requests[1].messages.at(-1).content, /paths/i);
  assert.equal(requests[0].maxRetries, 0);
  assert.equal(requests[0].externalMaxRetries, 0);
  assert.equal(requests[0].max_tokens, 16384);
  assert.equal(
    requests[0].externalRequestContext.requestKey,
    'narrative:create_branching:level-1:root:paths:attempt-1',
  );
  assert.equal(
    requests[1].externalRequestContext.requestKey,
    'narrative:create_branching:level-1:root:paths:attempt-2',
  );
  const responseSchema = requests[0].response_format.json_schema.schema;
  assert.equal(responseSchema.properties.paths.minItems, 2);
  assert.equal(responseSchema.properties.paths.maxItems, 2);
});

test('locally rejects duplicate Qwen path descriptors even when JSON mode returns valid JSON', async () => {
  const parentMovieResourceList = buildParentMovieResourceList();
  let calls = 0;

  await assert.rejects(
    generateDivergencePaths({
      themeJson: {},
      parentMovieResourceList,
      divergenceSceneIndex: 1,
      maxAttempts: 1,
      onInferenceResponse: () => {},
      dependencies: {
        createCompatibleChatCompletion: async () => {
          calls += 1;
          return completion(JSON.stringify({
            paths: [
              { path_name: 'Same', path_description: 'Same outcome' },
              { path_name: 'same', path_description: 'same outcome' },
            ],
          }));
        },
      },
    }),
    (error) => {
      assert.equal(error.code, 'DIVERGENCE_PATH_GENERATION_FAILED');
      assert.match(error.message, /distinct/i);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test('does not retry when inference receipt persistence fails', async () => {
  const parentMovieResourceList = buildParentMovieResourceList();
  let completionCalls = 0;
  let sleepCalls = 0;

  await assert.rejects(
    generateDivergencePaths({
      themeJson: {},
      parentMovieResourceList,
      divergenceSceneIndex: 1,
      maxAttempts: 4,
      onInferenceResponse: () => {
        throw new Error('database unavailable');
      },
      dependencies: {
        createCompatibleChatCompletion: async () => {
          completionCalls += 1;
          return completion(JSON.stringify({
            paths: [
              { path_name: 'A', path_description: 'First path' },
              { path_name: 'B', path_description: 'Second path' },
            ],
          }));
        },
        sleep: async () => {
          sleepCalls += 1;
        },
      },
    }),
    (error) => {
      assert.equal(error.code, 'INFERENCE_USAGE_OBSERVER_FAILED');
      assert.equal(error.inferenceUsageObserverFailed, true);
      return true;
    },
  );
  assert.equal(completionCalls, 1);
  assert.equal(sleepCalls, 0);
});

test('generates a full child movieResourceList with an exact cloned prefix and inherited actor voice metadata', async () => {
  const parentMovieResourceList = buildParentMovieResourceList();
  const originalParent = structuredClone(parentMovieResourceList);
  const receipts = [];
  let capturedRequest;

  const result = await generateBranchMovieResourceList({
    themeJson: {
      actors: [{ name: 'Ada', keywords: ['young woman', 'ferry dispatcher'] }],
    },
    parentMovieResourceList,
    originalPrompt: 'A ferry dispatcher makes a difficult choice.',
    divergenceSceneIndex: 1,
    divergence: {
      path_name: 'Take the river',
      path_description: 'Ada boards the ferry and races downstream.',
    },
    inferenceModel: 'gpt-5.6-sol',
    videoGenerationModel: 'COSMOS3SUPERI2V',
    requestKey: 'narrative:create_branching:level-1:path-1:mrl',
    externalRequestContext: { sessionId: 'branch-request-2', userId: 'user-1' },
    onInferenceResponse: (receipt) => receipts.push(receipt),
    dependencies: {
      createCompatibleChatCompletion: async (_client, request) => {
        capturedRequest = request;
        return completion(JSON.stringify(buildValidSuffix()), 'gpt-5.6-sol');
      },
    },
  });

  assert.deepEqual(result.scenes.slice(0, 2), originalParent.scenes.slice(0, 2));
  assert.deepEqual(
    result.sounds.filter((sound) => sound.sceneIndex <= 1),
    originalParent.sounds.filter((sound) => sound.sceneIndex <= 1),
  );
  assert.equal(result.scenes.length, parentMovieResourceList.scenes.length);
  assert.equal(result.scenes[2].visual, buildValidSuffix().scenes[0].visual);
  assert.equal(result.scenes[3].type, 'base');
  assert.deepEqual(result.metadata, { source: 'singular-request' });
  const adaSound = result.sounds.find((sound) => sound.sceneIndex === 2);
  assert.equal(adaSound.actor, 'Ada');
  assert.equal(adaSound.speaker, 'coral');
  assert.equal(adaSound.provider, 'OPENAI');
  assert.equal(adaSound.speakerVoiceId, 'coral');
  assert.equal(adaSound.instructions, 'Personality/affect: Focused');
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].stage, 'branch_movie_resource_generation');
  assert.equal(receipts[0].pathName, 'Take the river');
  assert.equal(capturedRequest.maxRetries, 0);
  assert.equal(capturedRequest.externalMaxRetries, 0);
  assert.match(
    capturedRequest.messages[0].content,
    /28 characters or fewer for a 5-second scene/,
  );
  assert.match(
    capturedRequest.messages[0].content,
    /44 characters or fewer for a 7-second scene/,
  );
  assert.match(
    capturedRequest.messages[0].content,
    /spaces and punctuation count toward the limit/,
  );
  const payload = JSON.parse(capturedRequest.messages[1].content);
  assert.equal(payload.videoGenerationModel, 'COSMOS3SUPERI2V');
  assert.deepEqual(payload.timelineSlots, [
    { sceneIndex: 2, startTime: 10, duration: 5, endTime: 15 },
    { sceneIndex: 3, startTime: 15, duration: 5, endTime: 20 },
  ]);

  result.scenes[0].visual = 'mutated child';
  assert.deepEqual(parentMovieResourceList, originalParent);
});

test('retries a branch suffix whose speech exceeds the model-aware tolerance', async () => {
  const invalidSuffix = buildValidSuffix();
  invalidSuffix.sounds[0].audio = 'a'.repeat(58);
  const validSuffix = buildValidSuffix();
  validSuffix.sounds[0].audio = 'a'.repeat(57);
  const responses = [
    completion(JSON.stringify(invalidSuffix), 'QWEN3.7'),
    completion(JSON.stringify(validSuffix), 'QWEN3.7'),
  ];
  const receipts = [];

  const result = await generateBranchMovieResourceList({
    themeJson: { actors: [{ name: 'Ada', keywords: [] }] },
    parentMovieResourceList: buildParentMovieResourceList(),
    divergenceSceneIndex: 1,
    divergence: {
      path_name: 'Take the river',
      path_description: 'Ada boards the ferry and races downstream.',
    },
    inferenceModel: 'QWEN3.7',
    videoGenerationModel: 'COSMOS3SUPERI2V',
    maxAttempts: 2,
    retryDelayMs: 1,
    onInferenceResponse: (receipt) => receipts.push(receipt),
    dependencies: {
      createCompatibleChatCompletion: async () => responses.shift(),
      sleep: async () => {},
    },
  });

  assert.equal(result.sounds.find((sound) => sound.sceneIndex === 2).audio.length, 57);
  assert.equal(receipts.length, 2);
  assert.deepEqual(receipts.map((receipt) => receipt.attempt), [1, 2]);
});

test('retries a branch suffix that introduces a new actor and meters both responses', async () => {
  const parentMovieResourceList = buildParentMovieResourceList();
  const invalidSuffix = buildValidSuffix();
  invalidSuffix.scenes[0].speaker = 'Bea';
  invalidSuffix.sounds[0] = {
    ...invalidSuffix.sounds[0],
    actor: 'Bea',
    Identity: 'Bea, unknown traveler',
  };
  const responses = [
    completion(JSON.stringify(invalidSuffix), 'gemini-3.1-pro'),
    completion(JSON.stringify(buildValidSuffix()), 'gemini-3.1-pro'),
  ];
  const receipts = [];
  const delays = [];

  const result = await generateBranchMovieResourceList({
    themeJson: { actors: [{ name: 'Ada', keywords: [] }] },
    parentMovieResourceList,
    divergenceSceneIndex: 1,
    divergence: {
      path_name: 'Take the river',
      path_description: 'Ada boards the ferry and races downstream.',
    },
    inferenceModel: 'gemini-3.1-pro',
    maxAttempts: 2,
    retryDelayMs: 2,
    onInferenceResponse: (receipt) => receipts.push(receipt),
    dependencies: {
      createCompatibleChatCompletion: async () => responses.shift(),
      sleep: async (delayMs) => delays.push(delayMs),
    },
  });

  assert.equal(result.scenes[2].speaker, 'Ada');
  assert.equal(receipts.length, 2);
  assert.deepEqual(receipts.map((receipt) => receipt.attempt), [1, 2]);
  assert.deepEqual(delays, [2]);
});

test('rejects a new narrator when the parent has no narration actor registry entry', async () => {
  const parentMovieResourceList = buildParentMovieResourceList();
  parentMovieResourceList.scenes[0] = {
    ...parentMovieResourceList.scenes[0],
    type: 'base',
  };
  parentMovieResourceList.sounds = parentMovieResourceList.sounds.filter(
    (sound) => sound.sceneIndex !== 0,
  );
  const suffix = buildValidSuffix();
  suffix.scenes[0] = {
    ...suffix.scenes[0],
    type: 'narration',
    speaker: '',
  };
  suffix.sounds[0] = {
    ...suffix.sounds[0],
    subType: 'narration',
    actor: 'New Narrator',
    gender: 'F',
    Identity: 'New Narrator',
    isHuman: false,
  };

  await assert.rejects(
    generateBranchMovieResourceList({
      themeJson: { actors: [{ name: 'Ada', keywords: [] }] },
      parentMovieResourceList,
      divergenceSceneIndex: 1,
      divergence: {
        path_name: 'Narrated turn',
        path_description: 'A narrator explains what happens next.',
      },
      maxAttempts: 1,
      onInferenceResponse: () => {},
      dependencies: {
        createCompatibleChatCompletion: async () => completion(JSON.stringify(suffix)),
      },
    }),
    (error) => {
      assert.equal(error.code, 'BRANCH_MOVIE_RESOURCE_GENERATION_FAILED');
      assert.match(error.message, /unknown narrator/i);
      return true;
    },
  );
});

test('allows the existing parent narrator and inherits its voice metadata', async () => {
  const suffix = buildValidSuffix();
  suffix.scenes[0] = {
    ...suffix.scenes[0],
    visual: 'The empty ferry slips away from the pier beneath a pale band of dawn.',
    type: 'narration',
    speaker: '',
  };
  suffix.sounds[0] = {
    ...suffix.sounds[0],
    audio: 'The choice carries the ferry into the uncertain morning.',
    subType: 'narration',
    actor: 'Narrator',
    gender: 'F',
    Identity: 'Narrator',
    isHuman: false,
  };
  let capturedRequest;

  const result = await generateBranchMovieResourceList({
    themeJson: { actors: [{ name: 'Ada', keywords: [] }] },
    parentMovieResourceList: buildParentMovieResourceList(),
    divergenceSceneIndex: 1,
    divergence: {
      path_name: 'Voice from the river',
      path_description: 'The established narrator follows the departing ferry.',
    },
    maxAttempts: 1,
    onInferenceResponse: () => {},
    dependencies: {
      createCompatibleChatCompletion: async (_client, request) => {
        capturedRequest = request;
        return completion(JSON.stringify(suffix));
      },
    },
  });

  const narratorSound = result.sounds.find((sound) => sound.sceneIndex === 2);
  assert.equal(narratorSound.actor, 'Narrator');
  assert.equal(narratorSound.speaker, 'nova');
  assert.equal(narratorSound.provider, 'OPENAI');
  const payload = JSON.parse(capturedRequest.messages[1].content);
  assert.ok(payload.actorRegistry.some((actor) => (
    actor.role === 'narration' && actor.name === 'Narrator'
  )));
});

test('requires canonical lowercase speech subType values', async () => {
  const suffix = buildValidSuffix();
  suffix.sounds[0].subType = 'Character';

  await assert.rejects(
    generateBranchMovieResourceList({
      themeJson: { actors: [{ name: 'Ada', keywords: [] }] },
      parentMovieResourceList: buildParentMovieResourceList(),
      divergenceSceneIndex: 1,
      divergence: {
        path_name: 'Take the river',
        path_description: 'Ada boards the ferry and races downstream.',
      },
      maxAttempts: 1,
      onInferenceResponse: () => {},
      dependencies: {
        createCompatibleChatCompletion: async () => completion(JSON.stringify(suffix)),
      },
    }),
    (error) => {
      assert.equal(error.code, 'BRANCH_MOVIE_RESOURCE_GENERATION_FAILED');
      assert.match(error.message, /invalid subType/i);
      return true;
    },
  );
});

test('rejects shared-validator normalization that changes an inherited timeline slot', async () => {
  const parentMovieResourceList = buildParentMovieResourceList();
  parentMovieResourceList.scenes[2] = {
    ...parentMovieResourceList.scenes[2],
    duration: 10,
    startTime: 10,
    endTime: 20,
  };
  parentMovieResourceList.scenes[3] = {
    ...parentMovieResourceList.scenes[3],
    duration: 10,
    startTime: 20,
    endTime: 30,
  };
  parentMovieResourceList.sounds = parentMovieResourceList.sounds.map((sound) => {
    if (sound.sceneIndex === 2) {
      return { ...sound, startTime: 10, duration: 9, endTime: 19 };
    }
    if (sound.sceneIndex === 3) {
      return { ...sound, startTime: 20, duration: 10, endTime: 30 };
    }
    return sound;
  });
  const suffix = buildValidSuffix();
  suffix.scenes[0] = {
    ...suffix.scenes[0],
    duration: 10,
    startTime: 10,
    endTime: 20,
  };
  suffix.scenes[1] = {
    ...suffix.scenes[1],
    duration: 10,
    startTime: 20,
    endTime: 30,
  };
  // This is inside the supplied 10-second scene, but the shared validator
  // would normalize the scene down to a 5-second render unit.
  suffix.sounds[0] = {
    ...suffix.sounds[0],
    startTime: 10,
    duration: 4,
    endTime: 14,
  };

  await assert.rejects(
    generateBranchMovieResourceList({
      themeJson: { actors: [{ name: 'Ada' }] },
      parentMovieResourceList,
      divergenceSceneIndex: 1,
      divergence: {
        path_name: 'Take the river',
        path_description: 'Ada boards the ferry and races downstream.',
      },
      maxAttempts: 1,
      onInferenceResponse: () => {},
      dependencies: {
        createCompatibleChatCompletion: async () => completion(
          JSON.stringify(suffix),
          'gpt-5.6-sol',
        ),
      },
    }),
    (error) => {
      assert.equal(error.code, 'BRANCH_MOVIE_RESOURCE_GENERATION_FAILED');
      assert.match(error.message, /timeline|duration/i);
      return true;
    },
  );
});

test('retries when a generated continuation duplicates its completed sibling', async () => {
  const parentMovieResourceList = buildParentMovieResourceList();
  const commonOptions = {
    themeJson: { actors: [{ name: 'Ada' }] },
    parentMovieResourceList,
    divergenceSceneIndex: 1,
    divergence: {
      path_name: 'Take the river',
      path_description: 'Ada boards the ferry and races downstream.',
    },
    onInferenceResponse: () => {},
  };
  const siblingMovieResourceList = await generateBranchMovieResourceList({
    ...commonOptions,
    maxAttempts: 1,
    dependencies: {
      createCompatibleChatCompletion: async () => completion(
        JSON.stringify(buildValidSuffix()),
        'gpt-5.6-sol',
      ),
    },
  });
  const distinctSuffix = buildValidSuffix();
  distinctSuffix.scenes[1].visual =
    'The empty ferry remains tied to the pier as Ada turns toward the hidden signal station.';
  const responses = [
    completion(JSON.stringify(buildValidSuffix()), 'gpt-5.6-sol'),
    completion(JSON.stringify(distinctSuffix), 'gpt-5.6-sol'),
  ];
  const receipts = [];

  const result = await generateBranchMovieResourceList({
    ...commonOptions,
    siblingMovieResourceList,
    maxAttempts: 2,
    retryDelayMs: 1,
    onInferenceResponse: (receipt) => receipts.push(receipt),
    dependencies: {
      createCompatibleChatCompletion: async () => responses.shift(),
      sleep: async () => {},
    },
  });

  assert.equal(receipts.length, 2);
  assert.equal(result.scenes[3].visual, distinctSuffix.scenes[1].visual);
});

test('rejects a divergence at the last scene before calling a provider', async () => {
  let providerCalls = 0;
  await assert.rejects(
    generateBranchMovieResourceList({
      themeJson: {},
      parentMovieResourceList: buildParentMovieResourceList(),
      divergenceSceneIndex: 3,
      divergence: { path_name: 'Too late', path_description: 'No suffix remains.' },
      dependencies: {
        createCompatibleChatCompletion: async () => {
          providerCalls += 1;
          throw new Error('must not be called');
        },
      },
    }),
    (error) => {
      assert.equal(error.code, 'INVALID_BRANCHING_NARRATIVE_INPUT');
      assert.equal(error.status, 400);
      return true;
    },
  );
  assert.equal(providerCalls, 0);
});

test('exports compatible branch movieResourceList aliases for orchestrators', () => {
  assert.equal(generateBranchedMovieResourceList, generateBranchMovieResourceList);
  assert.equal(generateChildMovieResourceList, generateBranchMovieResourceList);
});
