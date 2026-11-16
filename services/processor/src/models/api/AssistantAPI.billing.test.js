import assert from 'node:assert/strict';
import test from 'node:test';
import { createAssistantCompletion } from './AssistantAPI.js';
import { createExternalChatCompletion, createExternalChatCompletionRequest, processExternalChatCompletionRequest } from './ExternalChatAPI.js';
import { recoverAssistantBilling } from './AssistantBillingRecovery.js';
import { assistantRequestIdentity, debitAssistantOwnerOnce } from './AssistantRequestBilling.js';
import { memoryCreditAccount, memoryRequestStore } from '../../test_helpers/AssistantBillingHarness.js';

const sessionId = '67df0d8ebc4f9d0b7f4fd123';
function harness(model = 'gpt-6-astra', adapter = 'openrouter') {
  const account = memoryCreditAccount();
  const store = memoryRequestStore();
  const session = { userId: 'user', sessionMessages: [] };
  const state = { providerCalls: 0, admissions: 0 };
  const Sessions = {
    findById: async () => session,
    async updateOne(query, update) {
      if (query['sessionMessages.id']?.$ne && session.sessionMessages.some(m => m.id === query['sessionMessages.id'].$ne)) return { modifiedCount: 0 };
      if (update.$push) {
        const value = update.$push.sessionMessages;
        session.sessionMessages.push(...(value.$each || [value]));
      }
      Object.assign(session, update.$set || {});
      return { modifiedCount: 1 };
    },
  };
  const response = { id: 'response-1', model, output_text: 'Hello', output: [],
    usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 500 }, output_tokens: 100,
      output_tokens_details: { reasoning_tokens: 60 } },
    ...(adapter ? { samsarBilling: { adapter, costUsd: 0.025 } } : {}) };
  const charge = (_user, credits, options) => debitAssistantOwnerOnce({ ...account,
    ownerId: 'user', credits, idempotencyKey: options.idempotencyKey });
  const dependencies = {
    connect: async () => {}, store, VideoSession: Sessions,
    User: { findById: async () => ({ selectedAssistantModel: model }) },
    admit: async () => { state.admissions++; },
    createCompletion: async () => { state.providerCalls++; return structuredClone(response); },
    charge,
  };
  return { account, store, session, state, response, dependencies, charge, Sessions };
}

for (const [model, expectedCredits] of [['gpt-6-astra', 1.26], ['gemini-4-carbon', 0.246], ['qwen3.8-max', 0.207], ['kimi-k3', 0.378], ['claude-opus-5.5', 0.492]]) {
  for (const endpoint of ['session', 'external']) {
    test(`${endpoint} assistant ${model} applies 20% once and replays the saved response`, async () => {
      const h = harness(model);
      const request = { session_id: sessionId, input: 'Hello', messages: [{ role: 'user', content: 'Hello' }],
        pricingMultiplier: 99, samsarBilling: { costUsd: 0 } };
      const call = endpoint === 'session'
        ? () => createAssistantCompletion('user', request, { idempotencyKey: 'sdk-request', dependencies: h.dependencies })
        : () => createExternalChatCompletion({ userId: 'user', payload: request, idempotencyKey: 'sdk-request' },
          { ...h.dependencies, deductCredits: h.charge });
      const first = await call();
      assert.equal(first.creditsCharged, expectedCredits);
      assert.deepEqual(await call(), first);
      assert.equal(h.state.providerCalls, 1);
      assert.equal(h.account.debits, 1);
      assert.equal(h.account.transactions.size, 1);
      if (endpoint === 'session') {
        assert.equal(h.session.sessionMessages.filter(m => m.role === 'user').length, 1);
        assert.equal(h.session.sessionMessages.filter(m => m.role === 'assistant').length, 1);
      }
    });
  }
}

for (const endpoint of ['session', 'external']) {
  test(`${endpoint} native cached-input and reasoning-inclusive output are charged once`, async () => {
    const h = harness('gpt-6-astra', null);
    const request = { session_id: sessionId, input: 'Hi', messages: [{ role: 'user', content: 'Hi' }] };
    const result = endpoint === 'session'
      ? await createAssistantCompletion('user', request, { dependencies: h.dependencies })
      : await createExternalChatCompletion({ userId: 'user', payload: request }, { ...h.dependencies, deductCredits: h.charge });
    // 500 uncached × $10/M + 500 cached × $1/M + 100 output × $50/M.
    assert.equal(result.creditsCharged, 1.26);
  });
}

test('session authorization rejects another owner before inference or billing', async () => {
  const h = harness();
  h.session.userId = 'someone-else';
  await assert.rejects(createAssistantCompletion('user', { session_id: sessionId, input: 'Hello' }, { dependencies: h.dependencies }),
    { statusCode: 403 });
  assert.equal(h.state.providerCalls, 0);
  assert.equal(h.account.debits, 0);
});

