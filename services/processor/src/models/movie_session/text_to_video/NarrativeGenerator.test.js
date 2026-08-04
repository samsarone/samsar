import assert from 'node:assert/strict';
import test from 'node:test';

import { assignSpeakersToScenes } from '../MovieGeneratorUtils.js';
import { generateValidatedTextToVideoNarrative } from './NarrativeGenerator.js';

test('retries semantic narrative validation and reports usage for every inference response', async () => {
  const inferenceReceipts = [];
  const narrativeRequestKeys = [];
  let narrativeCalls = 0;
  let validationCalls = 0;

  const result = await generateValidatedTextToVideoNarrative({
    prompt: 'Create a grounded history short.',
    duration: 20,
    videoGenerationModel: 'RUNWAYML',
    inferenceModel: 'gemini-3.1-pro',
    videoTone: 'grounded',
    languageString: 'Thai',
    externalRequestContext: { sessionId: 'request-1', userId: 'user-1' },
    requestKeyPrefix: 'narrative:create_single',
    onInferenceResponse: (receipt) => inferenceReceipts.push(receipt),
    dependencies: {
      extractGroundedThemeFromUserPrompt: async (_prompt, _model, options) => {
        assert.equal(
          options.externalRequestContext.requestKey,
          'narrative:create_single:theme',
        );
        options.onInferenceResponse({
          stage: 'theme_generation',
          attempt: 1,
          model: 'gemini-3.1-pro',
          usage: { input_tokens: 10, output_tokens: 2 },
        });
        return { style: ['documentary'] };
      },
      extractGroundedMovieNarrativeFromThemeAndUserPrompt: async (
        _theme,
        _prompt,
        _duration,
        _videoModel,
        _inferenceModel,
        _language,
        options,
      ) => {
        narrativeCalls += 1;
        narrativeRequestKeys.push(options.externalRequestContext.requestKey);
        options.onInferenceResponse({
          stage: 'narrative_generation',
          attempt: 1,
          model: 'gemini-3.1-pro',
          usage: { input_tokens: 20, output_tokens: 5 },
        });
        return { semanticAttempt: narrativeCalls, scenes: [], sounds: [] };
      },
      validateTextToVideoNarrative: (narrative, model, _fps, options) => {
        validationCalls += 1;
        assert.equal(model, 'RUNWAYML');
        assert.equal(options.repairAdjacentSceneIndex, true);
        assert.equal(options.requestedDuration, 20);
        assert.equal(options.languageString, 'Thai');
        return validationCalls === 1
          ? { valid: false, errors: ['retry me'], narrativeJson: narrative }
          : {
            valid: true,
            errors: [],
            narrativeJson: { ...narrative, normalized: true },
          };
      },
    },
  });

  assert.equal(narrativeCalls, 2);
  assert.deepEqual(narrativeRequestKeys, [
    'narrative:create_single:narrative-1',
    'narrative:create_single:narrative-2',
  ]);
  assert.equal(result.attempts, 2);
  assert.deepEqual(result.themeJson, { style: ['documentary'] });
  assert.deepEqual(result.narrativeJson, {
    semanticAttempt: 2,
    scenes: [],
    sounds: [],
    normalized: true,
  });
  assert.equal(inferenceReceipts.length, 3);
  assert.equal(inferenceReceipts[0].requestKey, 'narrative:create_single:theme');
  assert.equal(inferenceReceipts[0].validationAttempt, null);
  assert.equal(inferenceReceipts[1].validationAttempt, 1);
  assert.equal(inferenceReceipts[2].validationAttempt, 2);
});
test('returns a typed failure after the configured semantic validation attempts', async () => {
  await assert.rejects(
    generateValidatedTextToVideoNarrative({
      prompt: 'Create a short.',
      duration: 10,
      inferenceModel: 'gpt-5.6-sol',
      videoTone: 'cinematic',
      maxValidationAttempts: 2,
      dependencies: {
        extractThemeFromUserPrompt: async () => ({ style: [] }),
        extractMovieNarrativeFromThemeAndUserPrompt: async () => ({ scenes: [], sounds: [] }),
        validateTextToVideoNarrative: (narrative) => ({
          valid: false,
          errors: ['duration mismatch'],
          narrativeJson: narrative,
        }),
      },
    }),
    (error) => {
      assert.equal(error.code, 'NARRATIVE_VALIDATION_FAILED');
      assert.equal(error.status, 502);
      assert.equal(error.attempts, 2);
      assert.deepEqual(error.validationErrors, ['duration mismatch']);
      return true;
    },
  );
});

