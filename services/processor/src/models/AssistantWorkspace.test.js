import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('./AssistantWorkspace.js', import.meta.url), 'utf8')
  .replace(/^import\s[\s\S]*?;[^\n]*$/gm, '').replace(/export /g, '');
function harness() {
  const rows = new Map();
  const context = vm.createContext({ createHash, getDBConnectionString: async () => {},
    AssistantWorkspace: {
      updateOne: async (filter, update) => { if (!rows.has(filter._id)) rows.set(filter._id, { _id: filter._id, ...update.$setOnInsert }); },
      findOne: async filter => { const row = rows.get(filter._id); return row?.userId === filter.userId && row?.workspace === filter.workspace ? row : null; },
    },
  });
  vm.runInContext(source, context);
  return { rows, context };
}
test('audio conversations are owner-scoped and concurrent opens reuse one record', async () => {
  const { rows, context } = harness();
  const [first, second] = await Promise.all([context.openAssistantWorkspace('owner', { workspace: 'audio' }), context.openAssistantWorkspace('owner', { workspace: 'audio' })]);
  assert.equal(first.id, second.id); assert.equal(rows.size, 1);
  await assert.rejects(context.assertAssistantWorkspaceAccess('other', { id: first.id, workspace: 'audio' }), { status: 404 });
  const other = await context.openAssistantWorkspace('other', { workspace: 'audio' });
  assert.notEqual(first.id, other.id);
});
test('workspace API rejects arbitrary stores and IDs before touching conversation data', async () => {
  const { rows, context } = harness();
  await assert.rejects(context.openAssistantWorkspace('owner', { workspace: 'video' }), { status: 400 });
  await assert.rejects(context.assertAssistantWorkspaceAccess('owner', { id: '../secret', workspace: 'audio' }), { status: 400 });
  assert.equal(rows.size, 0);
});
