import { buildAssistantMessages } from './AssistantMessageBuilder.js';
import { createAssistantStreamPublisher } from './AssistantStreamPublisher.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { assistantRequestIdentity, runAssistantRequest, debitAssistantOwnerOnce } from './AssistantRequestBilling.js';
import { memoryCreditAccount, memoryRequestStore } from './test_helpers/AssistantBillingHarness.js';

const source = fs.readFileSync(new URL('./AssistantQueryListener.js', import.meta.url), 'utf8')
  .replace(/^import\s[\s\S]*?;[^\n]*$/gm, '').replace(/export /g, '');

function harness({ standalone = false } = {}) {
  const store = memoryRequestStore();
  const account = memoryCreditAccount();
  const state = { providerCalls: 0, deliveries: 0, jobs: [{ _id: 'job', sessionId: 'session', queryId: 'query', rowLocked: false }] };
  const session = { userId: 'user', sessionMessages: [{ role: 'user', id: 'query', content: 'Hello' }], async save() {} };
  const context = vm.createContext({
    assistantRequestIdentity, runAssistantRequest, debitAssistantOwnerOnce, createAssistantStreamPublisher,
    AssistantBillingRequest: { find: () => ({ limit: () => ({ lean: async () => [...store.records.values()]
      .filter(r => r.providerResponse && r.status !== 'COMPLETED') }) }) },
    createMongoAssistantRequestStore: () => store,
    GenerationCreditTransaction: account.Ledger,
    AssistantQueryGeneration: {
      find: async () => structuredClone(state.jobs.filter(j => j.status !== 'reconciliation_required' && (!j.rowLocked || Number(j.workerLeaseExpiresAt) <= Date.now()))),
      updateOne: async (filter, update) => {
        const job = state.jobs.find(j => j._id === filter._id);
        if (!job) return { modifiedCount: 0 };
        if (filter.$or && job.rowLocked && Number(job.workerLeaseExpiresAt) > Date.now()) return { modifiedCount: 0 };
        Object.assign(job, update.$set || {});
        for (const key of Object.keys(update.$unset || {})) delete job[key];
        return { modifiedCount: 1 };
      },
      deleteOne: async ({ _id }) => { state.jobs = state.jobs.filter(j => j._id !== _id); },
    },
    VideoSession: {
      findOne: async () => session,
      updateOne: async (query, update) => {
        const requiredMessage = query.sessionMessages?.$elemMatch;
        if (requiredMessage && !session.sessionMessages.some(m => m.role === requiredMessage.role && m.id === requiredMessage.id)) {
          return { modifiedCount: 0 };
        }
        const message = update.$push?.sessionMessages;
        if (message && !session.sessionMessages.some(m => m.role === 'assistant' && m.id === message.id)) {
          state.deliveries++;
          session.sessionMessages.push(message);
        }
        Object.assign(session, update.$set || {});
        return { modifiedCount: 1 };
      },
    },
    User: { ...account.Owner, findOne: () => Object.assign(Promise.resolve(structuredClone(account.account)),
      { lean: async () => structuredClone(account.account) }) },
    sendAssistantCompletionRequest: async (_messages, _model, options) => {
      assert.equal(options.maxRetries, 0);
      assert.ok(options.assistantBillingRequestId);
      state.providerCalls++;
      return { response: { id: 'provider-response', model: 'gpt-6-astra', usage: { input_tokens: 1000, output_tokens: 100, cost: 999 },
        samsarBilling: { adapter: 'openrouter', costUsd: 0.025 } }, outputText: 'Hello', outputContent: ['Hello'] };
    },
    buildAssistantMessages,
    getSystemPrompt: () => ({ role: 'system', content: 'System' }),
    isStandaloneEdition: () => standalone,
    isGeminiInferenceModel: () => false, isKimiK3InferenceModel: () => false,
    normalizeInferenceModel: () => 'gpt-6-astra', console: { error() {} },
  });
  context.AssistantWorkspace = context.VideoSession;
  vm.runInContext(source, context);
  const processPending = () => vm.runInContext('processPendingAssistantRequests()', context);
  const recover = () => vm.runInContext('recoverPendingAssistantBilling()', context);
  return { store, account, state, session, processPending, recover, context };
}

