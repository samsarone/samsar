export const SEEDREAM_FAL_ENDPOINT = 'bytedance/seedream/v5.5/text-to-image';
export const LEGACY_SEEDREAM_FAL_ENDPOINT = 'bytedance/seedream/v5/pro/text-to-image';
const SUPPORTED_ENDPOINTS = new Set([SEEDREAM_FAL_ENDPOINT, LEGACY_SEEDREAM_FAL_ENDPOINT]);

// Accepted requests keep their endpoint across a model upgrade. Historical
// queued jobs predate the endpoint field and must continue polling Seedream 5.
export function getSeedreamFalEndpoint(payload = {}) {
  const stored = payload.seedreamFalEndpoint;
  const sealed = payload.falImageBillingSnapshot?.model === 'SEEDREAM'
    ? payload.falImageBillingSnapshot.endpoint : null;
  if (stored && sealed && stored !== sealed) {
    throw new Error('The Seedream endpoint conflicts with its sealed billing snapshot.');
  }
  const endpoint = stored || sealed;
  if (endpoint) {
    if (!SUPPORTED_ENDPOINTS.has(endpoint)) throw new Error('The saved Seedream endpoint is unsupported.');
    return endpoint;
  }
  return payload.apiRequestId || String(payload.apiGenerationStatus).toUpperCase() === 'PENDING'
    ? LEGACY_SEEDREAM_FAL_ENDPOINT : SEEDREAM_FAL_ENDPOINT;
}
