const REASONING_MODELS = Object.freeze({
  gpt6astra: 'gpt-6-astra',
  gpt61sol: 'gpt-6.1-sol',
  claudeopus55: 'claude-opus-5.5',
  claude55opus: 'claude-opus-5.5',
  claudefable51: 'claude-fable-5.1',
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

export function getInferenceModelFamily(value) {
  const model = parseReasoningModelChoice(value)?.model;
  return model?.startsWith('gpt-') ? 'GPT' : model?.startsWith('claude-') ? 'Claude' : value;
}
