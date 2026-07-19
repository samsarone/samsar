import {
  formatVideoDurationSeconds,
  getVideoModelDurationUnitsForFramesPerSecond,
} from '../../../consts/ModelPrices.js';
import {
  getDefaultUserInferenceModel,
  normalizeInferenceModel,
} from '../../../consts/InferenceModels.js';

function formatDurationList(units) {
  if (units.length === 1) {
    return `${formatVideoDurationSeconds(units[0])}`;
  }
  if (units.length === 2) {
    return `${formatVideoDurationSeconds(units[0])} or ${formatVideoDurationSeconds(units[1])}`;
  }
  const labels = units.map(formatVideoDurationSeconds);
  return `${labels.slice(0, -1).join(', ')}, or ${labels[labels.length - 1]}`;
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

  return modelUnits.map((durationSeconds) => ({
    durationSeconds,
    maxCharacters: Math.ceil(durationSeconds * charactersPerSecond),
  }));
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

export function getSpeechDurationStringForModel(model, languageString, framesPerSecond = undefined) {
  const speechCharacterLimits = getSpeechCharacterLimitsForModel(
    model,
    languageString,
    framesPerSecond,
  );
  const modelUnits = speechCharacterLimits.map(({ durationSeconds }) => durationSeconds);
  let durationStr;

  if (speechCharacterLimits.length === 1) {
    const [{ durationSeconds, maxCharacters }] = speechCharacterLimits;
    durationStr =
      `-Each scene can be ${formatVideoDurationSeconds(durationSeconds)} seconds long.\n-Ensure that speech item is never more than ${maxCharacters} characters.`;
  } else {
    const speechLimits = speechCharacterLimits
      .map(({ durationSeconds, maxCharacters }) => (
        `${maxCharacters} characters for ` +
        `${formatVideoDurationSeconds(durationSeconds)} second scenes`
      ))
      .join(', ');

    durationStr =
      `-Each scene can be ${formatDurationList(modelUnits)} seconds long, based on content or speech length.\n-Ensure that speech is never more than ${speechLimits}.
`;

  }
  return durationStr;
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
