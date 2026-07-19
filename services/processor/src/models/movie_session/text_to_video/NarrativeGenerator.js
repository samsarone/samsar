import { isGeminiInferenceModel } from '../../../consts/InferenceModels.js';
import {
  extractGroundedMovieNarrativeFromThemeAndUserPrompt,
  extractGroundedThemeFromUserPrompt,
  extractMovieNarrativeFromThemeAndUserPrompt,
  extractThemeFromUserPrompt,
} from '../../agent/MovieCreatorAgent.js';
import { validateTextToVideoNarrative } from '../utils/TranscriptUtils.js';

export const TEXT_TO_VIDEO_NARRATIVE_MAX_VALIDATION_ATTEMPTS = 5;

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

function buildNarrativeValidationError({ attempts, errors }) {
  const error = new Error(
    `Invalid narrative after ${attempts} attempts: ${(errors || []).join(', ')}`,
  );
  error.code = 'NARRATIVE_VALIDATION_FAILED';
  error.status = 502;
  error.statusCode = 502;
  error.attempts = attempts;
  error.validationErrors = Array.isArray(errors) ? errors : [];
  return error;
}

export async function generateValidatedTextToVideoNarrative({
  prompt,
  duration,
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
  const grounded = videoTone === 'grounded';
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

    validation = validateNarrative(
      generatedNarrative,
      videoGenerationModel,
      undefined,
      {
        repairAdjacentSceneIndex: isGeminiInferenceModel(inferenceModel),
        requestedDuration: duration,
        languageString,
      },
    );

    if (validation.valid) {
      return {
        themeJson,
        narrativeJson: validation.narrativeJson,
        validation,
        attempts: attempt,
      };
    }
  }

  throw buildNarrativeValidationError({
    attempts: normalizedMaxAttempts,
    errors: validation.errors,
  });
}
