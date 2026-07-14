import {
  getDefaultUserInferenceModel,
  normalizeInferenceModel,
} from './InferenceModels.js';

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

function normalizeAuthorization(value) {
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

function firstNormalizedAuthorization(...values) {
  for (const value of values) {
    const normalized = normalizeAuthorization(value);
    if (normalized) {
      return normalized;
    }
  }
  return '';
}

function getRequestAuthorization(request = {}) {
  return firstNormalizedAuthorization(
    request.userInferenceModelAuthorization,
    request.selectedInferenceModelAuthorization,
    request.inferenceModelAuthorization,
    request.inference_model_authorization,
    request.user_inference_model_authorization,
    request.expressGenerationInferenceModelAuthorization,
  );
}

export function hasRequestInferenceModel(request = {}) {
  return Boolean(getRequestModel(request));
}

export function hasRequestInferenceAuthorization(request = {}) {
  return Boolean(getRequestAuthorization(request));
}

export function resolveRequestInferenceModel({
  request = {},
  session = {},
  user = {},
  fallback = getDefaultUserInferenceModel(),
} = {}) {
  const sessionModel = firstNonEmptyString(
    session.expressGenerationInferenceModel,
    session.inferenceModel,
    session.inference_model,
  );
  const userModel = firstNonEmptyString(
    user.selectedInferenceModel,
    user.inferenceModel,
  );
  return normalizeInferenceModel(getRequestModel(request) || sessionModel || userModel || fallback);
}

export function resolveRequestInferenceAuthorization({
  request = {},
  session = {},
  user = {},
} = {}) {
  return getRequestAuthorization(request) ||
    firstNormalizedAuthorization(
      session.expressGenerationInferenceModelAuthorization,
      session.selectedInferenceModelAuthorization,
      session.inferenceModelAuthorization,
      session.inference_model_authorization,
    ) ||
    firstNormalizedAuthorization(
      user.selectedInferenceModelAuthorization,
      user.inferenceModelAuthorization,
      user.inference_model_authorization,
    ) ||
    undefined;
}

export function resolveRequestInferenceSettings(context = {}) {
  return {
    model: resolveRequestInferenceModel(context),
    authorization: resolveRequestInferenceAuthorization(context),
  };
}

export function withInferenceAuthorization(payload, authorization) {
  const normalizedAuthorization = normalizeAuthorization(authorization);
  return normalizedAuthorization
    ? { ...payload, authorization: normalizedAuthorization }
    : payload;
}
