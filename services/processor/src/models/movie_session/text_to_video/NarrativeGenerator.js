import { isGeminiInferenceModel } from '../../../consts/InferenceModels.js';
import {
  extractGroundedMovieNarrativeFromThemeAndUserPrompt,
  extractGroundedThemeFromUserPrompt,
  extractMovieNarrativeFromThemeAndUserPrompt,
  extractThemeFromUserPrompt,
  rewriteNarrativeSpeechItemToFitScene,
} from '../../agent/MovieCreatorAgent.js';
import {
  getTextToVideoNarrativeSystemPrompt,
} from '../../agent/AgentCreatorSystemPrompts.js';
import { validateTextToVideoNarrative } from '../utils/TranscriptUtils.js';

export const TEXT_TO_VIDEO_NARRATIVE_MAX_VALIDATION_ATTEMPTS = 5;

function normalizeMinimumSceneCount(value) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 2 ? count : null;
}

function validateMinimumSceneCount(validation, minimumSceneCount) {
  if (!minimumSceneCount) return validation;
  const sceneCount = Array.isArray(validation?.narrativeJson?.scenes)
    ? validation.narrativeJson.scenes.length
    : 0;
  if (sceneCount >= minimumSceneCount) return validation;
  return {
    ...validation,
    valid: false,
    errors: [
      ...(Array.isArray(validation?.errors) ? validation.errors : []),
      `Narrative has ${sceneCount} scenes but at least ${minimumSceneCount} are required ` +
        'for the requested branching depth.',
    ],
  };
}

function buildInferenceOptions({
  externalRequestContext,
  requestKey,
  onInferenceResponse,
  validationAttempt = null,
}) {
  const normalizedContext = externalRequestContext && typeof externalRequestContext === 'object'
    ? externalRequestContext
    : null;

  return {
    ...(normalizedContext
      ? {
        externalRequestContext: {
          ...normalizedContext,
          requestKey,
        },
      }
      : {}),
    ...(typeof onInferenceResponse === 'function'
      ? {
        onInferenceResponse: (receipt) => onInferenceResponse({
          ...receipt,
          requestKey,
          validationAttempt,
        }),
      }
      : {}),
  };
}

function buildNarrativeValidationError({ attempts, errors, violations, cause }) {
  const error = new Error(
    `Invalid narrative after ${attempts} attempts: ${(errors || []).join(', ')}`,
    cause ? { cause } : undefined,
  );
  error.code = 'NARRATIVE_VALIDATION_FAILED';
  error.status = 502;
  error.statusCode = 502;
  error.attempts = attempts;
  error.validationErrors = Array.isArray(errors) ? errors : [];
  error.validationViolations = Array.isArray(violations) ? violations : [];
  return error;
}

function shouldPropagateSpeechRepairError(error) {
  if (error?.inferenceUsageObserverFailed === true ||
    error?.code === 'INFERENCE_USAGE_OBSERVER_FAILED' ||
    error?.code === 'INFERENCE_PROVIDER_QUOTA_EXHAUSTED') {
    return true;
  }
  if (error instanceof TypeError || error?.retryable === false) {
    return true;
  }
  const status = Number(error?.statusCode ?? error?.status ?? error?.response?.status);
  return status === 401 || status === 403;
}

function getSpeechCharacterLimitViolations(validation) {
  const violations = validation?.violations?.speechCharacterLimits;
  return Array.isArray(violations) ? violations : [];
}

function hasOnlySpeechCharacterLimitViolations(validation) {
  const errors = Array.isArray(validation?.errors) ? validation.errors : [];
  const violations = getSpeechCharacterLimitViolations(validation);
  if (violations.length === 0 || errors.length !== violations.length) {
    return false;
  }

  const remainingMessages = new Map();
  violations.forEach(({ message }) => {
    remainingMessages.set(message, (remainingMessages.get(message) || 0) + 1);
  });
  return errors.every((message) => {
    const count = remainingMessages.get(message) || 0;
    if (count === 0) return false;
    remainingMessages.set(message, count - 1);
    return true;
  });
}

