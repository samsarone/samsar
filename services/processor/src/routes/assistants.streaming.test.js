import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('./assistants.js', import.meta.url), 'utf8')
  .replace(/^import\s[\s\S]*?;[^\n]*$/gm, '').replace(/export default router;/, '');

function harness({ authorized = true, pending = true, failure } = {}) {
  const routes = new Map();
  const snapshot = { sessionMessages: [{ role: 'user', content: 'Question' }],
    assistantSessionVersion: 2, sessionMessageGenerationPending: pending,
    assistantStream: { queryId: 'q', text: 'Live answer', sequence: 4, status: pending ? 'streaming' : 'completed' } };
  const legacy = { status: 'PENDING', assistantStream: snapshot.assistantStream };
  let reads = 0;
  vm.runInNewContext(source, {
    express: { Router: () => ({ get: (path, handler) => routes.set(path, handler), post() {} }) },
    verifyUserAuth: () => authorized ? 'owner' : null,
    getAssistantQueryGenerationStatus: async id => { assert.equal(id, 'session'); return legacy; },
    getAssistantStreamSnapshot: async (userId, payload) => {
      reads++;
      assert.equal(userId, 'owner'); assert.equal(payload.id, 'session');
      if (failure) throw failure;
      return snapshot;
    },
  });
  return { snapshot, legacy, get reads() { return reads; }, async status(optIn = true) {
    const res = { statusCode: 200, status(value) { this.statusCode = value; return this; },
      json(value) { this.body = value; return this; }, send(value) { this.body = value; return this; } };
    await routes.get('/assistant_query_status')({ query: { id: 'session', ...(optIn ? { include_messages: 'true' } : {}) }, headers: {} }, res);
    return res;
  } };
}

test('legacy polling keeps its existing response without requesting history', async () => {
  const h = harness();
  assert.equal((await h.status(false)).body, h.legacy);
  assert.equal(h.reads, 0);
});

test('opt-in polling exposes the authorized live snapshot before completion', async () => {
  const h = harness(); const res = await h.status();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'PENDING');
  assert.equal(res.body.sessionDetails, h.snapshot);
  assert.equal(res.body.sessionDetails.assistantStream.text, 'Live answer');
  const complete = await harness({ pending: false }).status();
  assert.equal(complete.body.status, 'COMPLETED');
});

test('opt-in polling rejects missing auth and propagates session access failures', async () => {
  const h = harness({ authorized: false });
  assert.equal((await h.status()).statusCode, 401);
  assert.equal(h.reads, 0);
  const res = await harness({ failure: Object.assign(new Error('Session not found'), { status: 404 }) }).status();
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, 'Session not found');
});