test('two hosted assistant workers claim one job, invoke once, debit once and deliver once', async () => {
  const h = harness();
  await Promise.all([h.processPending(), h.processPending()]);
  assert.equal(h.state.providerCalls, 1);
  assert.equal(h.account.debits, 1);
  assert.equal(h.account.account.generationCredits, 98.2);
  assert.equal(h.account.transactions.size, 1);
  assert.equal(h.state.deliveries, 1);
  assert.equal(h.state.jobs.length, 0);
});

test('queued billing survives a ledger outage and restarts without another provider call or debit', async () => {
  const h = harness();
  const insert = h.account.Ledger.updateOne;
  let attempts = 0;
  h.account.Ledger.updateOne = (...args) => { if (++attempts === 1) throw new Error('ledger outage'); return insert(...args); };
  await h.processPending();
  assert.equal(h.account.debits, 1);
  assert.equal(h.state.jobs.length, 1);
  assert.equal(h.state.jobs[0].rowLocked, false);
  assert.equal(h.state.jobs[0].expireAt, undefined);
  await h.processPending();
  assert.equal(h.state.providerCalls, 1);
  assert.equal(h.account.debits, 1);
  assert.equal(h.account.transactions.size, 1);
  assert.equal(h.state.deliveries, 1);
});

test('the saved billing receipt can settle without the old TTL queue document', async () => {
  const h = harness();
  const insert = h.account.Ledger.updateOne;
  h.account.Ledger.updateOne = async () => { throw new Error('outage'); };
  await h.processPending();
  h.state.jobs = [];
  h.account.Ledger.updateOne = insert;
  await h.recover();
  assert.equal(h.state.providerCalls, 1);
  assert.equal(h.account.debits, 1);
  assert.equal(h.account.transactions.size, 1);
  assert.equal(h.state.deliveries, 1);
});

test('session delivery failure recovers one queued debit and one output message', async () => {
  const h = harness();
  const update = h.context.VideoSession.updateOne;
  let attempts = 0;
  h.context.VideoSession.updateOne = (...args) => { if (++attempts === 1) throw new Error('session outage'); return update(...args); };
  await h.processPending();
  await h.recover();
  await h.processPending();
  assert.equal(h.state.providerCalls, 1);
  assert.equal(h.account.debits, 1);
  assert.equal(h.state.deliveries, 1);
});

test('an empty account is rejected before queued provider work', async () => {
  const h = harness();
  h.account.account.generationCredits = 0;
  await h.processPending();
  assert.equal(h.state.providerCalls, 0);
  assert.equal(h.account.debits, 0);
  assert.equal(h.state.jobs.length, 0);
  assert.equal(h.session.sessionMessageGenerationError, 'Insufficient credits');
});

test('standalone queued assistants retain their no-local-debit policy', async () => {
  const h = harness({ standalone: true });
  h.account.account.generationCredits = 0;
  await h.processPending();
  assert.equal(h.state.providerCalls, 1);
  assert.equal(h.account.debits, 0);
  assert.equal(h.state.deliveries, 1);
});


test('cleared queue work is discarded before provider invocation', async () => {
  const h = harness();
  h.session.sessionMessages = [];
  h.session.assistantSessionVersion = 1;
  await h.processPending();
  assert.equal(h.state.providerCalls, 0);
  assert.equal(h.account.debits, 0);
  assert.equal(h.state.jobs.length, 0);
});

test('clear while provider runs drops its reply and keeps the new request pending', async () => {
  const h = harness();
  const generate = h.context.sendAssistantCompletionRequest;
  h.context.sendAssistantCompletionRequest = async (...args) => {
    const response = await generate(...args);
    h.session.sessionMessages = [{ id: 'new-query', role: 'user', content: 'New conversation' }];
    h.session.assistantSessionVersion = 1;
    h.session.sessionMessageGenerationPending = true;
    h.state.jobs = [];
    return response;
  };
  await h.processPending();
  assert.equal(h.state.deliveries, 0);
  assert.equal(h.session.sessionMessages.length, 1);
  assert.equal(h.session.sessionMessageGenerationPending, true);
  assert.equal(h.account.debits, 1); // Completed provider work still settles once.
  const receipt = [...h.store.records.values()][0];
  assert.equal(receipt.providerResponse, null);
  assert.equal(receipt.result.response, undefined);
});

