function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function collectErrorValues(error) {
  const values = [];
  const pending = [error];
  const visited = new Set();

  while (pending.length > 0) {
    const current = pending.shift();
    if (!current || typeof current !== 'object' || visited.has(current)) {
      continue;
    }
    visited.add(current);
    values.push(current);
    pending.push(
      current.cause,
      current.error,
      current.response,
      current.response?.data,
      current.response?.data?.error,
    );
  }

  return values;
}

function getErrorCode(error) {
  for (const value of collectErrorValues(error)) {
    const code = normalizeString(value.code || value.type);
    if (code) return code.toLowerCase();
  }
  return '';
}

function getErrorMessage(error) {
  for (const value of collectErrorValues(error)) {
    const message = normalizeString(value.message);
    if (message) return message;
  }
  return '';
}

function isQuotaExhaustionError(error) {
  const code = getErrorCode(error);
  const message = getErrorMessage(error).toLowerCase();

  return [
    'insufficient_quota',
    'quota_exceeded',
    'insufficient_credit',
  ].includes(code) ||
    message.includes('quota has been exhausted') ||
    message.includes('quota is exhausted') ||
    message.includes('insufficient quota') ||
    message.includes('out of credits') ||
    message.includes('insufficient credit');
}

function getModelLabel(model) {
  const normalized = normalizeString(model).toLowerCase();
  if (normalized.includes('qwen')) return 'Qwen';
  if (normalized.includes('gemini')) return 'Gemini';
  if (normalized.includes('gpt') || normalized.includes('openai')) return 'OpenAI';
  return 'Inference provider';
}

function extractQuotaResetNotice(error) {
  const message = getErrorMessage(error);
  const match = message.match(/quota will reset at\s+([a-z0-9,:+\-/ ]{1,80})(?:\.|$)/i);
  if (!match) return '';
  return ` The quota will reset at ${match[1].trim()}.`;
}

export function createPublicInferenceError(error, { model } = {}) {
  if (!isQuotaExhaustionError(error)) {
    return null;
  }

  const message = `${getModelLabel(model)} inference quota has been exhausted.` +
    extractQuotaResetNotice(error);
  const publicError = new Error(message, { cause: error });
  publicError.name = 'InferenceProviderQuotaError';
  publicError.code = 'INFERENCE_PROVIDER_QUOTA_EXHAUSTED';
  publicError.status = 429;
  publicError.publicMessage = message;
  publicError.retryable = false;
  return publicError;
}

export const __testOnly__ = Object.freeze({
  extractQuotaResetNotice,
  getErrorCode,
  getErrorMessage,
  getModelLabel,
  isQuotaExhaustionError,
});