function cloneNarrativeForSpeechRepair(narrative) {
  return {
    ...narrative,
    scenes: narrative.scenes.map((scene) => ({ ...scene })),
    sounds: narrative.sounds.map((sound) => ({ ...sound })),
  };
}

function validateGeneratedNarrative({
  narrative,
  validateNarrative,
  videoGenerationModel,
  inferenceModel,
  duration,
  languageString,
  minimumSceneCount,
}) {
  return validateMinimumSceneCount(validateNarrative(
    narrative,
    videoGenerationModel,
    undefined,
    {
      repairAdjacentSceneIndex: isGeminiInferenceModel(inferenceModel),
      requestedDuration: duration,
      languageString,
    },
  ), minimumSceneCount);
}

export async function generateValidatedTextToVideoNarrative({
  prompt,
  duration,
  minimumSceneCount = null,
  videoGenerationModel = 'RUNWAYML',
  inferenceModel,
  videoTone = 'grounded',
  languageString,
  externalRequestContext = null,
  requestKeyPrefix = 'text_to_video',
  onInferenceResponse,
  maxValidationAttempts = TEXT_TO_VIDEO_NARRATIVE_MAX_VALIDATION_ATTEMPTS,
  dependencies = {},
} = {}) {
  const extractGroundedTheme = dependencies.extractGroundedThemeFromUserPrompt ||
    extractGroundedThemeFromUserPrompt;
  const extractTheme = dependencies.extractThemeFromUserPrompt || extractThemeFromUserPrompt;
  const extractGroundedNarrative = dependencies.extractGroundedMovieNarrativeFromThemeAndUserPrompt ||
    extractGroundedMovieNarrativeFromThemeAndUserPrompt;
  const extractNarrative = dependencies.extractMovieNarrativeFromThemeAndUserPrompt ||
    extractMovieNarrativeFromThemeAndUserPrompt;
  const validateNarrative = dependencies.validateTextToVideoNarrative ||
    validateTextToVideoNarrative;
  const rewriteSpeechItem = dependencies.rewriteNarrativeSpeechItemToFitScene ||
    rewriteNarrativeSpeechItemToFitScene;
  const buildNarrativeSystemPrompt = dependencies.getTextToVideoNarrativeSystemPrompt ||
    getTextToVideoNarrativeSystemPrompt;
  const grounded = videoTone === 'grounded';
  const normalizedMinimumSceneCount = normalizeMinimumSceneCount(minimumSceneCount);
  const narrativeSystemPrompt = buildNarrativeSystemPrompt({
    duration,
    videoModel: videoGenerationModel,
    grounded,
    languageString,
    minimumSceneCount: normalizedMinimumSceneCount,
  });
  const themeOptions = buildInferenceOptions({
    externalRequestContext,
    requestKey: `${requestKeyPrefix}:theme`,
    onInferenceResponse,
  });
  const themeJson = grounded
    ? await extractGroundedTheme(prompt, inferenceModel, themeOptions)
    : await extractTheme(prompt, inferenceModel, themeOptions);

  const normalizedMaxAttempts = Number.isInteger(maxValidationAttempts) && maxValidationAttempts > 0
    ? maxValidationAttempts
    : TEXT_TO_VIDEO_NARRATIVE_MAX_VALIDATION_ATTEMPTS;
  let validation = { valid: false, errors: [] };

  for (let attempt = 1; attempt <= normalizedMaxAttempts; attempt += 1) {
    const narrativeOptions = buildInferenceOptions({
      externalRequestContext,
      requestKey: `${requestKeyPrefix}:narrative-${attempt}`,
      onInferenceResponse,
      validationAttempt: attempt,
    });
    if (normalizedMinimumSceneCount) {
      narrativeOptions.minimumSceneCount = normalizedMinimumSceneCount;
    }
    narrativeOptions.narrativeSystemPrompt = narrativeSystemPrompt;
    const generatedNarrative = grounded
      ? await extractGroundedNarrative(
        themeJson,
        prompt,
        duration,
        videoGenerationModel,
        inferenceModel,
        languageString,
        narrativeOptions,
      )
      : await extractNarrative(
        themeJson,
        prompt,
        duration,
        videoGenerationModel,
        inferenceModel,
        languageString,
        narrativeOptions,
      );

    validation = validateGeneratedNarrative({
      narrative: generatedNarrative,
      validateNarrative,
      videoGenerationModel,
      inferenceModel,
      duration,
      languageString,
      minimumSceneCount: normalizedMinimumSceneCount,
    });

    if (validation.valid) {
      return {
        themeJson,
        narrativeJson: validation.narrativeJson,
        validation,
        attempts: attempt,
      };
    }

    if (hasOnlySpeechCharacterLimitViolations(validation)) {
      const violations = getSpeechCharacterLimitViolations(validation);
      const repairable = Array.isArray(generatedNarrative?.scenes) &&
        Array.isArray(generatedNarrative?.sounds) &&
        violations.every(({ soundIndex, sceneIndex }) => (
          Number.isSafeInteger(soundIndex) &&
          Number.isSafeInteger(sceneIndex) &&
          String(generatedNarrative.sounds[soundIndex]?.type || '').trim().toLowerCase() ===
            'speech' &&
          Boolean(generatedNarrative.scenes[sceneIndex])
        ));

      if (repairable) {
        const repairedNarrative = cloneNarrativeForSpeechRepair(generatedNarrative);
        try {
          for (const violation of violations) {
            const {
              soundIndex,
              sceneIndex,
              promptMaxCharacters,
              validationMaxCharacters,
            } = violation;
            const speechItem = repairedNarrative.sounds[soundIndex];
            const scene = repairedNarrative.scenes[sceneIndex];
            const repairMaxCharacters = Number.isSafeInteger(validationMaxCharacters)
              ? validationMaxCharacters
              : promptMaxCharacters;
            const repairOptions = buildInferenceOptions({
              externalRequestContext,
              requestKey:
                `${requestKeyPrefix}:speech-repair-${attempt}-${sceneIndex}-${soundIndex}`,
              onInferenceResponse,
              validationAttempt: attempt,
            });
            const replacement = await rewriteSpeechItem({
              narrativeSystemPrompt,
              scene,
              speechItem,
              maxCharacters: repairMaxCharacters,
              inferenceModel,
              options: {
                ...repairOptions,
                sceneIndex,
                soundIndex,
              },
            });
            const replacementAudio = typeof replacement?.audio === 'string'
              ? replacement.audio.trim()
              : '';
            if (!replacementAudio) {
              throw new Error('Narrative speech repair returned empty audio.');
            }
            if (Array.from(replacementAudio).length > repairMaxCharacters) {
              throw new Error(
                `Narrative speech repair exceeded the ${repairMaxCharacters}-character ` +
                  'validation limit.',
              );
            }
            repairedNarrative.sounds[soundIndex] = {
              ...speechItem,
              audio: replacementAudio,
            };
          }
        } catch (cause) {
          if (shouldPropagateSpeechRepairError(cause)) {
            throw cause;
          }
          throw buildNarrativeValidationError({
            attempts: attempt,
            errors: validation.errors,
            violations,
            cause,
          });
        }

        validation = validateGeneratedNarrative({
          narrative: repairedNarrative,
          validateNarrative,
          videoGenerationModel,
          inferenceModel,
          duration,
          languageString,
          minimumSceneCount: normalizedMinimumSceneCount,
        });
        if (validation.valid) {
          return {
            themeJson,
            narrativeJson: validation.narrativeJson,
            validation,
            attempts: attempt,
            speechRepairs: violations.length,
          };
        }
        throw buildNarrativeValidationError({
          attempts: attempt,
          errors: validation.errors,
          violations: getSpeechCharacterLimitViolations(validation),
        });
      }

      throw buildNarrativeValidationError({
        attempts: attempt,
        errors: validation.errors,
        violations,
      });
    }
  }

  throw buildNarrativeValidationError({
    attempts: normalizedMaxAttempts,
    errors: validation.errors,
  });
}
