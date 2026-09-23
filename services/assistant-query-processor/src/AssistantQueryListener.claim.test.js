import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./AssistantQueryListener.js', import.meta.url), 'utf8')
  .replace(/^import\s[\s\S]*?;[^\n]*$/gm, '').replace(/export /g, '');

test('two assistant workers seeing the same pending job invoke the provider only once', async () => {
  let locked = false;
  let providerCalls = 0;
  let saves = 0;
  const job = { _id: 'job', sessionId: 'session', queryId: 'query', rowLocked: false };
  const session = { userId: 'user', sessionMessages: [{ role: 'user', id: 'query', content: 'Hello' }], async save() { saves += 1; } };
  const context = vm.createContext({
    AssistantQueryGeneration: {
      find: async () => [job],
      updateOne: async (filter, update) => {
        assert.equal(filter.rowLocked, false);
        assert.equal(update.$set.rowLocked, true);
        if (locked) return { modifiedCount: 0 };
        locked = true;
        return { modifiedCount: 1 };
      },
      findOne: async () => job, deleteOne: async () => {},
    },
    VideoSession: { findOne: async () => session },
    User: { findOne: async () => ({}) },
    sendAssistantCompletionRequest: async () => { providerCalls += 1; return { outputText: 'Hi' }; },
    getSystemPrompt: () => ({ role: 'system', content: 'System' }),
    isStandaloneEdition: () => true,
    isGeminiInferenceModel: () => false, isKimiK3InferenceModel: () => false,
    normalizeInferenceModel: () => 'model', console,
  });
  const processPending = vm.runInContext(`${source}\n;processPendingAssistantRequests;`, context);
  await Promise.all([processPending(), processPending()]);
  assert.equal(providerCalls, 1);
  assert.equal(saves, 1);
  assert.equal(session.sessionMessages.filter((message) => message.role === 'assistant').length, 1);
});
