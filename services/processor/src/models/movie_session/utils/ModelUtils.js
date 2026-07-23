import {
  formatVideoDurationSeconds,
  getVideoModelDurationUnitsForFramesPerSecond,
} from '../../../consts/ModelPrices.js';
import {
  getDefaultUserInferenceModel,
  normalizeInferenceModel,
} from '../../../consts/InferenceModels.js';

export const TEXT_TO_VIDEO_SPEECH_CHARACTER_BOUNDARY_INCREASE_RATIO = 0.1;
export const TEXT_TO_VIDEO_SPEECH_CHARACTER_OVERSHOOT_RATIO = 0.3;

function formatDurationList(units) {
  if (units.length === 1) {
    return `${formatSpeechPromptDurationSeconds(units[0])}`;
  }
  if (units.length === 2) {
    return `${formatSpeechPromptDurationSeconds(units[0])} or ${formatSpeechPromptDurationSeconds(units[1])}`;
  }
  const labels = units.map(formatSpeechPromptDurationSeconds);
  return `${labels.slice(0, -1).join(', ')}, or ${labels[labels.length - 1]}`;
}

function formatSpeechPromptDurationSeconds(durationSeconds) {
  return formatVideoDurationSeconds(Math.floor(durationSeconds));
}

export function getSpeechCharacterLimitsForModel(
  model,
  languageString,
  framesPerSecond = undefined,
) {
  const modelUnits = getVideoModelDurationUnitsForFramesPerSecond(model, framesPerSecond);
  const normalizedLanguage = typeof languageString === 'string'
    ? languageString.trim().toLowerCase()
    : '';
  const charactersPerSecond = normalizedLanguage && normalizedLanguage !== 'english'
    ? 4
    : 5;

  return modelUnits.map((durationSeconds) => {
    const originalMaxCharacters = Math.ceil(durationSeconds * charactersPerSecond);
    const maxCharacters = Math.ceil(
      originalMaxCharacters +
        (originalMaxCharacters * TEXT_TO_VIDEO_SPEECH_CHARACTER_BOUNDARY_INCREASE_RATIO),
    );
    return {
      durationSeconds,
      originalMaxCharacters,
      maxCharacters,
      validationMaxCharacters: Math.floor(
        maxCharacters + (maxCharacters * TEXT_TO_VIDEO_SPEECH_CHARACTER_OVERSHOOT_RATIO),
      ),
      overshootRatio: TEXT_TO_VIDEO_SPEECH_CHARACTER_OVERSHOOT_RATIO,
    };
  });
}

export function getMaxSpeechCharacterLimitForModel(
  model,
  languageString,
  framesPerSecond = undefined,
) {
  const limits = getSpeechCharacterLimitsForModel(model, languageString, framesPerSecond);
  return limits.reduce((maximum, current) => (
    !maximum || current.durationSeconds > maximum.durationSeconds ? current : maximum
  ), null);
}

export function getSpeechCharacterLimitForDuration(
  model,
  durationSeconds,
  languageString,
  framesPerSecond = undefined,
) {
  const limits = getSpeechCharacterLimitsForModel(model, languageString, framesPerSecond);
  if (limits.length === 0) return null;

  const numericDuration = Number(durationSeconds);
  if (!Number.isFinite(numericDuration) || numericDuration <= 0) {
    return limits[0];
  }

  return limits.find((limit) => limit.durationSeconds >= numericDuration) || limits.at(-1);
}

export function getSpeechDurationStringForModel(model, languageString, framesPerSecond = undefined) {
  const speechCharacterLimits = getSpeechCharacterLimitsForModel(
    model,
    languageString,
    framesPerSecond,
  );
  const modelUnits = speechCharacterLimits.map(({ durationSeconds }) => durationSeconds);
  const durationOptions = formatDurationList(modelUnits);
  const durationQualifier = speechCharacterLimits.length === 2 ? 'either ' : '';
  const speechLimits = speechCharacterLimits.map(({ durationSeconds, maxCharacters }) => (
    `${maxCharacters} characters or fewer for a ` +
    `${formatSpeechPromptDurationSeconds(durationSeconds)}-second scene`
  ));
  const formattedSpeechLimits = speechLimits.length > 1
    ? `${speechLimits.slice(0, -1).join(', ')}${speechLimits.length > 2 ? ',' : ''} and ${speechLimits.at(-1)}`
    : speechLimits[0];

  return (
    `- Each scene must be ${durationQualifier}${durationOptions} seconds long.\n` +
    `- Keep each speech "audio" line within its scene's available speaking time: ` +
    `${formattedSpeechLimits}; spaces and punctuation count toward the limit.`
  );
}


export function getMaxDurationForModelForScenes(model, numScenes, framesPerSecond = undefined) {
  const modelUnits = getVideoModelDurationUnitsForFramesPerSecond(model, framesPerSecond);
  const maxUnit = Math.max(...modelUnits);
  const maxAllowedDuration = maxUnit * numScenes;
  return maxAllowedDuration;
}


export function getFunctionCallParamsForModel(modelName, messageList) {
  return {
    messages: messageList,
    model: normalizeInferenceModel(modelName),
  };
}

export function getModelForUserInferenceModel(userInferenceModel = getDefaultUserInferenceModel()) {
  return normalizeInferenceModel(userInferenceModel || getDefaultUserInferenceModel());
}
