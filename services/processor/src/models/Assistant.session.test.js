import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./Assistant.js', import.meta.url), 'utf8')
  .replace(/^import\s[\s\S]*?;[^\n]*$/gm, '').replace(/export /g, '');
const id = '123456789012345678901234';

function harness() {
  const session = { _id: id, userId: 'owner', layers: ['existing-layer'],
    sessionMessages: [{ id: 'old', role: 'user', content: 'private conversation' }],
    sessionMessageGenerationPending: true };
  const state = { jobs: [{ _id: 'legacy', sessionId: id, queryId: 'old' }], cleanedReceipts: 0 };
  const matchesVersion = (query) => query.$or
    ? !session.assistantSessionVersion
    : session.assistantSessionVersion === query.assistantSessionVersion;
  class Queue {
    constructor(data) { Object.assign(this, data); }
    async save() { if (state.jobs.some(job => job._id === this._id)) throw Object.assign(new Error('Duplicate'), { code: 11000 }); state.jobs.push({ ...this }); }
    static async deleteOne(query) { state.jobs = state.jobs.filter(job => job._id !== query._id); }
    static async deleteMany(query) {
      // Simulate a new request arriving just after the atomic reset.
      state.jobs.push({ _id: 'new-conversation', sessionId: id, assistantSessionVersion: session.assistantSessionVersion });
      state.jobs = state.jobs.filter(job => job.sessionId !== query.sessionId ||
        (job.assistantSessionVersion ?? 0) >= query.$or[0].assistantSessionVersion.$lt);
    }
  }
  const context = vm.createContext({
    createHash,
    getDBConnectionString: async () => {},
    assertVideoSessionEditableAccess: async (userId) => {
      if (userId !== 'owner') throw Object.assign(new Error('Not editable'), { status: 404 });
      return structuredClone(session);
    },
    VideoSession: {
      findOneAndUpdate: async (_query, update) => {
        Object.assign(session, update.$set);
        session.assistantSessionVersion = (session.assistantSessionVersion || 0) + update.$inc.assistantSessionVersion;
        return structuredClone(session);
      },
      updateOne: async (query, update) => {
        if (!matchesVersion(query) || (query.$nor && session.sessionMessages.some(message => message.id === query.$nor[0].sessionMessages.$elemMatch.id))) return { matchedCount: 0 };
        session.sessionMessages.push(update.$push.sessionMessages);
        Object.assign(session, update.$set);
        return { matchedCount: 1 };
      },
      findOne: async () => structuredClone(session),
      exists: async (query) => matchesVersion(query),
    },
    AssistantQueryGeneration: Queue,
    AssistantBillingRequest: { updateMany: async (query, update) => {
      assert.equal(query.scope, 'queued_assistant');
      assert.equal(query['context.sessionId'], id);
      assert.equal(query.status, 'COMPLETED');
      assert.ok('providerResponse' in update.$unset);
      state.cleanedReceipts++;
    } },
    User: { findOne: async () => ({ generationCredits: 10 }) },
    normalizeInferenceModel: () => 'gpt-6-astra', shouldBypassGenerationCredits: () => false,
    isSceneActionsCommand: () => false, hat: () => 'new-query', console,
  });
  vm.runInContext(source, context);
  return { session, state, context, clear: userId => context.resetAssistantSessionMessages(userId || 'owner', { id }),
    submit: () => context.createAssistantQueryRequest('owner', { id, query: 'Hello' }) };
}

test('clear deletes history and old jobs, preserves project data and concurrent new jobs', async () => {
  const h = harness();
  const result = await h.clear();
  assert.equal(result.sessionDetails.sessionMessages.length, 0);
  assert.equal(h.session.sessionMessageGenerationPending, false);
  assert.equal(h.session.sessionMessageGenerationError, null);
  assert.deepEqual(h.session.layers, ['existing-layer']);
  assert.equal(h.session.assistantSessionVersion, 1);
  assert.deepEqual(h.state.jobs.map(job => job._id), ['new-conversation']);
  assert.equal(h.state.cleanedReceipts, 1);
});

test('clear checks edit access before deleting any data', async () => {
  const h = harness();
  await assert.rejects(h.clear('other-user'), { status: 404 });
  assert.equal(h.session.sessionMessages.length, 1);
  assert.equal(h.state.jobs.length, 1);
  assert.equal(h.state.cleanedReceipts, 0);
});

