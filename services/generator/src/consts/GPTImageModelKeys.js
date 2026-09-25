// Compatibility for jobs already queued before the API model-key change.
export function normalizeStoredGPTImageModelKey(value) {
  const key = typeof value === 'string' ? value.trim().toUpperCase() : value;
  if (key === 'GPTIMAGE2') return 'GPTIMAGE2.5';
  if (key === 'GPTIMAGE2EDIT') return 'GPTIMAGE2.5EDIT';
  return value;
}
