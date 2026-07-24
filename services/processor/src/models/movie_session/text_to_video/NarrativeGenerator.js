import {
  isGeminiInferenceModel,
  isQwenInferenceModel,
} from '../../../consts/InferenceModels.js';
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

export const TEXT_TO_VIDEO_NARRATIVE_MAX_VALIDATION_ATTEMPTS = 3;

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

function getSpeechRepairAcceptanceLimit(violation) {
  if (Number.isSafeInteger(violation?.validationMaxCharacters)) {
    return violation.validationMaxCharacters;
  }
  return Number.isSafeInteger(violation?.promptMaxCharacters)
    ? violation.promptMaxCharacters
    : null;
}

function getSpeechRepairLocalValidationError(repairedNarrative, violations) {
  for (const violation of violations) {
    const soundIndex = violation?.soundIndex;
    const repairedAudio = typeof repairedNarrative?.sounds?.[soundIndex]?.audio === 'string'
      ? repairedNarrative.sounds[soundIndex].audio.trim()
      : '';
    const acceptanceLimit = getSpeechRepairAcceptanceLimit(violation);
    if (!repairedAudio) {
      return new Error(`Narrative speech repair returned empty audio for sound ${soundIndex}.`);
    }
    if (acceptanceLimit === null) {
      return new Error(
        `Narrative speech repair has no character limit for sound ${soundIndex}.`,
      );
    }
    const repairedCharacterCount = Array.from(repairedAudio).length;
    if (repairedCharacterCount > acceptanceLimit) {
      return new Error(
        `Narrative speech repair returned ${repairedCharacterCount} characters for sound ` +
          `${soundIndex}; ${acceptanceLimit} are allowed with overshoot tolerance.`,
      );
    }
  }
  return null;
}

function buildSuccessfulSpeechRepairValidation(validation, repairedNarrative, speechRepairs) {
  return {
    ...validation,
    valid: true,
    errors: [],
    narrativeJson: cloneNarrativeForSpeechRepair(repairedNarrative),
    violations: {
      ...(validation?.violations || {}),
      speechCharacterLimits: [],
    },
    repairs: {
      ...(validation?.repairs || {}),
      speechCharacterLimits: speechRepairs,
    },
  };
}

function buildSuccessfulNarrativeGeneration({
  themeJson,
  narrativeJson,
  validation,
  attempts,
  speechRepairs,
}) {
  const stableNarrativeJson = cloneNarrativeForSpeechRepair(narrativeJson);
  return {
    themeJson,
    narrativeJson: stableNarrativeJson,
    movieResourceList: cloneNarrativeForSpeechRepair(stableNarrativeJson),
    validation,
    attempts,
    ...(Number.isSafeInteger(speechRepairs) ? { speechRepairs } : {}),
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
      repairSoundTypes: isQwenInferenceModel(inferenceModel),
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
      return buildSuccessfulNarrativeGeneration({
        themeJson,
        narrativeJson: validation.narrativeJson,
        validation,
        attempts: attempt,
      });
    }

    if (hasOnlySpeechCharacterLimitViolations(validation)) {
      const violations = getSpeechCharacterLimitViolations(validation);
      console.error(
        '[model][NarrativeGenerator][text_to_video] speech_length_validation_failed',
        {
          sessionId: externalRequestContext?.sessionId || null,
          validationAttempt: attempt,
          violations: violations.map((violation) => ({
            soundIndex: violation?.soundIndex ?? null,
            sceneIndex: violation?.sceneIndex ?? null,
            actualCharacters: violation?.actualCharacters ?? null,
            validationMaxCharacters: violation?.validationMaxCharacters ?? null,
          })),
        },
      );
      const soundTypeRepairCount = Array.isArray(validation?.repairs?.soundTypes)
        ? validation.repairs.soundTypes.length
        : 0;
      const repairSourceNarrative = soundTypeRepairCount > 0 &&
        Array.isArray(validation?.canonicalNarrativeJson?.scenes) &&
        Array.isArray(validation?.canonicalNarrativeJson?.sounds)
        ? validation.canonicalNarrativeJson
        : generatedNarrative;
      const repairable = Array.isArray(repairSourceNarrative?.scenes) &&
        Array.isArray(repairSourceNarrative?.sounds) &&
        violations.every(({ soundIndex, sceneIndex }) => (
          Number.isSafeInteger(soundIndex) &&
          Number.isSafeInteger(sceneIndex) &&
          String(repairSourceNarrative.sounds[soundIndex]?.type || '').trim().toLowerCase() ===
            'speech' &&
          Boolean(repairSourceNarrative.scenes[sceneIndex])
        ));

      if (repairable) {
        const repairedNarrative = cloneNarrativeForSpeechRepair(repairSourceNarrative);
        try {
          for (const violation of violations) {
            const {
              soundIndex,
              sceneIndex,
              promptMaxCharacters,
              validationMaxCharacters,
            } = violation;
            const originalSpeechItem = repairedNarrative.sounds[soundIndex];
            const scene = repairedNarrative.scenes[sceneIndex];
            const requiredMaxCharacters = Number.isSafeInteger(validationMaxCharacters)
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
              movieResourceList: repairedNarrative,
              scene,
              speechItem: originalSpeechItem,
              maxCharacters: requiredMaxCharacters,
              inferenceModel,
              options: {
                ...repairOptions,
                sceneIndex,
                soundIndex,
              },
            });
            const replacementAudio = typeof replacement === 'string'
              ? replacement.trim()
              : '';
            if (!replacementAudio) {
              throw new Error('Narrative speech repair returned empty audio.');
            }
            repairedNarrative.sounds[soundIndex] = {
              ...originalSpeechItem,
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

        const localValidationError = getSpeechRepairLocalValidationError(
          repairedNarrative,
          violations,
        );
        if (localValidationError) {
          throw buildNarrativeValidationError({
            attempts: attempt,
            errors: [localValidationError.message],
            violations,
            cause: localValidationError,
          });
        }
        validation = buildSuccessfulSpeechRepairValidation(
          validation,
          repairedNarrative,
          violations.length,
        );
        return buildSuccessfulNarrativeGeneration({
          themeJson,
          narrativeJson: repairedNarrative,
          validation,
          attempts: attempt,
          speechRepairs: violations.length,
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
