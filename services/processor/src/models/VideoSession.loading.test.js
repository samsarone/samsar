import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import VideoSession from '../schema/VideoSession.js';
import FrameGeneration from '../schema/FrameGeneration.js';
import UserVideoUploadTask from '../schema/UserVideoUploadTask.js';
import GeneratedAIVideo from '../schema/generations/GeneratedAIVideo.js';
import { getSessionDetails } from './VideoSession.js';

function query(value) {
  return { select() { return this; }, sort() { return this; }, async lean() { return value; } };
}
function setup(t, { pending = false, authorized = true } = {}) {
  t.mock.method(mongoose, 'connect', async () => mongoose);
  const session = {
    _id: 'project', userId: 'owner', aspectRatio: '9:16', videoLink: 'https://media.example/final.mp4',
    expressGenerationImageModel: 'SEEDREAM', expressGenerationInferenceModel: 'claude-fable-5.1',
    isExpressGeneration: true, frameGenerationPending: pending,
    layers: [{ _id: 'scene', frameGenerationPending: pending,
      imageSession: { activeGeneratedImage: 'https://media.example/image.png', activeItemList: [] } }],
    audioLayers: [],
  };
  let projection;
  t.mock.method(VideoSession, 'findById', () => ({
    select(fields) { projection = fields; return Promise.resolve(session); },
  }));
  const frames = t.mock.method(FrameGeneration, 'find', () => query([{ layerId: 'scene' }]));
  const uploads = t.mock.method(UserVideoUploadTask, 'find', () => query([
    { layerId: 'scene', status: 'UPLOADING', uploadedBytes: 2, totalFileSize: 4 },
  ]));
  const generated = t.mock.method(GeneratedAIVideo, 'find', () => query([]));
  return { session, frames, uploads, generated, projection: () => projection, userId: authorized ? 'owner' : 'stranger' };
}

test('initial details exclude frames at the database and preserve editing/model/media fields', async (t) => {
  const fixture = setup(t);
  const result = await getSessionDetails({ userId: fixture.userId, id: 'project' });
  assert.equal(fixture.projection(), '-layers.frames');
  assert.equal(fixture.frames.mock.callCount(), 0);
  assert.equal(fixture.uploads.mock.callCount(), 1);
  assert.equal(fixture.generated.mock.callCount(), 0);
  assert.equal(result.isSessionOwner, true);
  assert.equal(result.expressGenerationImageModel, 'SEEDREAM');
  assert.equal(result.expressGenerationInferenceModel, 'claude-fable-5.1');
  assert.equal(result.layers[0].imageSession.activeItemList[0].type, 'image');
  assert.equal(result.layers[0].userVideoUploadTask.progressPercent, 50);
  assert.deepEqual(fixture.session.layers[0].imageSession.activeItemList, []);
});
test('pending-frame reconciliation is retained', async (t) => {
  const fixture = setup(t, { pending: true });
  const result = await getSessionDetails({ userId: fixture.userId, id: 'project' });
  assert.equal(fixture.frames.mock.callCount(), 1);
  assert.equal(result.frameGenerationPending, true);
  assert.equal(result.layers[0].frameGenerationPending, true);
});
test('inaccessible sessions do not query related collections', async (t) => {
  const fixture = setup(t, { authorized: false });
  await assert.rejects(getSessionDetails({ userId: fixture.userId, id: 'project' }), { statusCode: 404 });
  assert.equal(fixture.frames.mock.callCount() + fixture.uploads.mock.callCount() + fixture.generated.mock.callCount(), 0);
});

test('details retain editable-share access and remove owner-only share metadata', async (t) => {
  const fixture = setup(t);
  Object.assign(fixture.session, { editableShareEnabled: true, editableShareToken: 'a'.repeat(48),
    editableShareImportedUserIds: ['collaborator'], shareToken: 'owner-only-token' });
  for (const [userId, extra] of [['collaborator', {}], ['invitee', { editableShareToken: 'a'.repeat(48) }]]) {
    const result = await getSessionDetails({ userId, id: 'project', ...extra });
    assert.equal(result.isSessionOwner, false);
    assert.equal(result.isImportedSession, true);
    assert.equal(result.shareToken, undefined);
    assert.equal(result.editableShareToken, undefined);
    assert.equal(result.layers[0].imageSession.activeItemList[0].type, 'image');
  }
});
test('stale pending-frame flags still clear when no queued frame task exists', async (t) => {
  const fixture = setup(t, { pending: true });
  fixture.frames.mock.mockImplementation(() => query([]));
  const result = await getSessionDetails({ userId: fixture.userId, id: 'project' });
  assert.equal(result.frameGenerationPending, false);
  assert.equal(result.layers[0].frameGenerationPending, false);
});
