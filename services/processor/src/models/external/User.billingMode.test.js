import { applyUpdate, matches, query, clone } from '../../test_helpers/BillingMemoryModel.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';

const TEST_SECRET = 'billing-mode-regression-test-secret-at-least-32-bytes';
process.env.SAMSAR_PROCESSOR_ENV_FILE = '/dev/null';
process.env.DOTENV_CONFIG_PATH = '/dev/null';
process.env.TOKEN_SECRET = TEST_SECRET;
process.env.APP_KEY_HASH_SECRET = TEST_SECRET;
process.env.STRIPE_SECRET_KEY = 'sk_test_billing_mode_regression';
process.env.OPENAI_API_KEY = 'sk-test-billing-mode-regression';
process.env.MONGO_URL = 'mongodb://127.0.0.1:1/billing-mode-regression';

const [
  { upsertExternalUser, reserveExternalRequestCredits, refundExternalRequestCredits, applyExternalRequestRefundBySessionId, markExternalRequestAccepted },
  { default: User },
  { default: ExternalUser },
  { default: ExternalUserRequest },
  { default: CustomerSubAccount },
  { default: GenerationCreditTransaction },
  { default: ExternalUserGenerationCreditTransaction },
] = await Promise.all([
  import('./User.js'),
  import('../../schema/User.js'),
  import('../../schema/ExternalUser.js'),
  import('../../schema/ExternalUserRequest.js'),
  import('../../schema/CustomerSubAccount.js'),
  import('../../schema/GenerationCreditTransaction.js'),
  import('../../schema/ExternalUserGenerationCreditTransaction.js'),
]);

const ids = {
  parent: '507f191e810c19729de860ea',
  external: '507f191e810c19729de860eb',
  request: '507f191e810c19729de860ec',
  subAccount: '507f191e810c19729de860ed',
};

function mockBillingState(t, externalFields = {}, { insert = false } = {}) {
  const previousReadyState = mongoose.connection.readyState;
  mongoose.connection.readyState = 1;
  t.after(() => { mongoose.connection.readyState = previousReadyState; });
  const state = {
    parent: { _id: ids.parent, generationCredits: 100, autoRechargeEnabled: false },
    external: insert ? null : {
      _id: ids.external,
      internalUserId: ids.parent,
      provider: 'partner',
      externalUserId: 'customer',
      externalIdentityKey: 'partner:default:customer',
      generationCredits: 100,
      userType: null,
      metadata: {},
      ...externalFields,
    },
    subAccount: { _id: ids.subAccount, internalUserId: ids.parent, generationCredits: 50 },
    request: {
      _id: ids.request,
      internalUserId: ids.parent, upstreamSessionId: '507f191e810c19729de860ef',
      externalRequestId: 'extreq_billing_mode',
      externalUserId: ids.external,
      creditsCharged: 0,
      routeKey: 'add_outro_image',
    },
    parentTransactions: [],
  };
  state.faults = {};
  state.externalTransactions = [];
  const ledgers = [[GenerationCreditTransaction, state.parentTransactions], [ExternalUserGenerationCreditTransaction, state.externalTransactions]];
  for (const [Model, entries] of ledgers) {
    t.mock.method(Model.prototype, 'save', async function save() {
      entries.push(clone(this.toObject())); return this;
    });
    t.mock.method(Model, 'findById', id => query(entries.find(item => String(item._id) === String(id))));
    t.mock.method(Model, 'findOne', filter => query(entries.find(item => matches(item, filter))));
    t.mock.method(Model, 'updateOne', async (filter, update) => {
      if (state.faults.ledger) { state.faults.ledger--; throw Error('ledger outage'); }
      if (!entries.some(item => String(item._id) === String(filter._id))) entries.push({ _id: filter._id, ...clone(update.$setOnInsert) });
      return { matchedCount: 1 };
    });
    t.mock.method(Model, 'aggregate', async () => ['debit', 'credit'].map(direction => ({
      _id: direction, amount: entries.filter(item => item.direction === direction).reduce((sum, item) => sum + item.amount, 0),
    })).filter(item => item.amount > 0));
  }
  for (const [Model, key] of [[User, 'parent'], [ExternalUser, 'external'], [CustomerSubAccount, 'subAccount'], [ExternalUserRequest, 'request']]) {
    t.mock.method(Model, 'findById', () => query(state[key]));
    t.mock.method(Model, 'findOne', filter => query(matches(state[key], filter) ? state[key] : null));
    function write(filter, update, options = {}) {
      const inserting = !state[key];
      if (inserting && options.upsert) state[key] = { _id: ids.external, generationCredits: 0 };
      else if (!matches(state[key], filter)) return null;
      if (key === 'request' && state.faults.receipt && update.$set?.['refundSettlement.pendingOperation'] === null) {
        state.faults.receipt--; throw Error('receipt outage');
      }
      if (state.faults[key]) { state.faults[key]--; throw Error(`${key} outage`); }
      const result = applyUpdate(state[key], update, { inserting });
      if (state.faults[`${key}Response`] && update.$inc?.generationCredits > 0) {
        state.faults[`${key}Response`]--; throw Error('wallet response lost');
      }
      return result;
    }
    t.mock.method(Model, 'findOneAndUpdate', (filter, update, options) => query(write(filter, update, options)));
    t.mock.method(Model, 'findByIdAndUpdate', (id, update, options) => query(write({ _id: id }, update, options)));
    t.mock.method(Model, 'updateOne', async (filter, update, options) => ({ matchedCount: write(filter, update, options) ? 1 : 0 }));
  }
  return state;
}