test('retries until the singular narrative can support the requested branching depth', async () => {
  let narrativeCalls = 0;
  const observedMinimums = [];

  const result = await generateValidatedTextToVideoNarrative({
    prompt: 'Create an interactive journey.',
    duration: 30,
    minimumSceneCount: 3,
    inferenceModel: 'gpt-5.6-sol',
    videoTone: 'cinematic',
    maxValidationAttempts: 2,
    dependencies: {
      extractThemeFromUserPrompt: async () => ({ style: [] }),
      extractMovieNarrativeFromThemeAndUserPrompt: async (
        _theme,
        _prompt,
        _duration,
        _videoModel,
        _inferenceModel,
        _language,
        options,
      ) => {
        narrativeCalls += 1;
        observedMinimums.push(options.minimumSceneCount);
        return {
          scenes: Array.from({ length: narrativeCalls + 1 }, (_unused, index) => ({
            visual: `Scene ${index + 1}`,
          })),
          sounds: [],
        };
      },
      validateTextToVideoNarrative: (narrative) => ({
        valid: true,
        errors: [],
        narrativeJson: narrative,
      }),
    },
  });

  assert.equal(narrativeCalls, 2);
  assert.deepEqual(observedMinimums, [3, 3]);
  assert.equal(result.narrativeJson.scenes.length, 3);
});

test('repairs only speech beyond the model-aware tolerance without regenerating the narrative', async () => {
  let narrativeCalls = 0;
  let speechRepairCalls = 0;
  let originalSpeechItem;
  let originalMovieResourceList;
  const exactNarrativeSystemPrompt =
    '  EXACT FULL NARRATIVE SYSTEM PROMPT\nFinal Response Format: {...}\n';

  const result = await generateValidatedTextToVideoNarrative({
    prompt: 'Create a concise narrated mystery.',
    duration: 10,
    videoGenerationModel: 'COSMOS3SUPERI2V',
    inferenceModel: 'QWEN3.8',
    videoTone: 'grounded',
    maxValidationAttempts: 2,
    externalRequestContext: { sessionId: 'session-1', userId: 'user-1' },
    requestKeyPrefix: 'text_to_video',
    dependencies: {
      extractGroundedThemeFromUserPrompt: async () => ({ style: ['mystery'] }),
      getTextToVideoNarrativeSystemPrompt: () => exactNarrativeSystemPrompt,
      extractGroundedMovieNarrativeFromThemeAndUserPrompt: async (
        _theme,
        _prompt,
        _duration,
        _videoModel,
        _inferenceModel,
        _language,
        options,
      ) => {
        narrativeCalls += 1;
        assert.equal(options.narrativeSystemPrompt, exactNarrativeSystemPrompt);
        const narrative = {
          scenes: [{
            visual: 'A photograph rests beneath a detective’s desk lamp.',
            type: 'narration',
            speaker: '',
            duration: 5,
            startTime: 0,
            endTime: 5,
          }],
          sounds: [{
            type: 'speech',
            subType: 'narration',
            actor: 'Narrator',
            gender: 'F',
            sceneIndex: 0,
            audio: 'a'.repeat(58),
            duration: 5,
            startTime: 0,
            endTime: 5,
          }],
        };
        originalSpeechItem = narrative.sounds[0];
        originalMovieResourceList = narrative;
        return narrative;
      },
      rewriteNarrativeSpeechItemToFitScene: async ({
        movieResourceList,
        scene,
        speechItem,
        maxCharacters,
        options,
      }) => {
        speechRepairCalls += 1;
        assert.notEqual(movieResourceList, originalMovieResourceList);
        assert.deepEqual(movieResourceList, originalMovieResourceList);
        assert.equal(scene.visual, 'A photograph rests beneath a detective’s desk lamp.');
        assert.notEqual(speechItem, originalSpeechItem);
        assert.deepEqual(speechItem, originalSpeechItem);
        assert.equal(speechItem, movieResourceList.sounds[0]);
        assert.equal(maxCharacters, 57);
        assert.equal(
          options.externalRequestContext.requestKey,
          'text_to_video:speech-repair-1-0-0',
        );
        return 'a'.repeat(28);
      },
    },
  });

  assert.equal(narrativeCalls, 1);
  assert.equal(speechRepairCalls, 1);
  assert.equal(result.attempts, 1);
  assert.equal(result.speechRepairs, 1);
  assert.equal(result.narrativeJson.sounds[0].audio.length, 28);
  assert.equal(result.narrativeJson.sounds[0].type, 'speech');
  assert.equal(result.narrativeJson.sounds[0].actor, 'Narrator');
  assert.equal(result.narrativeJson.sounds[0].sceneIndex, 0);
  assert.deepEqual(result.movieResourceList, result.narrativeJson);
  assert.notEqual(result.movieResourceList, result.narrativeJson);
  assert.notEqual(result.movieResourceList.sounds, result.narrativeJson.sounds);
  assert.equal(originalMovieResourceList.sounds[0].audio.length, 58);
});

