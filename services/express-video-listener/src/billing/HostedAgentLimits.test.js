import test from 'node:test';
import assert from 'node:assert/strict';
import { assertHostedAgentLimit } from './HostedAgentLimits.js';
function fixture(period = 'total') {
  const pipelines = [];
  const session = { userId: '507f1f77bcf86cd799439011', apiKeyId: '507f1f77bcf86cd799439012' };
  const User = { findById: () => ({ select() { return this; }, lean: async () => ({ userApiKeys: [
    { _id: session.apiKeyId, usageLimit: 2160, usageLimitPeriod: period },
  ] }) }) };
  const Ledger = { aggregate: async pipeline => { pipelines.push(pipeline); return [{ total: 1080 }]; } };
  return { session, User, Ledger, pipelines };
}
test('resumed funding checks net agent usage and credits only agent refunds', async () => {
  const h = fixture(); await assertHostedAgentLimit({ ...h, amount: 1080 });
  assert.deepEqual(h.pipelines[0][0].$match.$or, [{ direction: 'debit' }, { direction: 'credit', source: 'hosted_agent_refund' }]);
  assert.deepEqual(h.pipelines[0][1].$group.total.$sum.$cond, [{ $eq: ['$direction', 'debit'] }, '$amount', { $multiply: ['$amount', -1] }]);
  await assert.rejects(assertHostedAgentLimit({ ...h, amount: 1081 }), { code: 'API_KEY_USAGE_LIMIT_EXCEEDED' });
});
test('monthly API limits retain the calendar period', async () => {
  const h = fixture('monthly'); const now = new Date(2026, 10, 8);
  await assertHostedAgentLimit({ ...h, amount: 1, now });
  assert.equal(+h.pipelines[0][0].$match.createdAt.$gte, +new Date(2026, 10, 1));
});
test('browser requests without API keys do not query key usage', async () => {
  const h = fixture(); delete h.session.apiKeyId;
  await assertHostedAgentLimit({ ...h, amount: 2160 }); assert.equal(h.pipelines.length, 0);
});
