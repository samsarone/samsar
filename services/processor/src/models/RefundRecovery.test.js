import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverPendingRefunds } from './RefundRecovery.js';

test('recovery replays only saved refund targets, continues past failures, and rotates retries', async () => {
  const calls = []; const attempts = [];
  const results = await recoverPendingRefunds({ connect: async () => {}, logger: { error() {} },
    requests: [
      { _id: 'broken', externalRequestId: 'a', refundSettlement: { pendingOperation: { target: 20, fields: { status: 'FAILED' } } } },
      { _id: 'working', externalRequestId: 'b', refundSettlement: { pendingOperation: { target: 5, fields: { status: 'CANCELLED' } } } },
    ], sessions: [{ _id: 'legacy' }],
    refundExternal: async args => { calls.push(args); if (args.externalRequestId === 'a') throw Error('DB unavailable'); },
    refundLegacy: async id => calls.push({ sessionId: id }),
    markAttempt: async (...args) => attempts.push(args),
  });
  assert.deepEqual(results.map(item => item.ok), [false, true, true]);
  assert.equal(calls[0].creditsToRefund, 20); assert.equal(calls[1].creditsToRefund, 5);
  assert.equal(calls[1].status, 'CANCELLED'); assert.equal(calls[2].sessionId, 'legacy');
  assert.equal(attempts[0][0], 'broken');
  assert.ok(attempts[0][1].$set['refundSettlement.recoveryAttemptedAt']);
});
