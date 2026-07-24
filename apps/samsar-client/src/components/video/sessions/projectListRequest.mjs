export const PROJECT_LIST_RETRY_DELAYS_MS = [400, 1_200];

export function shouldRetryProjectListRequest(error) {
  const status = Number(error?.response?.status);
  if (!Number.isFinite(status)) {
    return true;
  }

  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function getProjectListErrorMessage(error) {
  const status = Number(error?.response?.status);
  if (status === 401 || status === 403) {
    return 'Your session expired. Sign in again, then retry.';
  }

  const responseMessage = error?.response?.data?.error;
  if (typeof responseMessage === 'string' && responseMessage.trim()) {
    return responseMessage.trim();
  }

  return 'We could not load your projects. Check your connection and try again.';
}
