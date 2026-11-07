import assert from 'node:assert/strict';
import test from 'node:test';
import { assistantRequestIdentity, runAssistantRequest, debitAssistantOwnerOnce } from './AssistantRequestBilling.js';
import { calculateAssistantRequestBilling, normalizeAssistantResponseUsage } from './AssistantBilling.js';
import { memoryRequestStore, memoryCreditAccount } from './test_helpers/AssistantBillingHarness.js';

function harness() {
  const store = memoryRequestStore();
  const account = memoryCreditAccount();
  let providerCalls = 0;
  let deliveries = 0;
  const options = { ...assistantRequestIdentity('user', 'assistant', { input: 'hello' }, 'request'),
    userId: 'user', scope: 'assistant', store,
    generate: async () => {
      providerCalls++;
      return { id: 'provider-response', model: 'openai/gpt-6-astra',
        usage: { prompt_tokens: 1000, completion_tokens: 100, cost: 0.01 },
        samsarBilling: { adapter: 'openrouter', costUsd: 0.01 } };
    },
    charge: (credits, { idempotencyKey }) => debitAssistantOwnerOnce({
      ...account, ownerId: 'user', credits, idempotencyKey, ledger: { userId: 'user' },
    }),
    finalize: async (response, billing, debit) => {
      deliveries++;
      return { response, creditsCharged: billing.credits, remainingCredits: debit.remainingCredits };
    },
  };
  return { store, account, options, get providerCalls() { return providerCalls; }, get deliveries() { return deliveries; } };
}

test('repeated assistant requests reuse one provider response and one fractional debit', async () => {
  const h = harness();
  const first = await runAssistantRequest(h.options);
  const replay = await runAssistantRequest(h.options);
  assert.deepEqual(replay, first);
  assert.equal(first.creditsCharged, 1.8);
  assert.equal(h.providerCalls, 1);
  assert.equal(h.account.debits, 1);
  assert.equal(h.account.transactions.size, 1);
  assert.equal(h.deliveries, 1);
});

