import assert from 'node:assert/strict';
import test from 'node:test';

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
  const exactNarrativeSystemPrompt =
    '  EXACT FULL NARRATIVE SYSTEM PROMPT\nFinal Response Format: {...}\n';

  const result = await generateValidatedTextToVideoNarrative({
    prompt: 'Create a concise narrated mystery.',
    duration: 10,
    videoGenerationModel: 'COSMOS3SUPERI2V',
    inferenceModel: 'QWEN3.7',
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
        return narrative;
      },
      rewriteNarrativeSpeechItemToFitScene: async ({
        narrativeSystemPrompt,
        scene,
        speechItem,
        maxCharacters,
        options,
      }) => {
        speechRepairCalls += 1;
        assert.equal(narrativeSystemPrompt, exactNarrativeSystemPrompt);
        assert.equal(scene.visual, 'A photograph rests beneath a detective’s desk lamp.');
        assert.deepEqual(speechItem, originalSpeechItem);
        assert.equal(maxCharacters, 57);
        assert.equal(
          options.externalRequestContext.requestKey,
          'text_to_video:speech-repair-1-0-0',
        );
        return { ...speechItem, audio: 'a'.repeat(57) };
      },
    },
  });

  assert.equal(narrativeCalls, 1);
  assert.equal(speechRepairCalls, 1);
  assert.equal(result.attempts, 1);
  assert.equal(result.speechRepairs, 1);
  assert.equal(result.narrativeJson.sounds[0].audio.length, 57);
});

test('does not regenerate the full narrative when focused speech repair fails', async () => {
  let narrativeCalls = 0;
  let speechRepairCalls = 0;

  await assert.rejects(
    generateValidatedTextToVideoNarrative({
      prompt: 'Create a concise narration.',
      duration: 10,
      videoGenerationModel: 'COSMOS3SUPERI2V',
      inferenceModel: 'QWEN3.7',
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
      inferenceModel: 'QWEN3.7',
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
        rewriteNarrativeSpeechItemToFitScene: async ({ speechItem }) => ({
          ...speechItem,
          audio: 'b'.repeat(58),
        }),
      },
    }),
    (error) => {
      assert.equal(error.code, 'NARRATIVE_VALIDATION_FAILED');
      assert.match(error.cause?.message || '', /57-character validation limit/);
      return true;
    },
  );

  assert.equal(narrativeCalls, 1);
});

test('does not run focused speech repair when narrative validation has mixed failures', async () => {
  let narrativeCalls = 0;
  let speechRepairCalls = 0;

  const result = await generateValidatedTextToVideoNarrative({
    prompt: 'Create a concise narrated mystery.',
    duration: 10,
    videoGenerationModel: 'COSMOS3SUPERI2V',
    inferenceModel: 'QWEN3.7',
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
  const repairedSoundIndexes = [];
  const originalAudio = ['a'.repeat(58), 'Already concise.', 'b'.repeat(60)];

  const result = await generateValidatedTextToVideoNarrative({
    prompt: 'Create a concise three-scene narration.',
    duration: 24,
    videoGenerationModel: 'COSMOS3SUPERI2V',
    inferenceModel: 'QWEN3.7',
    videoTone: 'grounded',
    dependencies: {
      extractGroundedThemeFromUserPrompt: async () => ({ style: ['documentary'] }),
      extractGroundedMovieNarrativeFromThemeAndUserPrompt: async () => {
        narrativeCalls += 1;
        return {
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
      },
      rewriteNarrativeSpeechItemToFitScene: async ({ speechItem, options }) => {
        repairedSoundIndexes.push(options.soundIndex);
        return { ...speechItem, audio: `Fixed ${options.soundIndex}.` };
      },
    },
  });

  assert.equal(narrativeCalls, 1);
  assert.deepEqual(repairedSoundIndexes, [0, 2]);
  assert.deepEqual(
    result.narrativeJson.sounds.map(({ audio }) => audio),
    ['Fixed 0.', 'Already concise.', 'Fixed 2.'],
  );
  assert.equal(result.speechRepairs, 2);
});