test('background recovery settles a retained SDK response without a client retry or new provider call', async () => {
  const h = harness();
  await assert.rejects(createExternalChatCompletion({ userId: 'user', payload: { messages: [{ role: 'user', content: 'Hi' }] },
    idempotencyKey: 'pending' }, { ...h.dependencies, deductCredits: async () => { throw new Error('ledger outage'); } }), /outage/);
  const results = await recoverAssistantBilling({ ...h.dependencies, receipts: [...h.store.records.values()], charge: h.charge });
  assert.equal(results.length, 1);
  assert.equal(h.state.providerCalls, 1);
  assert.equal(h.account.debits, 1);
  assert.equal(h.account.account.generationCredits, 98.74);
});

test('session output persistence failure recovers one debit and one assistant message', async () => {
  const h = harness();
  const update = h.Sessions.updateOne;
  let failed = false;
  h.Sessions.updateOne = async (query, payload) => {
    if (payload.$push?.sessionMessages?.role === 'assistant' && !failed) { failed = true; throw new Error('session outage'); }
    return update(query, payload);
  };
  const request = { session_id: sessionId, input: 'Hi' };
  await assert.rejects(createAssistantCompletion('user', request, { idempotencyKey: 'pending', dependencies: h.dependencies }), /outage/);
  await recoverAssistantBilling({ ...h.dependencies, receipts: [...h.store.records.values()], charge: h.charge });
  await createAssistantCompletion('user', request, { idempotencyKey: 'pending', dependencies: h.dependencies });
  assert.equal(h.state.providerCalls, 1);
  assert.equal(h.account.debits, 1);
  assert.equal(h.session.sessionMessages.filter(m => m.role === 'assistant').length, 1);
});

test('async submission preserves the SDK Idempotency-Key and rejects changed payloads', async () => {
  const records = new Map();
  const Requests = { findOneAndUpdate(query, update) { return { lean: async () => {
    const id = String(query._id);
    if (!records.has(id)) records.set(id, { ...update.$setOnInsert, _id: id });
    return records.get(id);
  } }; } };
  const dependencies = { Requests, connect: async () => {}, queue: () => {} };
  const payload = { async: true, messages: [{ role: 'user', content: 'Hello' }], client_session_id: 'session' };
  const first = await createExternalChatCompletionRequest({ userId: 'user', payload, idempotencyKey: 'sdk-key' }, dependencies);
  const replay = await createExternalChatCompletionRequest({ userId: 'user', payload, idempotencyKey: 'sdk-key' }, dependencies);
  assert.equal(first.request_id, replay.request_id);
  assert.equal(records.size, 1);
  const queued = [...records.values()][0];
  assert.equal(queued.billingKey, 'sdk-key');
  const sync = assistantRequestIdentity('user', 'external_chat', payload, 'sdk-key');
  const asyncIdentity = assistantRequestIdentity('user', 'external_chat', queued.payload, queued.billingKey);
  assert.deepEqual(sync, asyncIdentity);
  await assert.rejects(createExternalChatCompletionRequest({ userId: 'user', payload: { ...payload,
    messages: [{ role: 'user', content: 'Changed' }] }, idempotencyKey: 'sdk-key' }, dependencies),
  { code: 'ASSISTANT_IDEMPOTENCY_CONFLICT' });
});


for (const failure of ['ledger', 'queue-result']) {
  test(`async SDK settlement recovers a ${failure} failure with one provider response and debit`, async () => {
    const h = harness();
    const job = { _id: 'job', userId: 'user', status: 'PENDING', clientRequestId: 'async-request',
      billingKey: 'async-request', apiKeyUsage: { apiKeyId: 'original-api-key' }, payload: { model: 'gpt-6-astra', messages: [{ role: 'user', content: 'Hi' }] } };
    let fail = true;
    const Requests = {
      findById() { return { select: () => ({ lean: async () => structuredClone(job) }) }; },
      findOneAndUpdate() { return { lean: async () => {
        if (job.status === 'COMPLETED') return null;
        job.status = 'PROCESSING';
        return structuredClone(job);
      } }; },
      findByIdAndUpdate(_id, update) {
        return { lean: async () => {
          if (failure === 'queue-result' && update.$set.status === 'COMPLETED' && fail) { fail = false; throw new Error('queue outage'); }
          Object.assign(job, update.$set);
          return structuredClone(job);
        }, then(resolve, reject) { return this.lean().then(resolve, reject); } };
      },
    };
    const charge = h.charge;
    const dependencies = { connect: async () => {}, Requests, completionDependencies: {
      ...h.dependencies, deductCredits: (...args) => {
        if (failure === 'ledger' && fail) { fail = false; throw new Error('ledger outage'); }
        return charge(...args);
      },
    } };
    const pending = await processExternalChatCompletionRequest('job', dependencies);
    assert.equal(pending.status, 'PENDING');
    assert.equal(job.payload.messages[0].content, 'Hi');
    const completed = await processExternalChatCompletionRequest('job', dependencies);
    assert.equal(completed.status, 'COMPLETED');
    assert.equal(completed.creditsCharged, 1.26);
    assert.equal(h.state.providerCalls, 1);
    assert.equal(h.account.debits, 1);
    assert.equal(h.account.transactions.size, 1);
    assert.equal(job.payload, null);
    assert.equal([...h.store.records.values()][0].context.apiKeyUsage.apiKeyId, 'original-api-key');
  });
}
