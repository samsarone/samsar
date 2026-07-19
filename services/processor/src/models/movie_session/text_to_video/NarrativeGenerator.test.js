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

test('singular narrative generation retries speech beyond the model-aware tolerance', async () => {
  let narrativeCalls = 0;

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
        const audio = narrativeCalls === 1 ? 'a'.repeat(49) : 'a'.repeat(48);
        return {
          scenes: [{
            visual: 'A photograph rests beneath a detective’s desk lamp.',
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
            audio,
            duration: 7.875,
            startTime: 0,
            endTime: 7.875,
          }],
        };
      },
    },
  });

  assert.equal(narrativeCalls, 2);
  assert.equal(result.attempts, 2);
  assert.equal(result.narrativeJson.sounds[0].audio.length, 48);
});