const reserve = () => reserveExternalRequestCredits({
  externalRequestId: 'extreq_billing_mode', creditsToReserve: 20,
});
const refund = () => refundExternalRequestCredits({
  externalRequestId: 'extreq_billing_mode', creditsToRefund: 20,
});
const updateProfile = (state, fields) => upsertExternalUser({
  internalUserId: ids.parent,
  externalUserPayload: {
    provider: state.external?.provider || 'partner',
    external_user_id: 'customer',
    ...fields,
  },
});

for (const billingMode of ['internal', 'customer_sub_account']) {
  test(`profile billingMode ${billingMode} cannot redirect an external refund to the parent`, async (t) => {
    const state = mockBillingState(t);
    await reserve();
    assert.equal(state.external.generationCredits, 80);
    assert.equal(state.parent.generationCredits, 100);
    await updateProfile(state, { metadata: { billingMode } });
    await refund();
    assert.equal(state.external.generationCredits, 100);
    assert.equal(state.parent.generationCredits, 100);
    assert.deepEqual(state.parentTransactions.map(({ direction, amount }) => ({ direction, amount })), []);
  });
}

test('user_type cannot convert an existing external debit into a parent refund', async (t) => {
  const state = mockBillingState(t);
  await reserve();
  await updateProfile(state, { user_type: 'internal_user' });
  await refund();
  assert.equal(state.external.userType, null);
  assert.equal(state.external.generationCredits, 100);
  assert.equal(state.parent.generationCredits, 100);
  assert.deepEqual(state.parentTransactions.map(({ direction, amount }) => ({ direction, amount })), []);
});

test('initial internal user type keeps parent debit and refund routing when a profile tries to clear it', async (t) => {
  const state = mockBillingState(t, {}, { insert: true });
  await updateProfile(state, { user_type: 'internal_user' });
  await reserve();
  assert.equal(state.parent.generationCredits, 80);
  await updateProfile(state, { user_type: 'external_user', metadata: {} });
  await refund();
  assert.equal(state.external.userType, 'internal_user');
  assert.equal(state.parent.generationCredits, 100);
  assert.deepEqual(state.parentTransactions.map(({ direction, amount }) => ({ direction, amount })), [
    { direction: 'debit', amount: 20 }, { direction: 'credit', amount: 20 },
  ]);
});

test('mapped Samsar identities retain parent billing independently of profile metadata', async (t) => {
  const state = mockBillingState(t, {
    provider: 'samsar_internal',
    externalIdentityKey: 'samsar_internal:default:customer',
  });
  await reserve();
  assert.equal(state.parent.generationCredits, 80);
  await updateProfile(state, { metadata: { billingMode: 'external' } });
  await refund();
  assert.equal(state.parent.generationCredits, 100);
  assert.deepEqual(state.parentTransactions.map(({ direction, amount }) => ({ direction, amount })), [
    { direction: 'debit', amount: 20 }, { direction: 'credit', amount: 20 },
  ]);
});

