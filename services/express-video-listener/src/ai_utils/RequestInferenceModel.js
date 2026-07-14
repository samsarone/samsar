import {
  getDefaultInferenceModel,
  normalizeInferenceModel,
} from './GoogleGemini.js';

function firstNonEmptyString(...values) {
  return values.find((value) => typeof value === 'string' && value.trim()) || '';
}

function getRequestModel(request = {}) {
  return firstNonEmptyString(
    request.userInferenceModel,
    request.selectedInferenceModel,
    request.inferenceModel,
    request.inference_model,
    request.expressGenerationInferenceModel,
  );
}

function normalizeInferenceAuthorization(value) {
  const normalized = typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[_\s]+/g, '-')
    : '';
  if (normalized === 'native') {
    return 'native';
  }
  if (['deployed', 'samsar', 'samsar-api-key', 'samsar-key'].includes(normalized)) {
    return 'deployed';
  }
  return '';
}

function getRequestAuthorization(request = {}) {
  return firstNonEmptyString(
    request.selectedInferenceModelAuthorization,
    request.inferenceModelAuthorization,
    request.inference_model_authorization,
    request.expressGenerationInferenceModelAuthorization,
  );
}

export function resolveRequestInferenceModel({
  request = {},
  fallbackRequest = {},
  session = {},
  user = {},
  fallback = getDefaultInferenceModel(),
} = {}) {
  const requestedModel = getRequestModel(request) || getRequestModel(fallbackRequest);
  const sessionModel = firstNonEmptyString(
    session.expressGenerationInferenceModel,
    session.inferenceModel,
    session.inference_model,
  );
  const userModel = firstNonEmptyString(
    user.selectedInferenceModel,
    user.inferenceModel,
  );

  return normalizeInferenceModel(requestedModel || sessionModel || userModel || fallback);
}

export function resolveRequestInferenceAuthorization({
  request = {},
  fallbackRequest = {},
  session = {},
  user = {},
} = {}) {
  const requestedAuthorization = normalizeInferenceAuthorization(
    getRequestAuthorization(request) || getRequestAuthorization(fallbackRequest),
  );
  const sessionAuthorization = normalizeInferenceAuthorization(firstNonEmptyString(
    session.expressGenerationInferenceModelAuthorization,
    session.inferenceModelAuthorization,
    session.inference_model_authorization,
    session.selectedInferenceModelAuthorization,
  ));
  const userAuthorization = normalizeInferenceAuthorization(firstNonEmptyString(
    user.selectedInferenceModelAuthorization,
    user.inferenceModelAuthorization,
  ));

  return requestedAuthorization || sessionAuthorization || userAuthorization;
}