test('does not regenerate the full narrative when focused speech repair fails', async () => {
  let narrativeCalls = 0;
  let speechRepairCalls = 0;

  await assert.rejects(
    generateValidatedTextToVideoNarrative({
      prompt: 'Create a concise narration.',
      duration: 10,
      videoGenerationModel: 'COSMOS3SUPERI2V',
      inferenceModel: 'QWEN3.8',
      videoTone: 'grounded',
      maxValidationAttempts: 3,
      dependencies: {
        extractGroundedThemeFromUserPrompt: async () => ({ style: [] }),
        extractGroundedMovieNarrativeFromThemeAndUserPrompt: async () => {
          narrativeCalls += 1;
          return {
            scenes: [{
              visual: 'A quiet sunrise.',
              type: 'narration',
              speaker: '',
              duration: 5,
              startTime: 0,
              endTime: 5,
            }],
            sounds: [{
              type: 'speech',
              subType: 'narration',
              actor: 'Narrator',
              gender: 'F',
              sceneIndex: 0,
              audio: 'a'.repeat(58),
              duration: 5,
              startTime: 0,
              endTime: 5,
            }],
          };
        },
        rewriteNarrativeSpeechItemToFitScene: async () => {
          speechRepairCalls += 1;
          throw new Error('Focused repair failed.');
        },
      },
    }),
    (error) => {
      assert.equal(error.code, 'NARRATIVE_VALIDATION_FAILED');
      assert.equal(error.attempts, 1);
      assert.equal(error.cause?.message, 'Focused repair failed.');
      assert.equal(error.validationViolations.length, 1);
      return true;
    },
  );

  assert.equal(narrativeCalls, 1);
  assert.equal(speechRepairCalls, 1);
});

test('rejects an overlong focused replacement without regenerating the full narrative', async () => {
  let narrativeCalls = 0;

  await assert.rejects(
    generateValidatedTextToVideoNarrative({
      prompt: 'Create a concise narration.',
      duration: 10,
      videoGenerationModel: 'COSMOS3SUPERI2V',
      inferenceModel: 'QWEN3.8',
      videoTone: 'grounded',
      maxValidationAttempts: 3,
      dependencies: {
        extractGroundedThemeFromUserPrompt: async () => ({ style: [] }),
        extractGroundedMovieNarrativeFromThemeAndUserPrompt: async () => {
          narrativeCalls += 1;
          return {
            scenes: [{
              visual: 'A quiet sunrise.',
              type: 'narration',
              speaker: '',
              duration: 5,
              startTime: 0,
              endTime: 5,
            }],
            sounds: [{
              type: 'speech',
              subType: 'narration',
              actor: 'Narrator',
              gender: 'F',
              sceneIndex: 0,
              audio: 'a'.repeat(58),
              duration: 5,
              startTime: 0,
              endTime: 5,
            }],
          };
        },
        rewriteNarrativeSpeechItemToFitScene: async () => 'b'.repeat(58),
      },
    }),
    (error) => {
      assert.equal(error.code, 'NARRATIVE_VALIDATION_FAILED');
      assert.match(
        error.cause?.message || '',
        /58 characters for sound 0; 57 are allowed with overshoot tolerance/,
      );
      return true;
    },
  );

  assert.equal(narrativeCalls, 1);
});

