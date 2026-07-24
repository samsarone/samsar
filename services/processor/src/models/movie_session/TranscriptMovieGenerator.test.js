import assert from 'node:assert/strict';
import test from 'node:test';

import { assignCharactersAndInstructionsToScenes } from './MovieGeneratorUtils.js';
import {
  alignSpeechSpeakerNamesToScenes,
  buildPreparedNarrativeVisualPromptList,
  buildMovieResourceListVisualPrompts,
  buildVideoSessionNarrativeArtifactFields,
  buildVideoSessionMovieResourceList,
  ensureNarrativeSpeechGenders,
} from './TranscriptMovieGenerator.js';

test('session artifact fields preserve repaired speech at the same index in both narratives', () => {
  const narrativeJson = {
    scenes: [
      { visual: 'Silent opening.', type: 'base', duration: 5 },
      { visual: 'Narrated reveal.', type: 'narration', duration: 5 },
    ],
    sounds: [
      { type: 'sound_effect', sceneIndex: 0, audio: 'Soft room tone.' },
      {
        type: 'speech',
        subType: 'narration',
        actor: 'Narrator',
        sceneIndex: 1,
        audio: 'The repaired line.',
      },
    ],
  };
  const movieResourceList = {
    ...structuredClone(narrativeJson),
    scenes: narrativeJson.scenes.map((scene, sceneIndex) => ({
      ...scene,
      visual: `Enriched ${sceneIndex}: ${scene.visual}`,
    })),
  };

  const fields = buildVideoSessionNarrativeArtifactFields({
    narrativeJson,
    movieResourceList,
  });

  assert.equal(fields.narrativeJson.sounds[1].audio, 'The repaired line.');
  assert.equal(fields.movieResourceList.sounds[1].audio, 'The repaired line.');
  assert.equal(fields.narrativeJson.sounds[1].sceneIndex, 1);
  assert.equal(fields.movieResourceList.sounds[1].sceneIndex, 1);
  assert.notEqual(fields.narrativeJson, narrativeJson);
  assert.notEqual(fields.movieResourceList, movieResourceList);
  assert.notEqual(fields.narrativeJson.sounds, fields.movieResourceList.sounds);

  fields.narrativeJson.sounds[1].audio = 'mutated persisted copy';
  assert.equal(narrativeJson.sounds[1].audio, 'The repaired line.');
  assert.equal(fields.movieResourceList.sounds[1].audio, 'The repaired line.');
});

test('shared movieResourceList builder preserves the existing stage-one enrichment sequence', async () => {
  const narrativeJson = {
    scenes: [
      {
        sceneIndex: 0,
        duration: 10,
        speaker: 'Narrator',
        prompt: 'A quiet mountain sunrise.',
      },
    ],
    sounds: [],
  };
  const themeJson = { actors: [] };
  const commonOptions = {
    inputPrompt: 'Create a mountain film.',
    themeJson,
    videoTone: 'grounded',
    language: 'auto',
    speakerOptions: null,
    inferenceModel: 'gpt-5.6-sol',
  };

  const legacyGenders = ensureNarrativeSpeechGenders(
    structuredClone(narrativeJson),
    themeJson,
  );
  const legacyCharacters = await assignCharactersAndInstructionsToScenes(
    commonOptions.inputPrompt,
    legacyGenders,
    commonOptions.videoTone,
    {
      language: commonOptions.language,
      speakerOptions: commonOptions.speakerOptions,
      inferenceModel: commonOptions.inferenceModel,
    },
  );
  const legacyResult = alignSpeechSpeakerNamesToScenes(legacyCharacters);

  const sharedResult = await buildVideoSessionMovieResourceList({
    ...commonOptions,
    narrativeJson: structuredClone(narrativeJson),
  });

  assert.deepEqual(sharedResult, legacyResult);
});

