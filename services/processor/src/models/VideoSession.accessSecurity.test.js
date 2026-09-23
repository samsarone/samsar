import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import VideoSession from '../schema/VideoSession.js';
import Session from '../schema/Session.js';
import {
  getFrameForSession, addAudioToSession,
  getVideoSessionGenerationStatus, getVideoSessionEditStatus,
  getVideoSessionMaskGenerationStatus, requestGenerateMask,
} from './VideoSession.js';

function fixture(t, overrides = {}) {
  t.mock.method(mongoose, 'connect', async () => mongoose);
  const session = {
    _id: 'project', userId: 'owner', generations: [],
    editableShareEnabled: true, editableShareToken: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    editableShareImportedUserIds: ['collaborator'],
    layers: [{ _id: 'layer', imageSession: { _id: 'image', activeItemList: [], generationStatus: 'COMPLETED', editStatus: 'COMPLETED' } }],
    async populate() { return this; }, async save() { return this; },
    ...overrides,
  };
  t.mock.method(VideoSession, 'findById', async (id) => id === 'project' ? session : null);
  t.mock.method(Session, 'findOne', () => { throw new Error('Unexpected unrelated image lookup'); });
  return session;
}

test('status polling permits owners, imported collaborators, and valid editable shares', async (t) => {
  fixture(t);
  for (const [userId, extras] of [['owner', {}], ['collaborator', {}], ['invitee', { editableShareToken: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }]]) {
    for (const read of [getVideoSessionGenerationStatus, getVideoSessionEditStatus]) {
      const result = await read(userId, { id: 'project', layerId: 'layer', ...extras });
      assert.equal(result.status, 'COMPLETED');
      assert.equal(result.layer._id, 'layer');
    }
  }
});

test('private status and audio mutations reject strangers, anonymous callers, and revoked shares', async (t) => {
  fixture(t, { editableShareEnabled: false });
  for (const userId of ['stranger', undefined, 'collaborator']) {
    for (const operation of [getVideoSessionGenerationStatus, getVideoSessionEditStatus, getVideoSessionMaskGenerationStatus, requestGenerateMask, addAudioToSession]) {
      await assert.rejects(operation(userId, {
        id: 'project', sessionId: 'project', layerId: 'layer', editableShareToken: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        dataURL: 'data:audio/mp3;base64,YXVkaW8=',
      }), (error) => error.statusCode === 404);
    }
  }
});

test('frame reads bind image and layer identifiers to the authorized parent', async (t) => {
  const session = fixture(t);
  for (const layer of ['layer', 'image']) {
    assert.equal(await getFrameForSession({ userId: 'owner', id: 'project', layer }), session.layers[0].imageSession);
  }
  for (const payload of [
    { userId: 'owner', id: 'project', layer: 'another-project-image' },
    { userId: 'owner', id: 'another-project', layer: 'image' },
    { userId: 'stranger', id: 'project', layer: 'image' },
  ]) await assert.rejects(getFrameForSession(payload), (error) => error.statusCode === 404);
});

test('legacy referenced frames remain readable after parent access is checked', async (t) => {
  fixture(t, { layers: [{ _id: 'layer', imageSession: 'legacy-image' }] });
  t.mock.method(Session, 'findOne', async (filter) => {
    assert.equal(filter._id, 'legacy-image');
    return { activeItemList: [] };
  });
  assert.deepEqual(await getFrameForSession({ userId: 'owner', id: 'project', layer: 'legacy-image' }), { activeItemList: [] });
});

test('authorized audio upload retains the mounted assets path and contents', async (t) => {
  const session = fixture(t);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-audio-access-'));
  const previousRoot = process.env.SAMSAR_ASSETS_V2_ROOT;
  process.env.SAMSAR_ASSETS_V2_ROOT = root;
  t.after(() => {
    if (previousRoot === undefined) delete process.env.SAMSAR_ASSETS_V2_ROOT;
    else process.env.SAMSAR_ASSETS_V2_ROOT = previousRoot;
    fs.rmSync(root, { recursive: true, force: true });
  });
  await addAudioToSession('collaborator', { id: 'project', dataURL: 'data:audio/mp3;base64,YXVkaW8=' });
  assert.equal(session.audio, 'assets_v2/video/audio/project/audio_project.mp3');
  assert.equal(fs.readFileSync(path.join(root, 'video/audio/project/audio_project.mp3'), 'utf8'), 'audio');
});