test('preserves every sound after focused repair without rerunning full normalization', async () => {
  let narrativeCalls = 0;
  let speechRepairCalls = 0;
  let originalMovieResourceList;

  const result = await generateValidatedTextToVideoNarrative({
    prompt: 'Create a concise narration.',
    duration: 7.875,
    videoGenerationModel: 'COSMOS3SUPERI2V',
    inferenceModel: 'QWEN3.8',
    videoTone: 'grounded',
    maxValidationAttempts: 3,
    dependencies: {
      extractGroundedThemeFromUserPrompt: async () => ({ style: [] }),
      extractGroundedMovieNarrativeFromThemeAndUserPrompt: async () => {
        narrativeCalls += 1;
        const narrative = {
          scenes: [{
            visual: 'A quiet sunrise.',
            type: 'base',
            speaker: '',
            duration: 7.875,
            startTime: 0,
            endTime: 7.875,
          }],
          sounds: [{
            type: 'speech',
            subType: 'narration',
            actor: 'Narrator',
            gender: 'F',
            speaker: 'shimmer',
            provider: 'OPENAI',
            speakerCharacterName: 'Narrator',
            speakerVoiceId: 'shimmer',
            sceneIndex: 0,
            audio: 'a'.repeat(58),
            duration: 7.875,
            startTime: 0,
            endTime: 7.875,
          }],
        };
        originalMovieResourceList = narrative;
        return narrative;
      },
      rewriteNarrativeSpeechItemToFitScene: async ({
        movieResourceList,
        speechItem,
        maxCharacters,
      }) => {
        speechRepairCalls += 1;
        assert.notEqual(movieResourceList, originalMovieResourceList);
        assert.deepEqual(movieResourceList, originalMovieResourceList);
        assert.notEqual(speechItem, originalMovieResourceList.sounds[0]);
        assert.deepEqual(speechItem, originalMovieResourceList.sounds[0]);
        assert.equal(speechItem, movieResourceList.sounds[0]);
        assert.equal(maxCharacters, 57);
        return 'Short repair.';
      },
    },
  });

  assert.equal(narrativeCalls, 1);
  assert.equal(speechRepairCalls, 1);
  assert.equal(originalMovieResourceList.sounds.length, 1);
  assert.equal(originalMovieResourceList.sounds[0].audio.length, 58);
  assert.equal(result.narrativeJson.sounds.length, 1);
  assert.equal(result.narrativeJson.sounds[0].audio, 'Short repair.');
  assert.equal(result.narrativeJson.sounds[0].speaker, 'shimmer');
  assert.equal(result.narrativeJson.sounds[0].provider, 'OPENAI');
  assert.equal(result.narrativeJson.sounds[0].speakerCharacterName, 'Narrator');
  assert.equal(result.narrativeJson.sounds[0].speakerVoiceId, 'shimmer');
  assert.deepEqual(result.movieResourceList, result.narrativeJson);
  assert.equal(result.validation.valid, true);
  assert.deepEqual(result.validation.errors, []);
  assert.deepEqual(result.validation.violations.speechCharacterLimits, []);
  assert.equal(result.validation.repairs.speechCharacterLimits, 1);
});