test('subsequent requests use the new conversation and keep model settings', async () => {
  const h = harness();
  await h.clear();
  const request = await h.context.createAssistantQueryRequest('owner', {
    id, query: 'Start fresh', modelSettings: { reasoningEffort: 'xhigh' },
  });
  assert.equal(request.assistantSessionVersion, 1);
  assert.equal(request.modelSettings.reasoningEffort, 'xhigh');
  assert.equal(h.session.sessionMessages.length, 1);
  assert.equal(h.session.sessionMessages[0].content, 'Start fresh');
});

test('reset between access check and append rejects stale submission without restoring history', async () => {
  const h = harness();
  h.context.User.findOne = async () => { await h.clear(); return { generationCredits: 10 }; };
  await assert.rejects(h.submit(), { status: 409 });
  assert.equal(h.session.sessionMessages.length, 0);
  assert.equal(h.session.sessionMessageGenerationPending, false);
});

test('reset between message append and queue save removes the late queue row', async () => {
  const h = harness();
  const save = h.context.AssistantQueryGeneration.prototype.save;
  h.context.AssistantQueryGeneration.prototype.save = async function () {
    await h.clear();
    await save.call(this);
  };
  await h.submit();
  assert.equal(h.session.sessionMessages.length, 0);
  assert.ok(h.state.jobs.every(job => job.queryId !== 'new-query'));
});

test('an old browser submission arriving after clear is rejected before appending', async () => {
  const h = harness();
  await h.clear();
  await assert.rejects(h.context.createAssistantQueryRequest('owner', {
    id, query: 'Delayed old message', assistantSessionVersion: 0,
  }), { status: 409 });
  assert.equal(h.session.sessionMessages.length, 0);
});


test('replayed assistant submissions append and queue once; changed payloads conflict', async () => {
  const h = harness();
  const payload = { id, query: 'Hello', client_request_id: 'one-stream', stream: true };
  await h.context.createAssistantQueryRequest('owner', payload);
  await h.context.createAssistantQueryRequest('owner', payload);
  assert.equal(h.session.sessionMessages.filter(message => message.content === 'Hello').length, 1);
  assert.equal(h.state.jobs.filter(job => job.query === 'Hello').length, 1);
  await assert.rejects(h.context.createAssistantQueryRequest('owner', { ...payload, query: 'Changed' }), { status: 409 });
});


test('retry repairs an enqueue outage without appending or generating a duplicate query', async () => {
  const h = harness();
  const save = h.context.AssistantQueryGeneration.prototype.save;
  let fail = true;
  h.context.AssistantQueryGeneration.prototype.save = async function () {
    if (fail) { fail = false; throw new Error('Queue outage'); }
    return save.call(this);
  };
  const payload = { id, query: 'Recover me', client_request_id: 'same' };
  await assert.rejects(h.context.createAssistantQueryRequest('owner', payload), /Queue outage/);
  await h.context.createAssistantQueryRequest('owner', payload);
  assert.equal(h.session.sessionMessages.filter(message => message.content === 'Recover me').length, 1);
  assert.equal(h.state.jobs.filter(job => job.query === 'Recover me').length, 1);
});


test('stream snapshots enforce edit access and omit large image bytes and private queue metadata', async () => {
  const h = harness();
  h.session.sessionMessages = [{ role: 'user', id: 'q', content: [{ type: 'input_text', text: 'Review' }, { type: 'input_image', image_url: 'data:image/png;base64,private' }], assistantRequest: { modelSettings: {} } }];
  await assert.rejects(h.context.getAssistantStreamSnapshot('stranger', { id }), { status: 404 });
  await assert.rejects(h.context.getAssistantStreamSnapshot('owner', { id: 'invalid' }), { status: 400 });
  const snapshot = await h.context.getAssistantStreamSnapshot('owner', { id });
  assert.equal(snapshot.sessionMessages[0].content[0].text, 'Review');
  assert.equal(snapshot.sessionMessages[0].content[1].type, 'input_image');
  assert.equal(snapshot.sessionMessages[0].content[1].image_url, undefined);
  assert.equal(snapshot.sessionMessages[0].assistantRequest, undefined);
  assert.match(h.session.sessionMessages[0].content[1].image_url, /private/);
});
