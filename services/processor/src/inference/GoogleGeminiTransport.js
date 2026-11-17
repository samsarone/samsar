import {
  isGeminiCarbonProviderModel,
  normalizeGeminiProviderModel,
} from '../consts/InferenceModels.js';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function resolveGoogleGeminiTransport(chatRequestOrModel, env = process.env) {
  const requestedModel = chatRequestOrModel && typeof chatRequestOrModel === 'object'
    ? chatRequestOrModel.model || chatRequestOrModel.provider_options?.model ||
      chatRequestOrModel.providerOptions?.model || chatRequestOrModel.inference_model ||
      chatRequestOrModel.inferenceModel
    : chatRequestOrModel;
  const model = normalizeGeminiProviderModel(requestedModel).replace(/^google\//i, '');
  const edition = [env?.SAMSAR_DEPLOYMENT_EDITION, env?.SAMSAR_EDITION, env?.CURRENT_ENV]
    .map(value => normalizeString(value).toLowerCase()).find(Boolean);
  if (edition === 'production' && isGeminiCarbonProviderModel(model) &&
      !/(?:^|[-.])cyber(?:[-.]|$)/i.test(model)) {
    const apiKey = normalizeString(env?.GOOGLE_GEMINI_API_KEY) || normalizeString(env?.GEMINI_API_KEY);
    if (apiKey) return { kind: 'developer', model, apiKey };
  }
  return { kind: 'vertex', model };
}

export function buildGoogleGeminiDeveloperUrl({ model, stream = false }) {
  const method = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${method}`;
}
