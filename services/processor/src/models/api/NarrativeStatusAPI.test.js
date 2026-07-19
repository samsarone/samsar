import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';

import NarrativeRequest from '../../schema/NarrativeRequest.js';
import { __testOnly__, getNarrativeRequest } from './NarrativeStatusAPI.js';

function setConnectionReadyForTest(t) {
  const originalReadyState = mongoose.connection.readyState;
  mongoose.connection.readyState = 1;
  t.after(() => {
    mongoose.connection.readyState = originalReadyState;
  });
}

test('generic polling is scoped to the user and both supported request types', async (t) => {
  setConnectionReadyForTest(t);
  const requestId = '507f1f77bcf86cd799439011';
  const userId = '507f191e810c19729de860ea';
  let lookup = null;
  t.mock.method(NarrativeRequest, 'findOne', (filter) => {
    lookup = filter;
    return {
      lean: async () => ({
        _id: requestId,
        userId,
        requestType: 'create_branching',
        narrativeType: 'branched',
        status: 'COMPLETED',
        prompt: 'Make a film',
        duration: 30,
        inferenceModel: 'gpt-5.6-sol',
        themeJson: {},
        narrativeJson: {},
        movieResourceList: { structureType: 'branched', nodes: [] },
        branchingMeta: { rootNodeId: 'root' },
      }),
    };
  });

  const result = await getNarrativeRequest({ userId, requestId });

  assert.equal(result.request_type, 'create_branching');
  assert.equal(result.narrative_type, 'branched');
  assert.deepEqual(lookup, {
    _id: requestId,
    userId,
    requestType: { $in: ['create_single', 'create_branching'] },
  });
});

test('generic polling rejects malformed ids before database access', async (t) => {
  const lookup = t.mock.method(NarrativeRequest, 'findOne', () => {
    throw new Error('invalid ids must not reach MongoDB');
  });

  await assert.rejects(
    getNarrativeRequest({ userId: 'user-1', requestId: 'not-an-object-id' }),
    (error) => error.code === 'INVALID_REQUEST_ID' && error.status === 400,
  );
  assert.equal(lookup.mock.callCount(), 0);
});

test('only pending or stale processing requests are eligible for polling recovery', () => {
  assert.equal(__testOnly__.shouldRequeue({ status: 'PENDING' }), true);
  assert.equal(__testOnly__.shouldRequeue({
    status: 'PROCESSING',
    workerLeaseExpiresAt: new Date(Date.now() - 1_000),
  }), true);
  assert.equal(__testOnly__.shouldRequeue({
    status: 'PROCESSING',
    workerLeaseExpiresAt: new Date(Date.now() + 60_000),
  }), false);
  assert.equal(__testOnly__.shouldRequeue({ status: 'COMPLETED' }), false);
});
