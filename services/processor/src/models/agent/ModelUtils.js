
import {
  getDefaultUserInferenceModel,
  normalizeInferenceModel,
} from '../../consts/InferenceModels.js';

export function getFunctionCallParamsForModel(modelName, messageList) {
  return {
    messages: messageList,
    model: normalizeInferenceModel(modelName),
  };
}

export function getModelForUserInferenceModel(userInferenceModel = getDefaultUserInferenceModel()) {
  return normalizeInferenceModel(userInferenceModel || getDefaultUserInferenceModel());
}