test('customer sub-account identities keep both parent and allocation billing after profile changes', async (t) => {
  const state = mockBillingState(t, {
    customerSubAccountId: ids.subAccount,
    customerSubAccountPublicId: 'customer_sub_account_test',
    generationCredits: 50,
  });
  await reserve();
  assert.equal(state.parent.generationCredits, 80);
  assert.equal(state.subAccount.generationCredits, 30);
  await updateProfile(state, { user_type: 'external_user', metadata: { billingMode: 'external' } });
  await refund();
  assert.equal(state.parent.generationCredits, 100);
  assert.equal(state.subAccount.generationCredits, 50);
  assert.deepEqual(state.parentTransactions.map(({ direction, amount }) => ({ direction, amount })), [
    { direction: 'debit', amount: 20 }, { direction: 'credit', amount: 20 },
  ]);
});

test('metadata-only legacy records cannot spend parent credits without a structural billing identity', async (t) => {
  const state = mockBillingState(t, { generationCredits: 0, metadata: { billingMode: 'internal' } });
  await assert.rejects(reserve(), (error) => error.code === 'INSUFFICIENT_CREDITS');
  assert.equal(state.parent.generationCredits, 100);
  assert.deepEqual(state.parentTransactions.map(({ direction, amount }) => ({ direction, amount })), []);
});

const viaSession = (creditsRefunded = 20) => applyExternalRequestRefundBySessionId({
  internalUserId: ids.parent, sessionId: '507f191e810c19729de860ef', creditsRefunded,
});
const accounts = {
  external: {},
  internal: { provider: 'samsar_internal' },
  allocation: { customerSubAccountId: ids.subAccount, generationCredits: 50 },
};
function assertRefundBalance(state, type, refundAmount = 20) {
  const remainingCharge = 20 - refundAmount;
  assert.equal(state.parent.generationCredits, 100 - (type === 'external' ? 0 : remainingCharge));
  assert.equal(state.subAccount.generationCredits, 50 - (type === 'allocation' ? remainingCharge : 0));
  assert.equal(state.external.generationCredits, (type === 'allocation' ? 50 : 100) - remainingCharge);
  assert.equal(state.request.creditsRefunded, refundAmount);
  assert.equal(state.request.creditsCharged, remainingCharge);
  assert.equal(state.external.totalCreditsRefunded, refundAmount);
  const sum = state.externalTransactions.filter(item => item.direction === 'credit').reduce((a, b) => a + b.amount, 0);
  assert.equal(sum, refundAmount);
}
for (const [type, fields] of Object.entries(accounts)) {
  test(`${type}: concurrent admission/session callbacks refund one charge only once`, async t => {
    const state = mockBillingState(t, fields); await reserve();
    await Promise.all(Array.from({ length: 8 }, (_, index) => index % 2 ? refund() : viaSession()));
    assertRefundBalance(state, type);
    await refund(); await viaSession(2000); assertRefundBalance(state, type);
  });
  test(`${type}: partial refund targets are cumulative and capped by this request's debit`, async t => {
    const state = mockBillingState(t, fields); await reserve();
    await Promise.all([viaSession(5), viaSession(10)]);
    assertRefundBalance(state, type, 10);
    await viaSession(5); await viaSession(10); assertRefundBalance(state, type, 10);
    await refund(); assertRefundBalance(state, type);
    const accepted = await markExternalRequestAccepted({ externalRequestId: state.request.externalRequestId,
      upstreamSessionId: state.request.upstreamSessionId, creditsCharged: 20 });
    assert.equal(accepted.creditsCharged, 0); assertRefundBalance(state, type);
  });
  for (const fault of ['ledger', 'receipt', type === 'external' ? 'externalResponse' : 'parentResponse',
    ...(type === 'allocation' ? ['subAccount', 'subAccountResponse', 'external'] : [])]) {
    test(`${type}: ${fault} failure recovers without another wallet or allocation credit`, async t => {
      const state = mockBillingState(t, fields); await reserve(); state.faults[fault] = 1;
      await assert.rejects(refund());
      await Promise.all([refund(), viaSession()]); assertRefundBalance(state, type);
    });
  }
}

test('an unfunded request cannot refund its quoted price', async t => {
  const state = mockBillingState(t);
  await viaSession(3600);
  assert.equal(state.external.generationCredits, 100);
  assert.equal(state.parent.generationCredits, 100);
  assert.equal(state.externalTransactions.length, 0);
});

test('a lower final accepted price reconciles the request and preserves its upstream identity', async t => {
  const state = mockBillingState(t); await reserve();
  const accepted = await markExternalRequestAccepted({ externalRequestId: state.request.externalRequestId,
    upstreamSessionId: state.request.upstreamSessionId, upstreamRequestId: 'upstream-result', creditsCharged: 12 });
  assert.equal(accepted.upstreamRequestId, 'upstream-result');
  assert.equal(accepted.creditsCharged, 12); assert.equal(accepted.creditsRefunded, 8);
  assertRefundBalance(state, 'external', 8);
  await refund(); assertRefundBalance(state, 'external');
});

