const REASONING_MODELS = Object.freeze({
  gpt62astra: 'gpt-6.2-astra',
  gpt6astra: 'gpt-6.2-astra',
  gpt56sol: 'gpt-6.2-astra',
  gpt56: 'gpt-6.2-astra',
  gpt6: 'gpt-6.2-astra',
  gpt61sol: 'gpt-6.1-sol',
  claudeopus55: 'claude-opus-5.5',
  claude55opus: 'claude-opus-5.5',
  claudefable52: 'claude-fable-5.2',
  claudefable51: 'claude-fable-5.2',
});

export function parseReasoningModelChoice(value) {
  const token = String(value || '').replace(/^(?:openai|anthropic)\//i, '')
    .replace(/[^a-z0-9]/gi, '').toLowerCase();
  const model = REASONING_MODELS[token.replace(/(?:extrahigh|xhigh|high)$/, '')];
  return model ? { model, effort: /(?:extrahigh|xhigh)$/.test(token) ? 'xhigh' : 'high' } : null;
}

export function supportsInferenceEffort(value) {
  return Boolean(parseReasoningModelChoice(value));
}

export function normalizeGeminiModelChoice(value) {
  let token = String(value || '').trim().replace(/^google[\s/]+/i, '')
    .replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (token.endsWith('high') && !token.endsWith('xhigh')) token = token.slice(0, -4);
  if (token === 'gemini4neon') return 'gemini-4-neon';
  if (['gemini4', 'gemini4carbon', 'gemini4argon'].includes(token)) return 'gemini-4-carbon';
  return null;
}

export function getInferenceModelFamily(value) {
  if (normalizeGeminiModelChoice(value)) return 'Gemini';
  const model = parseReasoningModelChoice(value)?.model;
  return model?.startsWith('gpt-') ? 'GPT' : model?.startsWith('claude-') ? 'Claude' : value;
}
