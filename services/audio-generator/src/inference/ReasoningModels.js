// Shared contract copied into each independently deployed inference service.
// The suffix is an internal queue alias; providers receive the base model ID.
const MODEL_TOKENS = Object.freeze({
  GPT6ASTRA: 'gpt-6-astra',
  GPT61SOL: 'gpt-6.1-sol',
  CLAUDEOPUS55: 'claude-opus-5.5',
  CLAUDE55OPUS: 'claude-opus-5.5',
  CLAUDEFABLE51: 'claude-fable-5.1',
});

export function normalizeReasoningModel(value) {
  const token = String(value || '').replace(/^(?:openai|anthropic)\//i, '')
    .replace(/[^a-z0-9]/gi, '').toUpperCase();
  const base = MODEL_TOKENS[token.replace(/(?:EXTRAHIGH|XHIGH|HIGH)$/, '')];
  return base ? base + (/(?:EXTRAHIGH|XHIGH)$/.test(token) ? '-xhigh' : '') : null;
}

export function getReasoningModelBase(value) {
  return normalizeReasoningModel(value)?.replace(/-xhigh$/, '') || value;
}

export function isGPTModel(value) {
  return Boolean(normalizeReasoningModel(value)?.startsWith('gpt-'));
}

export function isClaudeModel(value) {
  return Boolean(normalizeReasoningModel(value)?.startsWith('claude-'));
}

export function supportsInferenceEffort(value) {
  return Boolean(normalizeReasoningModel(value));
}

export function resolveInferenceEffort(model, effort) {
  const requested = String(effort || '').toLowerCase();
  return ['high', 'xhigh'].includes(requested) ? requested
    : normalizeReasoningModel(model)?.endsWith('-xhigh') ? 'xhigh' : 'high';
}

export function withInferenceEffort(model, effort) {
  return supportsInferenceEffort(model)
    ? getReasoningModelBase(model) + (resolveInferenceEffort(model, effort) === 'xhigh' ? '-xhigh' : '')
    : model;
}

export function getClaudeProviderModel(model) {
  return getReasoningModelBase(model) === 'claude-fable-5.1' ? 'claude-fable-5-1' : 'claude-opus-5-5';
}

export function getClaudeOpenRouterModel(model, env = process.env) {
  return getReasoningModelBase(model) === 'claude-fable-5.1'
    ? env.OPENROUTER_CLAUDE_FABLE_51_MODEL || 'anthropic/claude-fable-5.1'
    : env.OPENROUTER_CLAUDE_OPUS_55_MODEL || 'anthropic/claude-opus-5.5';
}
