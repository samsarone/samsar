import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isRetryableSyncLipSyncPollError,
  listenToPendingSyncLipSyncRequests,
} from './SyncLipSyncListener.js';

const request = {
  generationId: 'accepted-fal-request',
  model: 'SYNCLIPSYNC',
  requestSubmitAt: new Date(Date.now() - 20 * 60_000),
};
const connect = async () => {};

test('Sync lip sync keeps an accepted FAL job pending after a status timeout', async (t) => {
  t.mock.method(console, 'error', () => {});
  let resultCalls = 0;
  const queue = {
    status: async () => { throw Object.assign(new Error('Gateway Timeout'), { status: 504 }); },
    result: async () => { resultCalls += 1; },
  };
  assert.deepEqual(await listenToPendingSyncLipSyncRequests(request, { connect, queue }), {
    responseStatus: 'PENDING',
  });
  assert.equal(resultCalls, 0);
});

test('Sync lip sync retries a completed FAL job when result fetch times out', async (t) => {
  t.mock.method(console, 'error', () => {});
  let resultCalls = 0;
  const queue = {
    status: async () => ({ status: 'COMPLETED' }),
    result: async () => {
      resultCalls += 1;
      if (resultCalls === 1) throw Object.assign(new Error('Gateway Timeout'), { status: 504 });
      return { data: { video: { url: 'https://media.example.com/result.mp4' } } };
    },
  };
  assert.deepEqual(await listenToPendingSyncLipSyncRequests(request, { connect, queue }), {
    responseStatus: 'PENDING',
  });
  assert.deepEqual(await listenToPendingSyncLipSyncRequests(request, { connect, queue }), {
    responseStatus: 'COMPLETED', remoteUrl: 'https://media.example.com/result.mp4',
  });
  assert.equal(resultCalls, 2);
});

test('Sync lip sync fails a completed request with a structured terminal 504 result', async (t) => {
  t.mock.method(console, 'error', () => {});
  const body = {
    detail: [{
      loc: ['body'],
      msg: 'Downstream service unavailable',
      type: 'downstream_service_unavailable',
      input: null,
    }],
  };
  const result = await listenToPendingSyncLipSyncRequests(request, {
    connect,
    queue: {
      status: async () => ({ status: 'COMPLETED' }),
      result: async () => {
        throw Object.assign(new Error('Internal Server Error'), { status: 504, body });
      },
    },
  });

  assert.equal(result.responseStatus, 'FAILED');
  assert.equal(result.providerFailureMessage, 'Downstream service unavailable');
  assert.deepEqual(result.providerStatus, { status: 504, ...body });
});

test('a structured gateway error during status polling preserves the accepted request', async (t) => {
  t.mock.method(console, 'error', () => {});
  const result = await listenToPendingSyncLipSyncRequests(request, {
    connect,
    queue: {
      status: async () => {
        throw Object.assign(new Error('Gateway Timeout'), {
          status: 504,
          body: { detail: [{ type: 'gateway_timeout', msg: 'Please retry' }] },
        });
      },
      result: async () => { assert.fail('status polling has not completed'); },
    },
  });
  assert.deepEqual(result, { responseStatus: 'PENDING' });
});

test('Sync lip sync retains definitive provider failures', async (t) => {
  t.mock.method(console, 'error', () => {});
  const providerFailed = await listenToPendingSyncLipSyncRequests(request, {
    connect, queue: { status: async () => ({ status: 'FAILED' }) },
  });
  assert.equal(providerFailed.responseStatus, 'FAILED');
  const rejected = await listenToPendingSyncLipSyncRequests(request, {
    connect, queue: { status: async () => { throw Object.assign(new Error('Invalid request'), { status: 422 }); } },
  });
  assert.equal(rejected.responseStatus, 'FAILED');
  assert.equal(isRetryableSyncLipSyncPollError({ status: 504 }), true);
  assert.equal(isRetryableSyncLipSyncPollError({ status: 422 }), false);
});
