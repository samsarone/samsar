import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { publishClonedAiVideoMedia } from './ClonedAiVideoMedia.js';

const sessionId = 'new-session';
const userId = 'user-1';

async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'cloned-ai-media-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const legacy = path.join(temp, 'assets');
  const v2 = path.join(temp, 'assets_v2');
  await Promise.all([fs.mkdir(legacy), fs.mkdir(v2)]);
  async function clip(relative, bytes = 'COPIED AI VIDEO', root = v2) {
    const filename = path.join(root, relative);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, bytes);
    return filename;
  }
  return { temp, legacy, v2, clip, run: (clonedSession, publishFile, options = {}) => publishClonedAiVideoMedia({
    clonedSession, publishFile, newSessionId: sessionId, userId, assetsRoots: [legacy, v2], ...options,
  }) };
}

test('a copied clip is published under the current cloned layer before its remote reference changes', async (t) => {
  const f = await fixture(t);
  const source = await f.clip(`ai_video/generations/${sessionId}/old-layer/video.mp4`);
  const staleRemote = `https://cdn.example/assets_v2/user_resources/${userId}/ai_videos/${sessionId}/old-layer/video.mp4`;
  const layer = { _id: 'current-layer', hasAiVideoLayer: true,
    aiVideoLayer: `/assets_v2/ai_video/generations/${sessionId}/old-layer/video.mp4`,
    aiVideoRemoteLink: staleRemote };
  const remoteObjects = new Map([['source-session/video.mp4', 'ORIGINAL REMOTE']]);
  const expectedKey = `user_resources/${userId}/ai_videos/${sessionId}/current-layer/video.mp4`;
  let calls = 0;
  const result = await f.run({ layers: [layer] }, async ({ filePath, key, contentType }) => {
    calls++;
    assert.equal(filePath, await fs.realpath(source));
    assert.equal(key, expectedKey);
    assert.equal(contentType, 'video/mp4');
    assert.equal(layer.aiVideoRemoteLink, staleRemote);
    remoteObjects.set(key, await fs.readFile(filePath, 'utf8'));
    return `https://cdn.example/assets_v2/${key}?signed=fresh`;
  });
  assert.equal(calls, 1);
  assert.equal(remoteObjects.get(expectedKey), 'COPIED AI VIDEO');
  assert.equal(layer.aiVideoRemoteLink, `https://cdn.example/assets_v2/${expectedKey}?signed=fresh`);
  assert.equal(layer.aiVideoLayer, `/assets_v2/ai_video/generations/${sessionId}/old-layer/video.mp4`);
  assert.deepEqual(result, { publishedFiles: 1, updatedReferences: 1, deduplicatedReferences: 0 });
});

test('base/sound aliases and branch references publish each target key once', async (t) => {
  const f = await fixture(t);
  const local = `assets_v2/ai_video/generations/${sessionId}/old-layer/video.mp4`;
  await f.clip(local.slice('assets_v2/'.length));
  const layer = { _id: 'layer', aiVideoLayer: local, soundEffectVideoLayer: local };
  const branchLayer = { _id: 'layer', aiVideoLayer: local };
  const calls = [];
  const result = await f.run({ layers: [layer], branchRenderPaths: [{ timeline: [branchLayer] }] }, async ({ key }) => {
    calls.push(key);
    return `https://cdn.example/assets_v2/${key}`;
  });
  assert.equal(calls.length, 1);
  assert.equal(layer.aiVideoRemoteLink, layer.soundEffectRemoteLink);
  assert.equal(branchLayer.aiVideoRemoteLink, layer.aiVideoRemoteLink);
  assert.deepEqual(result, { publishedFiles: 1, updatedReferences: 3, deduplicatedReferences: 2 });
});

test('preserved lip-sync clips publish separately when a derivative shares the base filename', async (t) => {
  const f = await fixture(t);
  await f.clip(`ai_video/generations/${sessionId}/old-layer/video.mp4`, 'BASE');
  await f.clip(`video/lip_sync/${sessionId}/other-layer/video.mp4`, 'LIP SYNC');
  const layer = { _id: 'current-layer',
    aiVideoLayer: `assets_v2/ai_video/generations/${sessionId}/old-layer/video.mp4`,
    lipSyncVideoLayer: `assets_v2/video/lip_sync/${sessionId}/other-layer/video.mp4` };
  const objects = new Map();
  const result = await f.run({ layers: [layer] }, async ({ key, filePath }) => {
    objects.set(key, await fs.readFile(filePath, 'utf8'));
    return `https://cdn.example/assets_v2/${key}`;
  });
  assert.equal(result.publishedFiles, 2);
  assert.equal(objects.get(`user_resources/${userId}/ai_videos/${sessionId}/current-layer/video.mp4`), 'BASE');
  assert.equal(objects.get(`user_resources/${userId}/ai_videos/${sessionId}/current-layer/video__lip-sync.mp4`), 'LIP SYNC');
  assert.notEqual(layer.aiVideoRemoteLink, layer.lipSyncRemoteLink);
});

