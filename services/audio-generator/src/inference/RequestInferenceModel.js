import {
  GPT_56_SOL_INFERENCE_MODEL,
  GPT_56_SOL_XHIGH_INFERENCE_MODEL,
  getDefaultUserInferenceModel,
  getGPT56SolReasoningEffort,
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

function getRequestEffort(request = {}) {
  return firstNonEmptyString(
    request.effort,
    request.inferenceEffort,
    request.selectedInferenceEffort,
    request.reasoningEffort,
    request.reasoning_effort,
    request.reasoning?.effort,
    request.expressGenerationInferenceEffort,
  );
}

function getLegacyModelEffort(model) {
  const normalized = typeof model === 'string'
    ? model.trim().toLowerCase().replace(/[_\s]+/g, '-')
    : '';
  if (!normalized.startsWith(GPT_56_SOL_INFERENCE_MODEL)) return '';
  if (normalized.includes('xhigh') || normalized.includes('extra-high')) return 'xhigh';
  return normalized.endsWith('-high') ? 'high' : '';
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

export function resolveRequestInferenceEffort({
  request = {},
  session = {},
  user = {},
  fallback = getDefaultUserInferenceModel(),
} = {}) {
  const requestedModel = getRequestModel(request);
  const sessionModel = firstNonEmptyString(
    session.expressGenerationInferenceModel,
    session.inferenceModel,
    session.inference_model,
  );
  const userModel = firstNonEmptyString(user.selectedInferenceModel, user.inferenceModel);
  const sourceModel = requestedModel || sessionModel || userModel || fallback;
  const normalizedModel = normalizeInferenceModel(sourceModel);
  if (
    normalizedModel !== GPT_56_SOL_INFERENCE_MODEL &&
    normalizedModel !== GPT_56_SOL_XHIGH_INFERENCE_MODEL
  ) {
    return undefined;
  }
  return getGPT56SolReasoningEffort(
    sourceModel,
    getRequestEffort(request) ||
      getLegacyModelEffort(requestedModel) ||
      firstNonEmptyString(
        session.expressGenerationInferenceEffort,
        session.inferenceEffort,
        session.inference_effort,
        session.selectedInferenceEffort,
      ) ||
      getLegacyModelEffort(sessionModel) ||
      user.selectedInferenceEffort ||
      getLegacyModelEffort(userModel),
  );
}

export function resolveRequestInferenceSettings(context = {}) {
  const effort = resolveRequestInferenceEffort(context);
  const model = resolveRequestInferenceModel(context);
  return {
    model: effort === 'xhigh' && (
      model === GPT_56_SOL_INFERENCE_MODEL || model === GPT_56_SOL_XHIGH_INFERENCE_MODEL
    ) ? GPT_56_SOL_XHIGH_INFERENCE_MODEL : model === GPT_56_SOL_XHIGH_INFERENCE_MODEL
      ? GPT_56_SOL_INFERENCE_MODEL
      : model,
    ...(effort ? { effort } : {}),
    authorization: resolveRequestInferenceAuthorization(context),
  };
}

export function withInferenceAuthorization(payload, authorization) {
  const normalizedAuthorization = normalizeAuthorization(authorization);
  return normalizedAuthorization
    ? { ...payload, authorization: normalizedAuthorization }
    : payload;
}
