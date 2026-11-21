import { normalizeGeminiProviderModel } from './InferenceModels.js';
import { getDeploymentEdition } from './DeploymentEnvironment.js';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// This descriptor contains a server credential and must not be logged.
export function resolveGoogleGeminiTransport(chatRequestOrModel, env = process.env) {
  const requestedModel = chatRequestOrModel && typeof chatRequestOrModel === 'object'
    ? chatRequestOrModel.model || chatRequestOrModel.provider_options?.model ||
      chatRequestOrModel.providerOptions?.model || chatRequestOrModel.inference_model ||
      chatRequestOrModel.inferenceModel
    : chatRequestOrModel;
  const model = normalizeGeminiProviderModel(requestedModel).replace(/^google\//i, '');
  if (getDeploymentEdition(env) === 'production' &&
      /^gemini-4-(?:carbon|neon)(?:[.-]|$)/i.test(model) &&
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