test('preserves eight sounds when initial normalization would select only five', async () => {
  const scenes = Array.from({ length: 5 }, (_unused, sceneIndex) => ({
    visual: `Narrated scene ${sceneIndex}.`,
    type: 'narration',
    speaker: '',
    duration: 7.875,
    startTime: sceneIndex * 7.875,
    endTime: (sceneIndex + 1) * 7.875,
  }));
  const sounds = [
    ...scenes.map((_scene, sceneIndex) => ({
      type: 'speech',
      subType: 'narration',
      actor: 'Narrator',
      gender: 'F',
      sceneIndex,
      audio: `Concise line ${sceneIndex}.`,
      duration: 7.875,
      startTime: sceneIndex * 7.875,
      endTime: (sceneIndex + 1) * 7.875,
    })),
    ...[0, 1, 2].map((sceneIndex) => ({
      type: 'speech',
      subType: 'narration',
      actor: 'Narrator',
      gender: 'F',
      sceneIndex,
      audio: 'a'.repeat(58),
      duration: 7.875,
      startTime: sceneIndex * 7.875,
      endTime: (sceneIndex + 1) * 7.875,
    })),
  ];
  const originalMovieResourceList = { scenes, sounds };
  const repairedSoundIndexes = [];

  const result = await generateValidatedTextToVideoNarrative({
    prompt: 'Create a narrated sequence.',
    duration: 40,
    videoGenerationModel: 'COSMOS3SUPERI2V',
    inferenceModel: 'QWEN3.8',
    videoTone: 'grounded',
    dependencies: {
      extractGroundedThemeFromUserPrompt: async () => ({ style: [] }),
      extractGroundedMovieNarrativeFromThemeAndUserPrompt: async () => (
        originalMovieResourceList
      ),
      rewriteNarrativeSpeechItemToFitScene: async ({ options }) => {
        repairedSoundIndexes.push(options.soundIndex);
        return `Repaired line ${options.soundIndex}.`;
      },
    },
  });

  assert.deepEqual(repairedSoundIndexes, [5, 6, 7]);
  assert.equal(result.narrativeJson.sounds.length, 8);
  assert.equal(result.movieResourceList.sounds.length, 8);
  assert.deepEqual(
    result.narrativeJson.sounds.slice(5).map(({ audio }) => audio),
    ['Repaired line 5.', 'Repaired line 6.', 'Repaired line 7.'],
  );
  assert.equal(originalMovieResourceList.sounds.length, 8);
  assert.deepEqual(
    originalMovieResourceList.sounds.slice(5).map(({ audio }) => audio.length),
    [58, 58, 58],
  );
});

test('canonicalizes Qwen sound type typos before repairing only overlong speech', async () => {
  const generatedNarrative = {
    scenes: [
      {
        visual: 'Alex speaks directly to camera.',
        type: 'character',
        speaker: 'Alex',
        duration: 7.875,
        startTime: 0,
        endTime: 7.875,
      },
      {
        visual: 'A steel door closes behind Alex.',
        type: 'sound_effect',
        speaker: '',
        duration: 7.875,
        startTime: 7.875,
        endTime: 15.75,
      },
    ],
    sounds: [
      {
        type: 'spech',
        subType: 'character',
        actor: 'Alex',
        gender: 'M',
        sceneIndex: 0,
        audio: 'a'.repeat(58),
        duration: 7.875,
        startTime: 0,
        endTime: 7.875,
      },
      {
        type: 'sound_efect',
        sceneIndex: 1,
        audio: 'A heavy steel door closes.',
        duration: 7.875,
        startTime: 7.875,
        endTime: 15.75,
      },
    ],
  };
  const repairedSoundIndexes = [];

  const result = await generateValidatedTextToVideoNarrative({
    prompt: 'Create a short two-scene sequence.',
    duration: 16,
    videoGenerationModel: 'COSMOS3SUPERI2V',
    inferenceModel: 'QWEN3.8',
    videoTone: 'grounded',
    dependencies: {
      extractGroundedThemeFromUserPrompt: async () => ({ style: [] }),
      extractGroundedMovieNarrativeFromThemeAndUserPrompt: async () => generatedNarrative,
      rewriteNarrativeSpeechItemToFitScene: async ({
        movieResourceList,
        speechItem,
        options,
      }) => {
        repairedSoundIndexes.push(options.soundIndex);
        assert.deepEqual(
          movieResourceList.sounds.map(({ type }) => type),
          ['speech', 'sound_effect'],
        );
        assert.equal(speechItem.type, 'speech');
        return 'Short repaired line.';
      },
    },
  });

  assert.deepEqual(repairedSoundIndexes, [0]);
  assert.deepEqual(
    result.narrativeJson.sounds.map(({ type }) => type),
    ['speech', 'sound_effect'],
  );
  assert.equal(result.narrativeJson.sounds[0].audio, 'Short repaired line.');
  assert.equal(result.narrativeJson.sounds[1].audio, 'A heavy steel door closes.');
  assert.deepEqual(
    generatedNarrative.sounds.map(({ type }) => type),
    ['spech', 'sound_efect'],
  );
});

