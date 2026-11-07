import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { serveExternalChatStream } from './ExternalChatStreaming.js';
import { createExternalChatCompletion } from './ExternalChatAPI.js';
import { memoryRequestStore, memoryCreditAccount } from '../../test_helpers/AssistantBillingHarness.js';
import { debitAssistantOwnerOnce } from './AssistantRequestBilling.js';

class Response extends EventEmitter {
  frames = [];
  status(value) { this.statusCode = value; return this; }
  set(value) { this.headers = value; }
  write(value) { this.frames.push(value); }
  end() { this.writableEnded = true; this.emit('close'); }
}
const usage = { prompt_tokens: 1000, completion_tokens: 100 };
const payload = { model: 'gpt-6-astra', messages: [{ role: 'user', content: 'hello' }], stream: true };
const req = { userId: 'owner', body: payload, get: () => 'same-key' };

function harness() {
  const store = memoryRequestStore(), account = memoryCreditAccount(); let generations = 0;
  const dependencies = { store, connect: async () => {}, admit: async () => {},
    writeProgress: async (id, streamState) => store.save(id, { streamState }),
    createCompletion: async (_client, request) => {
      generations++;
      assert.equal(request.stream, undefined);
      await request.onText('Hello');
      return { id: 'provider', model: 'gpt-6-astra', usage, choices: [{ message: { content: 'Hello' } }] };
    },
    deductCredits: async (_user, credits, { idempotencyKey }) => debitAssistantOwnerOnce({
      ...account, ownerId: 'owner', credits, idempotencyKey,
    }),
  };
  return { store, account, dependencies, get generations() { return generations; },
    createCompletion: request => createExternalChatCompletion(request, dependencies) };
}

test('SSE streams provider text then a settled receipt; REST replay bills once', async () => {
  const h = harness(), res = new Response();
  await serveExternalChatStream(req, res, h);
  assert.match(res.frames.join(''), /event: snapshot/);
  assert.match(res.frames.at(-1), /event: completed/);
  const result = await h.createCompletion({ userId: 'owner', payload: { ...payload, stream: false }, idempotencyKey: 'same-key' });
  assert.equal(result.creditsCharged, 1.8); // (1000 * $10 + 100 * $50) / 1M * 100 * 1.2
  assert.equal(h.generations, 1);
  assert.equal(h.account.debits, 1);
});

test('disconnecting the client still collects final usage and settles exactly once', async () => {
  const h = harness(), res = new Response();
  const write = res.write.bind(res);
  res.write = frame => { write(frame); if (frame.includes('event: snapshot')) res.emit('close'); };
  await serveExternalChatStream(req, res, h);
  assert.equal(h.account.debits, 1);
  const replay = new Response();
  await serveExternalChatStream(req, replay, h);
  assert.match(replay.frames.at(-1), /event: completed/);
  assert.equal(h.generations, 1);
  assert.equal(h.account.debits, 1);
});

test('an active replay watches the existing receipt without dispatching inference again', async () => {
  const res = new Response(); let reads = 0;
  await serveExternalChatStream(req, res, {
    createCompletion: async () => { throw Object.assign(new Error('In progress'), { code: 'ASSISTANT_REQUEST_IN_PROGRESS' }); },
    store: { get: async () => { reads++; return { status: 'COMPLETED', streamState: { text: 'Hello' }, result: { response: { usage }, creditsCharged: 1.8 } }; } },
  });
  assert.equal(reads, 1);
  assert.match(res.frames.at(-1), /event: completed/);
});

test('usage failures are terminal SSE errors and preserve a reconcilable receipt', async () => {
  const h = harness(), res = new Response();
  h.dependencies.createCompletion = async (_client, request) => { await request.onText('Partial'); return { model: 'gpt-6-astra' }; };
  await serveExternalChatStream(req, res, h);
  assert.match(res.frames.at(-1), /ASSISTANT_BILLING_USAGE_REQUIRED/);
  assert.equal(h.account.debits, 0);
  assert.equal([...h.store.records.values()][0].status, 'BILLING_PENDING');
});

test('failed progress persistence cannot discard a valid provider receipt', async () => {
  const h = harness();
  h.dependencies.writeProgress = async () => { throw new Error('Snapshot unavailable'); };
  const res = new Response();
  await serveExternalChatStream(req, res, h);
  assert.match(res.frames.join(''), /event: snapshot/);
  assert.equal(h.account.debits, 1);
});
