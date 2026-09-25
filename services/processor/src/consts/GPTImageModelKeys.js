// Only use this when reading saved state, never to accept a retired API model.
export function normalizeStoredGPTImageModelKey(value) {
  const key = typeof value === 'string' ? value.trim().toUpperCase() : value;
  if (key === 'GPTIMAGE2') return 'GPTIMAGE2.5';
  if (key === 'GPTIMAGE2EDIT') return 'GPTIMAGE2.5EDIT';
  return value;
}

export function getRetiredGPTImageModelError(value) {
  const replacement = normalizeStoredGPTImageModelKey(value);
  return replacement !== value
    ? `Invalid model: ${String(value).trim()}. Use ${replacement}.`
    : null;
}
