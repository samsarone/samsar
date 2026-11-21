function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeGeminiModel(value) {
  const normalized = normalizeString(value).toLowerCase().replace(/^google\//, '');
  const alias = normalized.replace(/[^a-z0-9]/g, '').replace(/^google/, '');
  if (/^gemini4neon(?:high)?$/.test(alias)) return 'gemini-4-neon';
  if (/^gemini4(?:(?:carbon|argon))?(?:high)?$/.test(alias) ||
      /^gemini-4-argon(?:-[0-9]{8})?$/.test(normalized)) {
    return 'gemini-4-carbon';
  }
  return normalized;
}

export function resolveGoogleGeminiTransport(chatRequestOrModel, env = process.env) {
  const requestedModel = chatRequestOrModel && typeof chatRequestOrModel === 'object'
    ? chatRequestOrModel.model || chatRequestOrModel.provider_options?.model ||
      chatRequestOrModel.providerOptions?.model || chatRequestOrModel.inference_model ||
      chatRequestOrModel.inferenceModel
    : chatRequestOrModel;
  const model = normalizeGeminiModel(requestedModel);
  const edition = [env.SAMSAR_DEPLOYMENT_EDITION, env.SAMSAR_EDITION, env.CURRENT_ENV]
    .map(value => normalizeString(value).toLowerCase()).find(Boolean);
  if (edition === 'production' &&
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