test('zero-cost failure still updates request status without creating a refund', async t => {
  const state = mockBillingState(t); await refund();
  assert.equal(state.request.status, 'FAILED'); assert.equal(state.parent.generationCredits, 100);
  assert.equal(state.external.generationCredits, 100); assert.equal(state.externalTransactions.length, 0);
});

test('a concurrent acceptance retry cannot restore an already-refunded charge receipt', async t => {
  const state = mockBillingState(t); await reserve();
  await Promise.all([markExternalRequestAccepted({ externalRequestId: state.request.externalRequestId,
    upstreamRequestId: 'late-result', upstreamSessionId: state.request.upstreamSessionId, creditsCharged: 20 }), refund()]);
  assertRefundBalance(state, 'external'); assert.equal(state.request.status, 'FAILED');
});

test('an originally unlimited allocation cannot receive a refund for a parent-only debit', async t => {
  const state = mockBillingState(t, accounts.allocation); state.subAccount.generationCredits = null;
  await reserve(); state.subAccount.generationCredits = 10;
  await refund();
  assert.equal(state.parent.generationCredits, 100);
  assert.equal(state.subAccount.generationCredits, 10);
});

test('legacy net-charge receipts use ledger evidence to refund only the remaining entitlement', async t => {
  const state = mockBillingState(t); await reserve();
  delete state.request.refundCeilingCredits; delete state.request.billingAccount;
  state.external.generationCredits += 5;
  state.external.totalCreditsRefunded = 5;
  state.externalTransactions.push({ direction: 'credit', amount: 5 });
  state.request.creditsCharged = 15; state.request.creditsRefunded = 5;
  await refund(); assertRefundBalance(state, 'external');
});

test('legacy provisional and external failure callbacks share the same refund entitlement', async t => {
  const state = mockBillingState(t, accounts.internal); await reserve();
  const { default: VideoSession } = await import('../../schema/VideoSession.js');
  const { refundLegacyProvisionalCredits } = await import('../LegacyProvisionalRefund.js');
  const session = { _id: state.request.upstreamSessionId, userId: ids.parent, provisionalCredits: 20 };
  t.mock.method(VideoSession, 'findById', () => query(session));
  t.mock.method(VideoSession, 'updateOne', async (filter, update) => {
    if (!matches(session, filter)) return { matchedCount: 0 };
    applyUpdate(session, update); return { matchedCount: 1 };
  });
  await Promise.all([refundLegacyProvisionalCredits(session._id), refundLegacyProvisionalCredits(session._id), refund()]);
  assertRefundBalance(state, 'internal'); assert.equal(session.provisionalCredits, 0);
  await refundLegacyProvisionalCredits(session._id); assertRefundBalance(state, 'internal');
});

test('legacy direct refund survives a receipt failure and never overlaps agent/post-processing billing', async t => {
  const state = mockBillingState(t); state.request.upstreamSessionId = 'other-session'; state.parent.generationCredits = 80;
  const { default: VideoSession } = await import('../../schema/VideoSession.js');
  const { refundLegacyProvisionalCredits } = await import('../LegacyProvisionalRefund.js');
  const session = { _id: '507f191e810c19729de860ef', userId: ids.parent, provisionalCredits: 20 };
  let failReceipt = true;
  t.mock.method(VideoSession, 'findById', () => query(session));
  t.mock.method(VideoSession, 'updateOne', async (filter, update) => {
    if (!matches(session, filter)) return { matchedCount: 0 };
    if (failReceipt && update.$set?.provisionalCredits === 0) { failReceipt = false; throw Error('session outage'); }
    applyUpdate(session, update); return { matchedCount: 1 };
  });
  await assert.rejects(refundLegacyProvisionalCredits(session._id));
  await refundLegacyProvisionalCredits(session._id);
  assert.equal(state.parent.generationCredits, 100);
  assert.equal(state.parentTransactions.length, 1);
  delete session.legacyProvisionalRefund; session.provisionalCredits = 3600;
  for (const kind of ['hostedAgentBilling', 'postProcessingBilling']) {
    session[kind] = { version: 2 };
    await refundLegacyProvisionalCredits(session._id); assert.equal(state.parent.generationCredits, 100);
    delete session[kind];
  }
});
