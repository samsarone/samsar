import { createHash } from 'node:crypto';
import AssistantWorkspace from '../schema/AssistantWorkspace.js';
import { getDBConnectionString } from './DBString.js';

export async function openAssistantWorkspace(userId, payload = {}) {
  if (!userId || payload.workspace !== 'audio') throw Object.assign(new Error('Invalid assistant workspace.'), { status: 400 });
  await getDBConnectionString();
  // Deterministic ID and atomic upsert make concurrent tabs reuse one owner-scoped conversation.
  const id = createHash('sha256').update(`assistant-workspace:audio:${userId}`).digest('hex').slice(0, 24);
  try {
    await AssistantWorkspace.updateOne({ _id: id, userId: String(userId), workspace: 'audio' }, {
      $setOnInsert: { userId: String(userId), workspace: 'audio', sessionMessages: [], assistantSessionVersion: 0 },
    }, { upsert: true });
  } catch (error) { if (error.code !== 11000) throw error; }
  const session = await assertAssistantWorkspaceAccess(userId, { id, workspace: 'audio' });
  return { id: String(session._id), assistantSessionVersion: session.assistantSessionVersion || 0 };
}

export async function assertAssistantWorkspaceAccess(userId, payload) {
  if (payload.workspace !== 'audio' || !/^[a-f0-9]{24}$/i.test(payload.id || '')) throw Object.assign(new Error('Invalid assistant workspace.'), { status: 400 });
  await getDBConnectionString();
  const session = await AssistantWorkspace.findOne({ _id: payload.id, userId: String(userId), workspace: 'audio' });
  if (!session) throw Object.assign(new Error('Assistant conversation not found.'), { status: 404 });
  return session;
}
