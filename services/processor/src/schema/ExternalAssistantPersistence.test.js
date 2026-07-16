import assert from 'node:assert/strict';
import test from 'node:test';

import ExternalAssistantClientRequest from './ExternalAssistantClientRequest.js';
import ExternalAssistantRequest from './ExternalAssistantRequest.js';
import ExpressGenerationBuilderRequest from './ExpressGenerationBuilderRequest.js';
import { normalizeExternalAssistantRequestContext } from '../models/ai_utils/ExternalAssistantClientRequestStore.js';

test('Docker assistant request context derives a stable client request id from the video session', () => {
  assert.deepEqual(
    normalizeExternalAssistantRequestContext({
      sessionId: 'video-session-1',
      userId: 'user-1',
      requestKey: 'text_to_video:theme:attempt-1',
    }),
    {
      clientRequestId: 'samsar:video-session-1:text_to_video:theme:attempt-1',
      sessionId: 'video-session-1',
      userId: 'user-1',
      requestKey: 'text_to_video:theme:attempt-1',
      provider: 'samsar',
    },
  );
});

test('hosted and Docker schemas persist both sides of assistant request correlation', () => {
  assert.ok(ExternalAssistantRequest.schema.path('clientRequestId'));
  assert.ok(ExternalAssistantRequest.schema.path('clientSessionId'));
  assert.ok(ExternalAssistantRequest.schema.path('workerLeaseExpiresAt'));
  assert.ok(ExternalAssistantClientRequest.schema.path('sessionId'));
  assert.ok(ExternalAssistantClientRequest.schema.path('providerRequestId'));
  assert.ok(ExternalAssistantClientRequest.schema.path('response'));
  assert.ok(ExpressGenerationBuilderRequest.schema.path('payload'));
  assert.ok(ExpressGenerationBuilderRequest.schema.path('leaseExpiresAt'));
});
