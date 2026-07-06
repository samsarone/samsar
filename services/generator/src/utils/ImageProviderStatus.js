export function normalizeProviderStatus(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function isTerminalProviderFailureStatus(value) {
  const status = normalizeProviderStatus(value);
  return (
    status === 'FAILED' ||
    status === 'ERROR' ||
    status === 'CANCELLED' ||
    status === 'CANCELED' ||
    status.includes('FAIL') ||
    status.includes('ERROR')
  );
}

export async function markImageProviderRequestFailed(ImageGeneration, requestId, message) {
  await ImageGeneration.findOneAndUpdate(
    { _id: requestId },
    {
      apiGenerationStatus: 'FAILED',
      generationError: message,
      rowLocked: false,
    }
  );
  return { image: null, error: message };
}
