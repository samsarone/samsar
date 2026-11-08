// Public 2.6 aliases share the established storage, pricing and adapter keys.
export function normalizeGPTImageRequestModelKey(value) {
  const key = typeof value === 'string' ? value.trim().toUpperCase() : value;
  if (key === 'GPTIMAGE2.6') return 'GPTIMAGE2.5';
  if (key === 'GPTIMAGE2.6EDIT') return 'GPTIMAGE2.5EDIT';
  return value;
}

// Only use this when reading saved state, never to accept a retired API model.
export function normalizeStoredGPTImageModelKey(value) {
  const key = typeof value === 'string' ? value.trim().toUpperCase() : value;
  if (key === 'GPTIMAGE2') return 'GPTIMAGE2.5';
  if (key === 'GPTIMAGE2EDIT') return 'GPTIMAGE2.5EDIT';
  return normalizeGPTImageRequestModelKey(value);
}

export function getRetiredGPTImageModelError(value) {
  const key = typeof value === 'string' ? value.trim().toUpperCase() : value;
  const replacement = normalizeStoredGPTImageModelKey(value);
  return ['GPTIMAGE2', 'GPTIMAGE2EDIT'].includes(key)
    ? `Invalid model: ${String(value).trim()}. Use ${replacement}.`
    : null;
}
