const text = (value) => typeof value === 'string' ? value.trim() : '';

export function getLyriaGeminiApiKey(env = process.env) {
  return text(env.GOOGLE_LYRIA_GEMINI_API_KEY) || text(env.GEMINI_API_KEY) || text(env.GOOGLE_API_KEY);
}

export function usesLyriaGeminiApi(env = process.env) {
  const provider = text(env.GOOGLE_LYRIA_API_PROVIDER).toLowerCase();
  if (provider === 'vertex') return false;
  return provider === 'gemini' || Boolean(getLyriaGeminiApiKey(env));
}

export function resolveLyriaModel(env = process.env) {
  return text(env.GOOGLE_LYRIA_3_MODEL) || text(env.GOOGLE_LYRIA_MODEL)
    || (usesLyriaGeminiApi(env) ? 'lyria-3.5' : 'lyria-3-pro-preview');
}