test('Docker-local publication uses the same new logical key and preserves copied clip bytes', async (t) => {
  const f = await fixture(t);
  await f.clip(`ai_video/generations/${sessionId}/old-layer/clip.webm`, 'LOCAL VIDEO');
  const layer = { _id: 'current-layer', aiVideoLayer: `assets/ai_video/generations/${sessionId}/old-layer/clip.webm` };
  await f.clip(`ai_video/generations/${sessionId}/old-layer/clip.webm`, 'LEGACY VIDEO', f.legacy);
  const result = await f.run({ layers: [layer] }, async ({ filePath, key, contentType }) => {
    assert.equal(contentType, 'video/webm');
    const target = path.join(f.v2, key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(filePath, target);
    return `http://processor:3002/assets_v2/${key}`;
  });
  assert.equal(result.publishedFiles, 1);
  assert.equal(await fs.readFile(path.join(f.v2, `user_resources/${userId}/ai_videos/${sessionId}/current-layer/clip.webm`), 'utf8'), 'LEGACY VIDEO');
  assert.equal(layer.aiVideoRemoteLink, `http://processor:3002/assets_v2/user_resources/${userId}/ai_videos/${sessionId}/current-layer/clip.webm`);
});

test('publication failure leaves all remote references unchanged and propagates to the caller', async (t) => {
  const f = await fixture(t);
  await f.clip(`ai_video/generations/${sessionId}/old-layer/base.mp4`);
  await f.clip(`video/lip_sync/${sessionId}/old-layer/lip.mp4`);
  const layer = { _id: 'layer', aiVideoLayer: `ai_video/generations/${sessionId}/old-layer/base.mp4`,
    aiVideoRemoteLink: 'https://cdn.example/stale-base', lipSyncVideoLayer: `video/lip_sync/${sessionId}/old-layer/lip.mp4`,
    lipSyncRemoteLink: 'https://cdn.example/stale-lip' };
  const session = { layers: [layer] };
  const before = structuredClone(session);
  let calls = 0;
  await assert.rejects(f.run(session, async ({ key }) => {
    if (++calls === 2) throw new Error('target object not readable');
    return `https://cdn.example/assets_v2/${key}`;
  }), /target object not readable/);
  assert.deepEqual(session, before);
});

test('missing copied media fails before any publication can occur', async (t) => {
  const f = await fixture(t);
  await f.clip(`ai_video/generations/${sessionId}/old-layer/present.mp4`);
  let published = 0;
  await assert.rejects(f.run({ layers: [
    { _id: 'first', aiVideoLayer: `ai_video/generations/${sessionId}/old-layer/present.mp4` },
    { _id: 'missing', aiVideoLayer: `ai_video/generations/${sessionId}/old-layer/missing.mp4` },
  ] }, async () => { published++; return 'https://cdn.example/video'; }), /Copied base video is missing/);
  assert.equal(published, 0);
});

test('remote-style local aliases can supply a missing conventional clip reference', async (t) => {
  const f = await fixture(t);
  const alias = `user_resources/${userId}/ai_videos/${sessionId}/old-layer/clip.mp4`;
  await f.clip(alias);
  const layer = { _id: 'current-layer', aiVideoRemoteLink: `https://cdn.example/assets_v2/${alias}?Expires=old` };
  const result = await f.run({ layers: [layer] }, async ({ filePath, key }) => {
    assert.equal(filePath, await fs.realpath(path.join(f.v2, alias)));
    return `https://cdn.example/assets_v2/${key}`;
  });
  assert.equal(result.publishedFiles, 1);
  assert.ok(layer.aiVideoRemoteLink.includes(`/${sessionId}/current-layer/clip.mp4`));
});

test('unrelated remote assets, regenerated lip sync, frames and final outputs are not republished', async (t) => {
  const f = await fixture(t);
  const session = { layers: [{ _id: 'layer', aiVideoLayer: 'https://independent.example/source.mp4',
    aiVideoRemoteLink: 'https://independent.example/source.mp4', lipSyncVideoLayer: null,
    lipSyncRemoteLink: null, frames: [`assets_v2/video/frames/${sessionId}/0.png`],
    imageSession: { activeGeneratedImage: `assets_v2/generations/${sessionId}/image.png` } }],
  videoLink: `assets_v2/video/output/${sessionId}/final.mp4`, audioLayers: [{ audioLink: 'music.mp3' }] };
  const before = structuredClone(session);
  const result = await f.run(session, () => { throw new Error('must not publish'); });
  assert.equal(result.publishedFiles, 0);
  assert.deepEqual(session, before);
});

test('unsafe, symlinked and empty copied files cannot be published', async (t) => {
  for (const kind of ['traversal', 'symlink', 'empty']) {
    const f = await fixture(t);
    const reference = `ai_video/generations/${sessionId}/old-layer/video.mp4`;
    if (kind === 'symlink') {
      const outside = await f.clip('unrelated/private.mp4', 'PRIVATE');
      const linked = path.join(f.v2, reference);
      await fs.mkdir(path.dirname(linked), { recursive: true });
      await fs.symlink(outside, linked);
    } else if (kind === 'empty') await f.clip(reference, '');
    const layer = { _id: 'layer', aiVideoLayer: kind === 'traversal'
      ? `assets_v2/ai_video/generations/${sessionId}/../private.mp4` : `assets_v2/${reference}` };
    await assert.rejects(f.run({ layers: [layer] }, () => { throw new Error('must not publish'); }),
      /unsafe asset path|symlink|empty video/);
  }
});

test('an invalid publication result never becomes the session remote URL', async (t) => {
  const f = await fixture(t);
  await f.clip(`ai_video/generations/${sessionId}/old-layer/video.mp4`);
  const layer = { _id: 'layer', aiVideoLayer: `assets_v2/ai_video/generations/${sessionId}/old-layer/video.mp4` };
  await assert.rejects(f.run({ layers: [layer] }, async () => ''), /did not return a media URL/);
  assert.equal(layer.aiVideoRemoteLink, undefined);
});
