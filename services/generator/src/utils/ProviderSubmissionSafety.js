function getProviderStatus(error) {
  const visited = new Set();
  let current = error;
  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    const status = Number(current.status ?? current.statusCode ?? current.response?.status);
    if (Number.isInteger(status) && status > 0) return status;
    current = current.cause;
  }
  const messageStatus = Number(String(error?.message || '').match(/(?:^|\s)(\d{3})(?:\s|$)/)?.[1]);
  if (Number.isInteger(messageStatus) && messageStatus > 0) return messageStatus;
  return null;
}

export function isSubmissionOutcomeUnknown(error) {
  const status = getProviderStatus(error);
  if (status !== null) {
    return status === 408 || status === 409 || status >= 500;
  }
  return true;
}
