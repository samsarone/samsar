import {
  GPT_56_SOL_INFERENCE_MODEL,
  GPT_56_SOL_XHIGH_INFERENCE_MODEL,
  getDefaultInferenceModel,
  getGPT56SolReasoningEffort,
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

export function resolveRequestInferenceEffort({
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
      getRequestEffort(fallbackRequest) ||
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