test('provider failure after clear cannot restore old messages or overwrite new pending state', async () => {
  const h = harness();
  h.context.sendAssistantCompletionRequest = async () => {
    h.session.sessionMessages = [{ id: 'new-query', role: 'user', content: 'New conversation' }];
    h.session.assistantSessionVersion = 1;
    h.session.sessionMessageGenerationPending = true;
    h.session.sessionMessageGenerationError = null;
    throw new Error('Old provider failed');
  };
  await h.processPending();
  assert.equal(h.session.sessionMessageGenerationPending, true);
  assert.equal(h.session.sessionMessageGenerationError, null);
  assert.equal(h.state.deliveries, 0);
});

test('clear during worker admission is rechecked before dispatch', async () => {
  const h = harness();
  const findUser = h.context.User.findOne;
  h.context.User.findOne = (...args) => {
    h.session.sessionMessages = [];
    h.session.assistantSessionVersion = 1;
    return findUser(...args);
  };
  await h.processPending();
  assert.equal(h.state.providerCalls, 0);
  assert.equal(h.account.debits, 0);
});

test('billing recovery after clear settles without resurrecting conversation content', async () => {
  const h = harness();
  const insert = h.account.Ledger.updateOne;
  h.account.Ledger.updateOne = async () => { throw new Error('outage'); };
  await h.processPending();
  h.session.sessionMessages = [];
  h.session.assistantSessionVersion = 1;
  h.session.sessionMessageGenerationPending = false;
  h.state.jobs = [];
  h.account.Ledger.updateOne = insert;
  await h.recover();
  assert.equal(h.state.providerCalls, 1);
  assert.equal(h.account.debits, 1);
  assert.equal(h.state.deliveries, 0);
  assert.equal(h.session.sessionMessages.length, 0);
  assert.equal([...h.store.records.values()][0].providerResponse, null);
});


test('streamed partial replies survive interruption without entering conversation history or charging an estimate', async () => {
  const h = harness(); h.state.jobs[0].stream = true;
  let calls = 0;
  h.context.sendAssistantCompletionRequest = async (_messages, _model, options) => {
    calls++;
    await options.onText('Partial answer');
    throw Object.assign(new Error('Provider stream ended'), { code: 'ASSISTANT_STREAM_INTERRUPTED' });
  };
  await h.processPending();
  assert.equal(h.session.assistantStream.text, 'Partial answer');
  assert.equal(h.session.assistantStream.status, 'interrupted');
  assert.equal(h.session.sessionMessageGenerationPending, false);
  assert.equal(h.session.sessionMessages.filter(message => message.role === 'assistant').length, 0);
  assert.equal(h.state.jobs[0].status, 'reconciliation_required');
  await h.processPending();
  assert.equal(calls, 1);
  assert.equal(h.account.debits, 0);
});

test('streamed completion and a ledger retry keep one final reply and one debit', async () => {
  const h = harness(); h.state.jobs[0].stream = true;
  const provider = h.context.sendAssistantCompletionRequest;
  h.context.sendAssistantCompletionRequest = async (...args) => {
    await args[2].onText('Hel'); await args[2].onText('Hello'); return provider(...args);
  };
  const insert = h.account.Ledger.updateOne; let failures = 0;
  h.account.Ledger.updateOne = (...args) => { if (!failures++) throw new Error('Ledger unavailable'); return insert(...args); };
  await h.processPending();
  assert.equal(h.session.assistantStream.text, 'Hello');
  assert.equal(h.session.assistantStream.status, 'billing_pending');
  await h.processPending();
  assert.equal(h.session.assistantStream.status, 'completed');
  assert.equal(h.state.deliveries, 1);
  assert.equal(h.account.debits, 1);
  assert.equal(h.state.providerCalls, 1);
});


test('contextual streamed workspace calls retain one provider invocation and one charge', async () => {
  const h = harness();
  h.state.jobs[0].assistantContext = { version: 1, page: 'audio', view: 'join' };
  h.state.jobs[0].sessionStore = 'workspace';
  h.state.jobs[0].query = 'Join audio clips';
  h.state.jobs[0].stream = true;
  let captured;
  const original = h.context.sendAssistantCompletionRequest;
  h.context.sendAssistantCompletionRequest = async (messages, ...args) => { captured = messages; return original(messages, ...args); };
  await h.processPending();
  assert.match(captured[0].content, /Audio Studio/);
  assert.equal(h.state.providerCalls, 1);
  assert.equal(h.account.debits, 1);
  assert.equal(h.state.deliveries, 1);
});
