import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import { getUserUsageLogs } from './Usage.js';
import ProviderUsageLog from '../schema/ProviderUsageLog.js';
import GenerationCreditTransaction from '../schema/GenerationCreditTransaction.js';

const userId = '507f191e810c19729de860ea';

function setup(t, providerMode = true) {
  const readyState = mongoose.connection.readyState;
  const auditMode = process.env.SAMSAR_PROVIDER_USAGE_AUDIT_ENABLED;
  mongoose.connection.readyState = 1;
  process.env.SAMSAR_PROVIDER_USAGE_AUDIT_ENABLED = String(providerMode);
  t.after(() => {
    mongoose.connection.readyState = readyState;
    if (auditMode === undefined) delete process.env.SAMSAR_PROVIDER_USAGE_AUDIT_ENABLED;
    else process.env.SAMSAR_PROVIDER_USAGE_AUDIT_ENABLED = auditMode;
  });
}

function mockProviderQuery(t, { total = 53, items = [] } = {}) {
  const query = {};
  const cursor = {
    sort(value) { query.sort = value; return this; },
    skip(value) { query.skip = value; return this; },
    limit(value) { query.limit = value; return this; },
    lean: async () => items,
  };
  t.mock.method(ProviderUsageLog, 'find', filter => { query.filter = filter; return cursor; });
  t.mock.method(ProviderUsageLog, 'countDocuments', async filter => { query.countFilter = filter; return total; });
  return query;
}

test('provider usage paginates in the database with stable ordering and user isolation', async t => {
  setup(t);
  const query = mockProviderQuery(t, { items: [{ _id: 'row', requestType: 'text_to_image', provider: 'fal' }] });
  const result = await getUserUsageLogs(userId, { page: '3', pageSize: '25' });
  assert.deepEqual(query.filter, { userId });
  assert.deepEqual(query.countFilter, query.filter);
  assert.deepEqual(query.sort, { createdAt: -1, _id: -1 });
  assert.equal(query.skip, 50);
  assert.equal(query.limit, 25);
  assert.equal(result.items[0].provider, 'fal');
  assert.deepEqual(result.pagination, {
    page: 3, pageSize: 25, totalItems: 53, totalPages: 3, hasNextPage: false, hasPreviousPage: true,
  });
});

test('invalid paging cannot create unbounded or unsafe database queries', async t => {
  setup(t);
  const query = mockProviderQuery(t);
  for (const options of [
    { page: '-1', pageSize: '0' },
    { page: 'junk', pageSize: 'junk' },
    { page: '2oops', pageSize: '10oops' },
    { page: '9'.repeat(400), pageSize: '9'.repeat(400) },
    { page: Number.MAX_SAFE_INTEGER, pageSize: 25 },
    { page: ['2'], pageSize: ['10'] },
  ]) {
    const result = await getUserUsageLogs(userId, options);
    assert.equal(result.pagination.page, 1);
    assert.ok(Number.isSafeInteger(query.skip));
    assert.ok(query.limit >= 1 && query.limit <= 100);
  }
  await getUserUsageLogs(userId, { page: 2, pageSize: 1000 });
  assert.equal(query.limit, 100);
  assert.equal(query.skip, 100);
});

test('empty provider history returns no next or previous page', async t => {
  setup(t);
  mockProviderQuery(t, { total: 0 });
  const { pagination, items } = await getUserUsageLogs(userId);
  assert.deepEqual(items, []);
  assert.equal(pagination.totalItems, 0);
  assert.equal(pagination.hasNextPage, false);
  assert.equal(pagination.hasPreviousPage, false);
});

test('hosted pagination counts grouped tasks without building transaction payloads twice', async t => {
  setup(t, false);
  const pipelines = [];
  t.mock.method(GenerationCreditTransaction, 'aggregate', async pipeline => {
    pipelines.push(pipeline);
    if (pipeline.at(-1).$count) return [{ totalItems: 26 }];
    return [{
      _id: 'express:session', isExpressStageGroup: 1, totalCredits: 30,
      latestCreatedAt: '2026-11-07T02:00:00Z',
      transactions: [
        { _id: 'speech', source: 'express_video_stage_speech_generation', amount: 20, balanceAfter: 70, createdAt: '2026-11-07T02:00:00Z', metadata: { sessionId: 'session', stageKey: 'speech_generation' } },
        { _id: 'image', source: 'express_video_stage_image_generation', amount: 10, balanceAfter: 90, createdAt: '2026-11-07T01:00:00Z', metadata: { sessionId: 'session', stageKey: 'image_generation' } },
      ],
    }];
  });
  const result = await getUserUsageLogs(userId, { page: 2, pageSize: 25 });
  const itemsPipeline = pipelines.find(pipeline => pipeline.at(-1).$limit);
  const countPipeline = pipelines.find(pipeline => pipeline.at(-1).$count);
  assert.equal(itemsPipeline[0].$match.userId.toString(), userId);
  assert.deepEqual(itemsPipeline.slice(-3), [{ $sort: { latestCreatedAt: -1, _id: -1 } }, { $skip: 25 }, { $limit: 25 }]);
  assert.deepEqual(countPipeline.find(stage => stage.$group), { $group: { _id: '$usageGroupKey' } });
  assert.equal(countPipeline.some(stage => stage.$sort), false);
  assert.deepEqual(countPipeline[0], itemsPipeline[0]);
  assert.equal(result.pagination.totalPages, 2);
  assert.equal(result.items[0].credits, 30);
  assert.equal(result.items[0].balanceAfter, 70);
  assert.deepEqual(result.items[0].subRows.map(row => row.id), ['image', 'speech']);
});

test('usage requires an authenticated user id', async () => {
  await assert.rejects(getUserUsageLogs(null), /userId is required/);
});