test('canonicalizes repeated Qwen speech typos before assigning one voice per actor', async () => {
  const generatedNarrative = {
    scenes: Array.from({ length: 3 }, (_unused, sceneIndex) => ({
      visual: `Athena speaks in scene ${sceneIndex}.`,
      type: 'character',
      speaker: 'Athena',
      duration: 7.875,
      startTime: sceneIndex * 7.875,
      endTime: (sceneIndex + 1) * 7.875,
    })),
    sounds: [
      {
        type: 'speech',
        subType: 'character',
        actor: 'Athena',
        gender: 'F',
        sceneIndex: 0,
        audio: 'First line.',
        duration: 7.875,
        startTime: 0,
        endTime: 7.875,
      },
      {
        type: 'spech',
        subType: 'character',
        actor: 'Athena',
        gender: 'F',
        sceneIndex: 1,
        audio: 'a'.repeat(58),
        duration: 7.875,
        startTime: 7.875,
        endTime: 15.75,
      },
      {
        type: 'spech',
        subType: 'character',
        actor: 'Athena',
        gender: 'F',
        sceneIndex: 2,
        audio: 'Final line.',
        duration: 7.875,
        startTime: 15.75,
        endTime: 23.625,
      },
    ],
  };

  const result = await generateValidatedTextToVideoNarrative({
    prompt: 'Create a three-scene Athena sequence.',
    duration: 24,
    videoGenerationModel: 'COSMOS3SUPERI2V',
    inferenceModel: 'QWEN3.8',
    videoTone: 'grounded',
    dependencies: {
      extractGroundedThemeFromUserPrompt: async () => ({ style: [] }),
      extractGroundedMovieNarrativeFromThemeAndUserPrompt: async () => generatedNarrative,
      rewriteNarrativeSpeechItemToFitScene: async () => 'Repaired line.',
    },
  });

  const withSpeakers = assignSpeakersToScenes(structuredClone(result.movieResourceList));
  const athenaSounds = withSpeakers.sounds.filter(({ actor }) => actor === 'Athena');
  assert.equal(athenaSounds.length, 3);
  assert.deepEqual(athenaSounds.map(({ type }) => type), ['speech', 'speech', 'speech']);
  assert.equal(athenaSounds.every(({ speaker }) => Boolean(speaker)), true);
  assert.equal(athenaSounds.every(({ provider }) => Boolean(provider)), true);
  assert.equal(
    athenaSounds.every(({ speakerCharacterName }) => speakerCharacterName === 'Athena'),
    true,
  );
  assert.equal(new Set(athenaSounds.map(({ speaker }) => speaker)).size, 1);
  assert.equal(new Set(athenaSounds.map(({ provider }) => provider)).size, 1);
});

test('runs full validation only once before applying localized speech repairs', async () => {
  let validationCalls = 0;
  const speechLimitMessage = 'Speech exceeds its scene character limit.';

  const result = await generateValidatedTextToVideoNarrative({
    prompt: 'Create a concise narration.',
    duration: 10,
    videoGenerationModel: 'COSMOS3SUPERI2V',
    inferenceModel: 'QWEN3.8',
    videoTone: 'grounded',
    maxValidationAttempts: 1,
    dependencies: {
      extractGroundedThemeFromUserPrompt: async () => ({ style: [] }),
      extractGroundedMovieNarrativeFromThemeAndUserPrompt: async () => ({
        scenes: [
          { visual: 'First scene.', type: 'narration' },
          { visual: 'Second scene.', type: 'narration' },
        ],
        sounds: [{
          type: 'speech',
          subType: 'narration',
          actor: 'Narrator',
          sceneIndex: 0,
          audio: 'a'.repeat(58),
        }],
      }),
      validateTextToVideoNarrative: (narrative) => {
        validationCalls += 1;
        assert.equal(validationCalls, 1, 'full validation must not run after speech repair');
        return {
          valid: false,
          errors: [speechLimitMessage],
          violations: {
            speechCharacterLimits: [{
              message: speechLimitMessage,
              soundIndex: 0,
              sceneIndex: 0,
              promptMaxCharacters: 44,
              validationMaxCharacters: 57,
            }],
          },
          narrativeJson: {
            ...narrative,
            sounds: [],
          },
          repairs: {},
        };
      },
      rewriteNarrativeSpeechItemToFitScene: async () => 'Short repair.',
    },
  });

  assert.equal(validationCalls, 1);
  assert.equal(result.validation.valid, true);
  assert.equal(result.narrativeJson.sounds.length, 1);
  assert.equal(result.narrativeJson.sounds[0].sceneIndex, 0);
  assert.equal(result.narrativeJson.sounds[0].audio, 'Short repair.');
});

