// Keep provider failure routing and retry-prompt strategy in agreement. HTTP
// 422 alone is not a safety signal: match the provider's content-check detail.
export function isSafetyRejectionMessage(message = '') {
  return /safety system|safety_violations|content policy|policy violation|request was rejected|inappropriate content|(?:flagged|blocked|rejected)\s+by\s+(?:(?:a|an|the|our|its)\s+)?content\s+(?:checker|filter|moderator)/i.test(
    String(message || ''),
  );
}