test('concurrent copies of a request cannot dispatch or debit twice', async () => {
  const h = harness();
  const results = await Promise.allSettled([runAssistantRequest(h.options), runAssistantRequest(h.options)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'ASSISTANT_REQUEST_IN_PROGRESS');
  await runAssistantRequest(h.options);
  assert.equal(h.providerCalls, 1);
  assert.equal(h.account.debits, 1);
});

test('a debit failure retains usage and retries settlement without repeating inference', async () => {
  const h = harness();
  const charge = h.options.charge;
  let attempts = 0;
  h.options.charge = (...args) => { if (++attempts === 1) throw new Error('database unavailable'); return charge(...args); };
  await assert.rejects(runAssistantRequest(h.options), /database unavailable/);
  assert.equal(h.store.records.get(h.options.id).status, 'BILLING_PENDING');
  await runAssistantRequest(h.options);
  assert.equal(h.providerCalls, 1);
  assert.equal(h.account.debits, 1);
});

test('failure between balance debit and ledger insert repairs the ledger without another debit', async () => {
  const h = harness();
  const insert = h.account.Ledger.updateOne;
  let attempts = 0;
  h.account.Ledger.updateOne = (...args) => { if (++attempts === 1) throw new Error('ledger unavailable'); return insert(...args); };
  await assert.rejects(runAssistantRequest(h.options), /ledger unavailable/);
  assert.equal(h.account.debits, 1);
  await runAssistantRequest(h.options);
  assert.equal(h.providerCalls, 1);
  assert.equal(h.account.debits, 1);
  assert.equal(h.account.transactions.size, 1);
});

test('session delivery failure after charging does not lose or duplicate billing on recovery', async () => {
  const h = harness();
  const deliver = h.options.finalize;
  let attempts = 0;
  h.options.finalize = (...args) => { if (++attempts === 1) throw new Error('session unavailable'); return deliver(...args); };
  await assert.rejects(runAssistantRequest(h.options), /session unavailable/);
  await runAssistantRequest(h.options);
  assert.equal(h.providerCalls, 1);
  assert.equal(h.account.debits, 1);
  assert.equal(h.deliveries, 1);
});

test('missing usage never silently becomes free or word-priced inference', async () => {
  const h = harness();
  h.options.generate = async () => ({ id: 'missing-usage', model: 'gpt-6-astra', output_text: 'hello' });
  await assert.rejects(runAssistantRequest(h.options), { code: 'ASSISTANT_BILLING_USAGE_REQUIRED' });
  assert.equal(h.account.debits, 0);
  const pending = h.store.records.get(h.options.id);
  pending.providerResponse.usage = { input_tokens: 1000, output_tokens: 100 };
  pending.providerResponse.samsarBilling = { adapter: 'openrouter', costUsd: 999 };
  const recovered = await runAssistantRequest(h.options);
  assert.equal(recovered.creditsCharged, 1.8);
  assert.equal(h.account.debits, 1);
});

test('explicit zero token responses are completed without a fallback minimum charge', async () => {
  const h = harness();
  h.options.generate = async () => ({ model: 'gpt-6-astra', usage: { input_tokens: 0, output_tokens: 0 },
    samsarBilling: { adapter: 'openrouter', costUsd: 999 } });
  const result = await runAssistantRequest(h.options);
  assert.equal(result.creditsCharged, 0);
  assert.equal(h.account.debits, 0);
  assert.equal(h.store.records.get(h.options.id).status, 'COMPLETED');
});

test('provider failure or admission rejection produces no debit', async () => {
  for (const point of ['generate', 'admit']) {
    const h = harness();
    h.options[point] = async () => { throw new Error(`${point} failed`); };
    await assert.rejects(runAssistantRequest(h.options), /failed/);
    assert.equal(h.account.debits, 0);
    assert.equal(h.account.transactions.size, 0);
    if (point === 'admit') assert.equal(h.providerCalls, 0);
  }
});

test('different assistant requests settle atomically against the same balance', async () => {
  const h = harness();
  const other = { ...h.options, ...assistantRequestIdentity('user', 'assistant', {}, 'other') };
  await Promise.all([runAssistantRequest(h.options), runAssistantRequest(other)]);
  assert.equal(h.providerCalls, 2);
  assert.equal(h.account.debits, 2);
  assert.equal(h.account.transactions.size, 2);
  assert.ok(Math.abs(h.account.account.generationCredits - 96.4) < 1e-10);
});

test('request identity is owner-scoped and refuses changed payloads under the same key', async () => {
  const h = harness();
  await runAssistantRequest(h.options);
  const changed = assistantRequestIdentity('user', 'assistant', { input: 'changed' }, 'request');
  await assert.rejects(runAssistantRequest({ ...h.options, ...changed }), { code: 'ASSISTANT_IDEMPOTENCY_CONFLICT' });
  assert.notEqual(assistantRequestIdentity('other-user', 'assistant', {}, 'request').id, h.options.id);
  assert.equal(h.account.debits, 1);
});

test('stale provider dispatch with no receipt is retained for reconciliation instead of inferred twice', async () => {
  const h = harness();
  await h.store.ensure(h.options.id, { fingerprint: h.options.fingerprint, status: 'PROCESSING', dispatchStarted: true });
  await assert.rejects(runAssistantRequest(h.options), { code: 'ASSISTANT_PROVIDER_OUTCOME_UNKNOWN' });
  assert.equal(h.providerCalls, 0);
  assert.equal(h.account.debits, 0);
  assert.equal(h.store.records.get(h.options.id).status, 'BILLING_PENDING');
});

test('Responses and Chat usage conversions preserve cache counts, reasoning and adapter cost', () => {
  const raw = { input_tokens: 10000, input_tokens_details: { cached_tokens: 8000, cache_write_tokens: 1000 },
    output_tokens: 100, output_tokens_details: { reasoning_tokens: 60 }, cost: 0.02 };
  const normalized = normalizeAssistantResponseUsage(normalizeAssistantResponseUsage(raw));
  assert.equal(normalized.input_tokens, 10000);
  assert.equal(normalized.prompt_tokens, 10000);
  assert.equal(normalized.prompt_tokens_details.cached_tokens, 8000);
  assert.equal(normalized.output_tokens, 100);
  assert.equal(normalized.output_tokens_details.reasoning_tokens, 60);
  assert.equal(normalized.cost, 0.02);
});

test('malformed adapter monetary fields cannot override checked-in token prices', () => {
  for (const costUsd of [null, undefined, '', -1, NaN, Infinity, {}, false]) {
    assert.equal(calculateAssistantRequestBilling({ model: 'gpt-6-astra',
      usage: { input_tokens: 1000 }, samsarBilling: { adapter: 'openrouter', costUsd } }).credits, 1.2);
  }
});

test('all adapters use checked-in tariffs without requiring a monetary receipt', () => {
  for (const adapter of ['openrouter', 'samsar', 'gmicloud']) {
    assert.equal(calculateAssistantRequestBilling({ model: 'gpt-6-astra',
      usage: { input_tokens: 1000 }, samsarBilling: { adapter } }).credits, 1.2);
  }
});

test('an ambiguous provider timeout is retained and never automatically dispatched again', async () => {
  const h = harness();
  let calls = 0;
  h.options.generate = async () => { calls++; throw Object.assign(new Error('provider timed out'), { code: 'ETIMEDOUT' }); };
  await assert.rejects(runAssistantRequest(h.options), { code: 'ETIMEDOUT' });
  assert.equal(h.store.records.get(h.options.id).status, 'BILLING_PENDING');
  await assert.rejects(runAssistantRequest(h.options), { code: 'ASSISTANT_PROVIDER_OUTCOME_UNKNOWN' });
  assert.equal(calls, 1);
  assert.equal(h.account.debits, 0);
});

test('native image and other paid tool calls cannot complete with only the text portion billed', () => {
  for (const type of ['image_generation_call', 'web_search_call', 'file_search_call', 'code_interpreter_call']) {
    const response = { model: 'gpt-6-astra', usage: { input_tokens: 1000, output_tokens: 100 }, output: [{ type }] };
    assert.throws(() => calculateAssistantRequestBilling(response), { code: 'ASSISTANT_BILLING_TOOL_COST_REQUIRED' });
    response.samsarBilling = { adapter: 'openrouter', costUsd: 0.05 };
    assert.throws(() => calculateAssistantRequestBilling(response), { code: 'ASSISTANT_BILLING_TOOL_COST_REQUIRED' });
  }
});

test('malformed native token counts are retained for reconciliation instead of under-billed', () => {
  for (const usage of [{ input_tokens: -1, output_tokens: 10 },
    { input_tokens: 10, output_tokens: 'invalid' },
    { input_tokens: 10, input_tokens_details: { cached_tokens: 20 }, output_tokens: 10 },
    { input_tokens: true, output_tokens: 10 }]) {
    assert.throws(() => calculateAssistantRequestBilling({ model: 'gpt-6-astra', usage }),
      { code: 'ASSISTANT_BILLING_INVALID_USAGE' });
  }
});

test('native responses with explicit zero token usage are free without a minimum debit', () => {
  const billing = calculateAssistantRequestBilling({ model: 'gpt-6-astra', usage: { input_tokens: 0, output_tokens: 0 } });
  assert.equal(billing.credits, 0);
  assert.equal(billing.billable, true);
});


test('native tariff dates are frozen on the receipt across billing recovery', async () => {
  for (const [pricingTimestampMs, expected] of [[Date.UTC(2026, 10, 30), 0.36], [Date.UTC(2026, 11, 1), 0.72]]) {
    const h = harness();
    await h.store.ensure(h.options.id, { fingerprint: h.options.fingerprint, status: 'BILLING_PENDING', pricingTimestampMs,
      providerResponse: { model: 'gemini-4-argon', usage: { input_tokens: 1000, output_tokens: 100 } } });
    const result = await runAssistantRequest(h.options);
    assert.equal(result.creditsCharged, expected);
    assert.equal(h.providerCalls, 0);
  }
});

test('explicit client request ids identify the same work across sync, async and changing HTTP retry keys', () => {
  const payload = { messages: [{ role: 'user', content: 'Hi' }], client_request_id: 'client-key' };
  const sync = assistantRequestIdentity('user', 'external_chat', payload, 'http-key');
  const retry = assistantRequestIdentity('user', 'external_chat', { ...payload, async: true, client_session_id: 'session' }, 'other-http-key');
  const queued = assistantRequestIdentity('user', 'external_chat', { messages: payload.messages }, 'client-key');
  assert.deepEqual(sync, retry);
  assert.deepEqual(sync, queued);
});


test('a pre-dispatch admission rejection can resume under the same key after credits are restored', async () => {
  const h = harness();
  let admitted = false;
  h.options.admit = async () => { if (!admitted) throw new Error('Insufficient credits'); };
  await assert.rejects(runAssistantRequest(h.options), /Insufficient/);
  assert.equal(h.providerCalls, 0);
  admitted = true;
  await runAssistantRequest(h.options);
  assert.equal(h.providerCalls, 1);
  assert.equal(h.account.debits, 1);
});


test('F2P: unsupported static models are rejected before any provider dispatch or admission', async () => {
  const h = harness();
  let admissions = 0;
  h.options.model = 'unlisted-provider/model';
  h.options.admit = async () => { admissions++; };
  await assert.rejects(runAssistantRequest(h.options), { code: 'ASSISTANT_BILLING_TARIFF_UNAVAILABLE' });
  assert.equal(h.providerCalls, 0);
  assert.equal(admissions, 0);
  assert.equal(h.account.debits, 0);
});

test('P2P: historical sealed billing is reused without applying the new tariff or markup again', async () => {
  const h = harness();
  await h.store.ensure(h.options.id, { fingerprint: h.options.fingerprint, status: 'BILLING_PENDING',
    providerResponse: { model: 'retired-provider/model', usage: { cost: 999 } },
    billing: { credits: 7.5, costUsd: 0.05, pricingMultiplier: 1.5, costSource: 'historical_sealed' } });
  const result = await runAssistantRequest(h.options);
  assert.equal(result.creditsCharged, 7.5);
  assert.equal(h.providerCalls, 0);
  assert.equal(h.account.debits, 1);
});


test('REST and streaming share billing identity while transport flags do not change a request', () => {
  const payload = { model: 'gpt-6-astra', messages: [{ role: 'user', content: 'hello' }] };
  assert.deepEqual(assistantRequestIdentity('user', 'assistant', payload, 'key'),
    assistantRequestIdentity('user', 'assistant', { ...payload, stream: true, stream_options: { include_usage: true } }, 'key'));
});

test('a truncated provider stream is retained for reconciliation and never dispatched twice', async () => {
  const h = harness(); let calls = 0;
  h.options.generate = async () => { calls++; throw Object.assign(new Error('Connection ended'), { code: 'ASSISTANT_STREAM_INTERRUPTED' }); };
  await assert.rejects(runAssistantRequest(h.options), { code: 'ASSISTANT_STREAM_INTERRUPTED' });
  assert.equal(h.store.records.get(h.options.id).status, 'BILLING_PENDING');
  await assert.rejects(runAssistantRequest(h.options), { code: 'ASSISTANT_PROVIDER_OUTCOME_UNKNOWN' });
  assert.equal(calls, 1);
  assert.equal(h.account.debits, 0);
});

test('stream usage settles cached input and inclusive reasoning output once with the existing 20 percent markup', async () => {
  const h = harness();
  h.options.generate = async () => ({ model: 'gpt-6-astra', usage: {
    prompt_tokens: 1000, completion_tokens: 100,
    prompt_tokens_details: { cached_tokens: 200 }, completion_tokens_details: { reasoning_tokens: 75 },
  } });
  const result = await runAssistantRequest(h.options);
  // Astra tariffs: $10 uncached / $1 cached / $50 output per million.
  assert.equal(result.creditsCharged, 1.584);
  assert.deepEqual(await runAssistantRequest(h.options), result);
  assert.equal(h.account.debits, 1);
});

test('lost receipt ownership prevents dispatch and debit by the old worker', async () => {
  const h = harness();
  h.store.save = async () => null;
  await assert.rejects(runAssistantRequest(h.options), { code: 'ASSISTANT_REQUEST_IN_PROGRESS' });
  assert.equal(h.providerCalls, 0);
  assert.equal(h.account.debits, 0);
});

test('a transient usage-persistence failure still retains the response and recovers without another inference', async () => {
  const h = harness(); const save = h.store.save; let failed = false;
  h.store.save = async (id, fields) => {
    if (fields.providerResponse && !failed) { failed = true; throw new Error('Receipt unavailable'); }
    return save(id, fields);
  };
  await assert.rejects(runAssistantRequest(h.options), /Receipt unavailable/);
  assert.ok(h.store.records.get(h.options.id).providerResponse);
  await runAssistantRequest(h.options);
  assert.equal(h.providerCalls, 1);
  assert.equal(h.account.debits, 1);
});


test('an original provider finishing after lease loss retains its receipt for the new owner', async () => {
  const h = harness(); const save = h.store.save; let saves = 0;
  h.store.save = (...args) => ++saves === 2 ? null : save(...args);
  h.store.retainResponse = async (id, providerResponse) => { h.store.records.get(id).providerResponse = providerResponse; };
  await assert.rejects(runAssistantRequest(h.options), { code: 'ASSISTANT_REQUEST_IN_PROGRESS' });
  assert.ok(h.store.records.get(h.options.id).providerResponse);
  assert.equal(h.account.debits, 0);
  h.store.records.get(h.options.id).leaseUntil = null;
  await runAssistantRequest(h.options);
  assert.equal(h.providerCalls, 1);
  assert.equal(h.account.debits, 1);
});