test('uses three full narrative-generation attempts by default for pre-speech failures', async () => {
  let narrativeCalls = 0;

  await assert.rejects(
    generateValidatedTextToVideoNarrative({
      prompt: 'Create a valid narrative.',
      duration: 10,
      inferenceModel: 'gpt-5.6-sol',
      videoTone: 'cinematic',
      dependencies: {
        extractThemeFromUserPrompt: async () => ({ style: [] }),
        extractMovieNarrativeFromThemeAndUserPrompt: async () => {
          narrativeCalls += 1;
          return { scenes: [], sounds: [] };
        },
        validateTextToVideoNarrative: (narrative) => ({
          valid: false,
          errors: ['Missing required scene content.'],
          narrativeJson: narrative,
          violations: { speechCharacterLimits: [] },
        }),
      },
    }),
    (error) => {
      assert.equal(error.code, 'NARRATIVE_VALIDATION_FAILED');
      assert.equal(error.attempts, 3);
      return true;
    },
  );

  assert.equal(narrativeCalls, 3);
});

test('retries full narrative generation when a character scene is missing speech', async () => {
  let narrativeCalls = 0;
  let speechRepairCalls = 0;

  const result = await generateValidatedTextToVideoNarrative({
    prompt: 'Create a character-led desert scene.',
    duration: 8,
    videoGenerationModel: 'COSMOS3SUPERI2V',
    inferenceModel: 'QWEN3.8',
    videoTone: 'grounded',
    maxValidationAttempts: 2,
    dependencies: {
      extractGroundedThemeFromUserPrompt: async () => ({ style: ['cinematic'] }),
      extractGroundedMovieNarrativeFromThemeAndUserPrompt: async () => {
        narrativeCalls += 1;
        const scenes = [{
          visual: 'Close-up of Mara, an adult woman, speaking beside a desert monument.',
          type: 'character',
          speaker: 'Mara',
          duration: 7.875,
          startTime: 0,
          endTime: 7.875,
        }];
        return {
          scenes,
          sounds: narrativeCalls === 1
            ? []
            : [{
              type: 'speech',
              subType: 'character',
              actor: 'Mara',
              gender: 'F',
              sceneIndex: 0,
              audio: 'The desert remembers every name.',
              duration: 7.875,
              startTime: 0,
              endTime: 7.875,
            }],
        };
      },
      rewriteNarrativeSpeechItemToFitScene: async () => {
        speechRepairCalls += 1;
        throw new Error('Missing character speech must trigger full narrative regeneration.');
      },
    },
  });

  assert.equal(narrativeCalls, 2);
  assert.equal(speechRepairCalls, 0);
  assert.equal(result.attempts, 2);
  assert.equal(result.narrativeJson.sounds.length, 1);
});

