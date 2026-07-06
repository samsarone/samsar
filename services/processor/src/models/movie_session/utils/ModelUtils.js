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

export function getSpeechDurationStringForModel(model, languageString, framesPerSecond = undefined) {

  const modelUnits = getVideoModelDurationUnitsForFramesPerSecond(model, framesPerSecond);

  let durationStr;
  const charsPerSecond = languageString && languageString.toLowerCase() !== 'english' ? 4 : 5;

  if (modelUnits.length === 1) {
    const maxCharacters = Math.ceil(modelUnits[0] * charsPerSecond);


    durationStr =
      `-Each scene can be ${formatVideoDurationSeconds(modelUnits[0])} seconds long.\n-Ensure that speech item is never more than ${maxCharacters} characters.`;
  } else {
    const speechLimits = modelUnits
      .map((unit) => `${Math.ceil(unit * charsPerSecond)} characters for ${formatVideoDurationSeconds(unit)} second scenes`)
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