test('visual prompt builder selects the scene updater, propagates inference args, and enriches only the result', async () => {
  const movieResourceList = {
    metadata: { source: 'raw-narrative' },
    scenes: [
      {
        visual: 'Bangkok skyline before sunrise.',
        type: 'narration',
        duration: 5,
        startTime: 0,
        endTime: 5,
        speaker: '',
        untouched: 'generic-scene',
      },
      {
        visual: 'Mali opens a riverside flower stall.',
        type: 'character',
        duration: 10,
        startTime: 5,
        endTime: 15,
        speaker: 'Mali',
        untouched: 'character-scene',
      },
    ],
    sounds: [{ type: 'speech', sceneIndex: 1, audio: 'Good morning.' }],
  };
  const rawSnapshot = structuredClone(movieResourceList);
  const themeJson = { style: ['grounded documentary'], actors: [] };
  const updaterCalls = [];
  const receipts = [];
  const commonOptions = {
    movieResourceList,
    themeJson,
    aspectRatio: '16:9',
    inferenceModel: 'QWEN3.7',
    videoTone: 'grounded',
    externalRequestContext: {
      sessionId: 'narrative-request-1',
      userId: 'user-1',
      correlation: 'preserved',
    },
    requestKeyPrefix: 'narrative:create_single:visual',
    onInferenceResponse: (receipt) => receipts.push(receipt),
    dependencies: {
      updatePromptWithTheme: async (...args) => {
        updaterCalls.push({ kind: 'generic', args });
        await args[6].onInferenceResponse({
          stage: 'visual_prompt_generation',
          model: 'qwen3.7-max',
          usage: { input_tokens: 10, output_tokens: 2 },
        });
        return '  Expanded generic visual.  ';
      },
      updateCharacterPromptWithTheme: async (...args) => {
        updaterCalls.push({ kind: 'character', args });
        await args[7].onInferenceResponse({
          stage: 'visual_prompt_generation',
          model: 'qwen3.7-max',
          usage: { input_tokens: 12, output_tokens: 3 },
        });
        return '  Expanded character visual.  ';
      },
    },
  };

  const result = await buildMovieResourceListVisualPrompts(commonOptions);

  assert.equal(updaterCalls.length, 2);
  assert.equal(updaterCalls[0].kind, 'generic');
  assert.deepEqual(updaterCalls[0].args.slice(0, 6), [
    'Bangkok skyline before sunrise.',
    JSON.stringify(themeJson),
    '16:9',
    'QWEN3.7',
    false,
    'grounded',
  ]);
  assert.equal(updaterCalls[1].kind, 'character');
  assert.deepEqual(updaterCalls[1].args.slice(0, 7), [
    'Mali opens a riverside flower stall.',
    'Mali',
    JSON.stringify(themeJson),
    '16:9',
    'QWEN3.7',
    false,
    'grounded',
  ]);

  assert.deepEqual(updaterCalls.map(({ args }) => args.at(-1).externalRequestContext), [
    {
      sessionId: 'narrative-request-1',
      userId: 'user-1',
      correlation: 'preserved',
      requestKey: 'narrative:create_single:visual:scene-0',
    },
    {
      sessionId: 'narrative-request-1',
      userId: 'user-1',
      correlation: 'preserved',
      requestKey: 'narrative:create_single:visual:scene-1',
    },
  ]);
  assert.deepEqual(receipts.map(({ requestKey, sceneIndex }) => ({ requestKey, sceneIndex })), [
    { requestKey: 'narrative:create_single:visual:scene-0', sceneIndex: 0 },
    { requestKey: 'narrative:create_single:visual:scene-1', sceneIndex: 1 },
  ]);
  assert.deepEqual(result.promptList, [
    { prompt: 'Expanded generic visual.', duration: 5, sceneType: 'narration' },
    { prompt: 'Expanded character visual.', duration: 10, sceneType: 'character' },
  ]);

  assert.deepEqual(movieResourceList, rawSnapshot, 'the raw narrative input must remain unchanged');
  assert.deepEqual(result.movieResourceList, {
    ...rawSnapshot,
    scenes: [
      { ...rawSnapshot.scenes[0], visual: 'Expanded generic visual.' },
      { ...rawSnapshot.scenes[1], visual: 'Expanded character visual.' },
    ],
  });
  assert.notEqual(result.movieResourceList, movieResourceList);
  assert.notEqual(result.movieResourceList.scenes, movieResourceList.scenes);
});

test('visual prompt builder rejects an empty generated prompt', async () => {
  const movieResourceList = {
    scenes: [{
      visual: 'A valid source visual.',
      type: 'base',
      duration: 5,
    }],
    sounds: [],
  };

  await assert.rejects(
    buildMovieResourceListVisualPrompts({
      movieResourceList,
      themeJson: { style: ['cinematic'] },
      inferenceModel: 'gpt-5.6-sol',
      dependencies: {
        updatePromptWithTheme: async () => ' \n\t ',
      },
    }),
    (error) => {
      assert.equal(error.code, 'VISUAL_PROMPT_GENERATION_FAILED');
      assert.equal(error.status, 502);
      assert.match(error.message, /empty result for scene 0/i);
      return true;
    },
  );
});

test('prepared narrative visuals become media prompts without inference expansion', () => {
  const movieResourceList = {
    scenes: [
      {
        visual: 'Saved wide establishing prompt.',
        duration: 5,
        type: 'base',
        branchAssetKey: 'scene:0:key',
        branchSourceSceneIndex: 0,
      },
      { visual: 'Saved actor close-up prompt.', duration: 10, type: 'character' },
    ],
    sounds: [],
  };

  assert.deepEqual(buildPreparedNarrativeVisualPromptList(movieResourceList), [
    {
      prompt: 'Saved wide establishing prompt.',
      duration: 5,
      sceneType: 'base',
      branchAssetKey: 'scene:0:key',
      branchSourceSceneIndex: 0,
    },
    { prompt: 'Saved actor close-up prompt.', duration: 10, sceneType: 'character' },
  ]);
});

test('prepared narrative visuals reject invalid saved scene data', () => {
  assert.throws(
    () => buildPreparedNarrativeVisualPromptList({
      scenes: [{ visual: '', duration: 5, type: 'base' }],
      sounds: [],
    }),
    (error) => error.code === 'INVALID_PREPARED_NARRATIVE' && error.status === 422,
  );
});
