import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VIDGENIE_POLL_ACTION,
  resolveVidgeniePollAction,
} from './vidgenieGenerationPolling.mjs';

test('keeps a detailed-status poll started while pending session details load', () => {
  assert.equal(resolveVidgeniePollAction({
    requestId: 'session-1',
    currentPollRequestId: 'session-1',
    isPending: true,
  }), VIDGENIE_POLL_ACTION.KEEP);
});

test('starts a missing pending-session poll and stops only the matching completed poll', () => {
  assert.equal(resolveVidgeniePollAction({
    requestId: 'session-1',
    currentPollRequestId: null,
    isPending: true,
  }), VIDGENIE_POLL_ACTION.START);

  assert.equal(resolveVidgeniePollAction({
    requestId: 'session-1',
    currentPollRequestId: 'session-1',
    isPending: false,
  }), VIDGENIE_POLL_ACTION.STOP);

  assert.equal(resolveVidgeniePollAction({
    requestId: 'session-1',
    currentPollRequestId: 'session-2',
    isPending: false,
  }), VIDGENIE_POLL_ACTION.NONE);
});