test('does not run focused speech repair when narrative validation has mixed failures', async () => {
  let narrativeCalls = 0;
  let speechRepairCalls = 0;

  const result = await generateValidatedTextToVideoNarrative({
    prompt: 'Create a concise narrated mystery.',
    duration: 10,
    videoGenerationModel: 'COSMOS3SUPERI2V',
    inferenceModel: 'QWEN3.8',
    videoTone: 'grounded',
    maxValidationAttempts: 2,
    dependencies: {
      extractGroundedThemeFromUserPrompt: async () => ({ style: ['mystery'] }),
      extractGroundedMovieNarrativeFromThemeAndUserPrompt: async () => {
        narrativeCalls += 1;
        const valid = narrativeCalls === 2;
        return {
          scenes: [{
            visual: valid ? 'A photograph rests beneath a detective’s desk lamp.' : '   ',
            type: 'narration',
            speaker: '',
            duration: 7.875,
            startTime: 0,
            endTime: 7.875,
          }],
          sounds: [{
            type: 'speech',
            subType: 'narration',
            actor: 'Narrator',
            gender: 'F',
            sceneIndex: 0,
            audio: 'a'.repeat(valid ? 44 : 58),
            duration: 7.875,
            startTime: 0,
            endTime: 7.875,
          }],
        };
      },
      rewriteNarrativeSpeechItemToFitScene: async () => {
        speechRepairCalls += 1;
        throw new Error('Mixed failures must not use focused speech repair.');
      },
    },
  });

  assert.equal(narrativeCalls, 2);
  assert.equal(speechRepairCalls, 0);
  assert.equal(result.attempts, 2);
});

test('repairs every and only overlong speech item in a generated narrative', async () => {
  let narrativeCalls = 0;
  let originalMovieResourceList;
  const repairedSoundIndexes = [];
  const repairContexts = [];
  const originalAudio = ['a'.repeat(58), 'Already concise.', 'b'.repeat(60)];

  const result = await generateValidatedTextToVideoNarrative({
    prompt: 'Create a concise three-scene narration.',
    duration: 24,
    videoGenerationModel: 'COSMOS3SUPERI2V',
    inferenceModel: 'QWEN3.8',
    videoTone: 'grounded',
    dependencies: {
      extractGroundedThemeFromUserPrompt: async () => ({ style: ['documentary'] }),
      extractGroundedMovieNarrativeFromThemeAndUserPrompt: async () => {
        narrativeCalls += 1;
        originalMovieResourceList = {
          scenes: originalAudio.map((_audio, sceneIndex) => ({
            visual: `Documentary scene ${sceneIndex}`,
            type: 'narration',
            speaker: '',
            duration: 7.875,
            startTime: sceneIndex * 7.875,
            endTime: (sceneIndex + 1) * 7.875,
          })),
          sounds: originalAudio.map((audio, sceneIndex) => ({
            type: 'speech',
            subType: 'narration',
            actor: 'Narrator',
            gender: 'F',
            sceneIndex,
            audio,
            duration: 7.875,
            startTime: sceneIndex * 7.875,
            endTime: (sceneIndex + 1) * 7.875,
          })),
        };
        return originalMovieResourceList;
      },
      rewriteNarrativeSpeechItemToFitScene: async ({
        movieResourceList,
        speechItem,
        options,
      }) => {
        repairedSoundIndexes.push(options.soundIndex);
        repairContexts.push(movieResourceList);
        assert.notEqual(movieResourceList, originalMovieResourceList);
        assert.equal(speechItem, movieResourceList.sounds[options.soundIndex]);
        const expectedAudio = options.soundIndex === 0
          ? originalAudio
          : ['Fixed 0.', originalAudio[1], originalAudio[2]];
        assert.deepEqual(movieResourceList.sounds.map(({ audio }) => audio), expectedAudio);
        return `Fixed ${options.soundIndex}.`;
      },
    },
  });

  assert.equal(narrativeCalls, 1);
  assert.deepEqual(repairedSoundIndexes, [0, 2]);
  assert.equal(repairContexts[0], repairContexts[1]);
  assert.deepEqual(
    result.narrativeJson.sounds.map(({ audio }) => audio),
    ['Fixed 0.', 'Already concise.', 'Fixed 2.'],
  );
  assert.deepEqual(
    result.movieResourceList.sounds.map(({ audio }) => audio),
    ['Fixed 0.', 'Already concise.', 'Fixed 2.'],
  );
  assert.notEqual(result.movieResourceList.sounds, result.narrativeJson.sounds);
  assert.equal(result.speechRepairs, 2);
  assert.deepEqual(
    originalMovieResourceList.sounds.map(({ audio }) => audio),
    originalAudio,
  );
});
