import assert from 'node:assert/strict';
import test from 'node:test';

import InteractiveVideoRequest from './InteractiveVideoRequest.js';

test('interactive video requests persist durable stages, leases, and final session identity', () => {
  const paths = InteractiveVideoRequest.schema.paths;

  assert.equal(paths.sessionId.options.required, true);
  assert.equal(paths.payloadHash.options.required, true);
  assert.deepEqual(paths.status.enumValues, [
    'PENDING',
    'PROCESSING',
    'WAITING',
    'COMPLETED',
    'FAILED',
  ]);
  assert.deepEqual(paths.stage.enumValues, [
    'SINGULAR_NARRATIVE',
    'BRANCHED_NARRATIVE',
    'VIDEO_SESSION',
    'COMPLETED',
    'FAILED',
  ]);
  assert.ok(paths.workerLeaseId);
  assert.ok(paths.workerLeaseExpiresAt);
  assert.ok(paths.nextAttemptAt);
  assert.ok(paths.singularNarrativeRequestId);
  assert.ok(paths.branchedNarrativeRequestId);

  const indexes = InteractiveVideoRequest.schema.indexes();
  assert.ok(indexes.some(([keys, options]) => (
    keys.userId === 1 &&
    keys.idempotencyKey === 1 &&
    options.unique === true &&
    options.partialFilterExpression?.idempotencyKey?.$type === 'string'
  )));
});
