export const VIDGENIE_POLL_ACTION = Object.freeze({
  KEEP: 'keep',
  NONE: 'none',
  START: 'start',
  STOP: 'stop',
});

function normalizeRequestId(value) {
  return typeof value === 'string' ? value.trim() : value?.toString?.().trim?.() || '';
}

export function resolveVidgeniePollAction({
  requestId,
  currentPollRequestId,
  isPending,
} = {}) {
  const normalizedRequestId = normalizeRequestId(requestId);
  if (!normalizedRequestId) {
    return VIDGENIE_POLL_ACTION.NONE;
  }

  const isCurrentRequestPolling =
    normalizeRequestId(currentPollRequestId) === normalizedRequestId;

  if (isPending) {
    return isCurrentRequestPolling
      ? VIDGENIE_POLL_ACTION.KEEP
      : VIDGENIE_POLL_ACTION.START;
  }

  return isCurrentRequestPolling
    ? VIDGENIE_POLL_ACTION.STOP
    : VIDGENIE_POLL_ACTION.NONE;
}
