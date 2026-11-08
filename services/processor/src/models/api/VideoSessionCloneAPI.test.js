import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import mongoose from 'mongoose';

import {
  __testOnly__,
  cloneVideoSessionAndQueueRender,
  cloneVideoSessionAndRegenerateNarratorAvatar,
  copyVideoSession,
} from './VideoSessionCloneAPI.js';
import { captureSessionSceneReferences } from '../video/SceneIdentity.js';
import { createNewBlankQuickSession } from '../QuickSession.js';
import VideoSession from '../../schema/VideoSession.js';
import User from '../../schema/User.js';
import GlobalSession from '../../schema/GlobalSession.js';
import AudioGeneration from '../../schema/AudioGeneration.js';
import AIVideoLayerGeneration from '../../schema/AIVideoLayerGeneration.js';
import ImageGeneration from '../../schema/ImageGeneration.js';

test('P2P cloning rewrites render asset paths while preserving captured original scene provenance', () => {
  const sourceSessionId = 'source-session';
  const clonedSession = {
    _id: sourceSessionId,
    movieResourceList: { scenes: [{ visual: 'A harbor', duration: 2 }], sounds: [] },
    layers: [{ _id: 'layer-1', originalImageGenerationPrompt: 'A harbor', duration: 2,
      aiVideoLayer: `assets_v2/ai_video/generations/${sourceSessionId}/layer-1/video.mp4`, imageSession: {} }],
  };
  captureSessionSceneReferences(clonedSession);
  __testOnly__.rewriteSessionAssetReferences(clonedSession, sourceSessionId, 'copy-session');
  assert.equal(clonedSession.layers[0].aiVideoLayer, 'assets_v2/ai_video/generations/copy-session/layer-1/video.mp4');
  assert.equal(clonedSession.layers[0].sourceSceneRef.sourceSessionId, sourceSessionId);
  assert.equal(clonedSession.layers[0].imageSession.sourceSceneRef.scene.visual, 'A harbor');
  assert.equal(clonedSession.layers[0].duration, 2);
});

test('regenerate avatar can build narrator image input for sessions without prior avatar config', () => {
  const result = __testOnly__.resolveNarratorAvatarImageGenerationInput({
    originalSessionData: {
      addNarratorAvatar: false,
      add_narrator_avatar: false,
      inputPrompt: 'Create a product launch video for a premium desk lamp.',
      parentJsonTheme: '{"tone":"warm and credible"}',
      languageString: 'English',
      movieResourceList: {
        narrator: {
          actor: 'Ari',
          gender: 'M',
          Identity: 'confident product reviewer',
        },
        scenes: [
          { type: 'narration', speaker: 'Ari' },
        ],
        sounds: [
          {
            type: 'speech',
            subType: 'narration',
            actor: 'Ari',
            gender: 'M',
            Identity: 'confident product reviewer',
          },
        ],
      },
      imageDescriptionList: ['lamp on desk', 'close-up of controls'],
    },
  });

  assert.equal(result.narratorGender, 'M');
  assert.match(result.prompt, /Create a single human narrator avatar reference image/i);
  assert.match(result.prompt, /Narrator avatar gender: M \(male\)/i);
  assert.match(result.prompt, /Narrator name\/actor: Ari/i);
});

test('copy session assets preserves legacy and v2 frame roots', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'samsar-clone-assets-'));
  const oldSessionId = 'source-session';
  const newSessionId = 'cloned-session';
  const legacyRoot = path.join(tmpDir, 'assets');
  const v2Root = path.join(tmpDir, 'assets_v2');

  await fs.promises.mkdir(path.join(legacyRoot, 'video', 'frames', oldSessionId, 'legacy-layer'), { recursive: true });
  await fs.promises.writeFile(
    path.join(legacyRoot, 'video', 'frames', oldSessionId, 'legacy-layer', '0.png'),
    'legacy-frame',
  );
  await fs.promises.mkdir(path.join(v2Root, 'video', 'frames', oldSessionId, 'v2-layer'), { recursive: true });
  await fs.promises.writeFile(
    path.join(v2Root, 'video', 'frames', oldSessionId, 'v2-layer', '0.png'),
    'v2-frame',
  );
  for (const prefix of ['ai_video/frames', 'global_videos/frames', 'video/narrator_avatar/frames']) {
    const folder = path.join(v2Root, prefix, oldSessionId, 'layer-1');
    await fs.promises.mkdir(folder, { recursive: true });
    await fs.promises.writeFile(path.join(folder, '0.png'), prefix);
  }
  await fs.promises.mkdir(path.join(v2Root, 'ai_video', 'generations', oldSessionId, 'layer-1'), { recursive: true });
  await fs.promises.writeFile(
    path.join(v2Root, 'ai_video', 'generations', oldSessionId, 'layer-1', 'video.mp4'),
    'ai-video',
  );

  await __testOnly__.copySessionAssetDirectories({
    assetsRoots: [legacyRoot, v2Root],
    oldSessionId,
    newSessionId,
  });

  assert.equal(
    await fs.promises.readFile(path.join(legacyRoot, 'video', 'frames', newSessionId, 'legacy-layer', '0.png'), 'utf8'),
    'legacy-frame',
  );
  assert.equal(
    await fs.promises.readFile(path.join(v2Root, 'video', 'frames', newSessionId, 'v2-layer', '0.png'), 'utf8'),
    'v2-frame',
  );
  for (const prefix of ['ai_video/frames', 'global_videos/frames', 'video/narrator_avatar/frames']) {
    assert.equal(await fs.promises.readFile(path.join(v2Root, prefix, newSessionId, 'layer-1', '0.png'), 'utf8'), prefix);
  }
  assert.equal(
    await fs.promises.readFile(path.join(v2Root, 'ai_video', 'generations', newSessionId, 'layer-1', 'video.mp4'), 'utf8'),
    'ai-video',
  );

  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

test('copy session referenced assets clones exact v2 resources and user resource aliases', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'samsar-clone-referenced-assets-'));
  const oldSessionId = 'source-session';
  const newSessionId = 'cloned-session';
  const userId = 'user-1';
  const v2Root = path.join(tmpDir, 'assets_v2');

  await fs.promises.mkdir(path.join(v2Root, 'ai_video', 'generations', oldSessionId, 'layer-1'), { recursive: true });
  await fs.promises.writeFile(
    path.join(v2Root, 'ai_video', 'generations', oldSessionId, 'layer-1', 'video.mp4'),
    'ai-video',
  );
  await fs.promises.mkdir(path.join(v2Root, 'generations', oldSessionId), { recursive: true });
  await fs.promises.writeFile(
    path.join(v2Root, 'generations', oldSessionId, 'image.png'),
    'image',
  );
  const joinedFrames = path.join(v2Root, 'video', 'narrator_avatar', 'joined_frames', oldSessionId);
  await fs.promises.mkdir(joinedFrames, { recursive: true });
  await fs.promises.writeFile(path.join(joinedFrames, '0.png'), 'joined-avatar-frame');

  const sessionData = {
    avatarJoinedFrame: `assets_v2/video/narrator_avatar/joined_frames/${oldSessionId}/0.png`,
    layers: [
      {
        aiVideoLayer: `assets_v2/ai_video/generations/${oldSessionId}/layer-1/video.mp4`,
        aiVideoRemoteLink: `https://static.samsar.one/assets_v2/user_resources/${userId}/ai_videos/${oldSessionId}/layer-1/video.mp4?Expires=123`,
        imageSession: {
          activeGeneratedImage: `assets_v2/generations/${oldSessionId}/image.png`,
        },
      },
    ],
  };

  const result = await __testOnly__.copyReferencedSessionAssets({
    sessionData,
    assetsRoots: [v2Root],
    oldSessionId,
    newSessionId,
  });

  assert.equal(result.missingCritical.length, 0);
  assert.equal(
    await fs.promises.readFile(path.join(v2Root, 'ai_video', 'generations', newSessionId, 'layer-1', 'video.mp4'), 'utf8'),
    'ai-video',
  );
  assert.equal(
    await fs.promises.readFile(path.join(v2Root, 'generations', newSessionId, 'image.png'), 'utf8'),
    'image',
  );
  assert.equal(
    await fs.promises.readFile(path.join(v2Root, 'user_resources', userId, 'ai_videos', newSessionId, 'layer-1', 'video.mp4'), 'utf8'),
    'ai-video',
  );
  assert.equal(await fs.promises.readFile(path.join(v2Root, 'video', 'narrator_avatar', 'joined_frames', newSessionId, '0.png'), 'utf8'), 'joined-avatar-frame');

  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

test('copy session reference rewrite updates asset paths inside string arrays', () => {
  const sessionData = {
    layers: [
      {
        frames: [
          '/video/frames/source-session/layer-1/0.png',
          'assets_v2/video/frames/source-session/layer-1/1.png',
        ],
        aiVideoRemoteLink: 'https://static.samsar.one/assets_v2/user_resources/user-1/ai_videos/source-session/layer-1/video.mp4?Expires=123',
        imageSession: {
          generations: [
            'assets_v2/generations/source-session/image.png',
          ],
          activeItemList: [
            {
              src: 'assets_v2/video/outro/source-session/outro_tile_1.png',
            },
          ],
        },
      },
    ],
    unrelated: ['source-session should stay in ordinary text'],
  };

  __testOnly__.rewriteSessionAssetReferences(sessionData, 'source-session', 'cloned-session');

  assert.deepEqual(sessionData.layers[0].frames, [
    '/video/frames/cloned-session/layer-1/0.png',
    'assets_v2/video/frames/cloned-session/layer-1/1.png',
  ]);
  assert.deepEqual(sessionData.layers[0].imageSession.generations, [
    'assets_v2/generations/cloned-session/image.png',
  ]);
  assert.equal(
    sessionData.layers[0].aiVideoRemoteLink,
    'https://static.samsar.one/assets_v2/user_resources/user-1/ai_videos/cloned-session/layer-1/video.mp4',
  );
  assert.equal(
    sessionData.layers[0].imageSession.activeItemList[0].src,
    'assets_v2/video/outro/cloned-session/outro_tile_1.png',
  );
  assert.deepEqual(sessionData.unrelated, ['source-session should stay in ordinary text']);
});

test('copy session reference rewrite strips stale CloudFront signatures after path rewrite', () => {
  const sessionData = {
    outroImageMetadata: {
      ctaImageUrl: 'https://static.samsar.one/assets_v2/video/outro/source-session/outro_cta_image.png?Expires=123&Signature=oldsig&Key-Pair-Id=KOLD',
    },
    layers: [
      {
        imageSession: {
          activeItemList: [
            {
              src: 'https://static.samsar.one/assets_v2/video/outro/source-session/outro_tile_1.png?Expires=123&Signature=oldsig&Key-Pair-Id=KOLD',
            },
          ],
        },
      },
    ],
  };

  __testOnly__.rewriteSessionAssetReferences(sessionData, 'source-session', 'cloned-session');

  assert.equal(
    sessionData.outroImageMetadata.ctaImageUrl,
    'https://static.samsar.one/assets_v2/video/outro/cloned-session/outro_cta_image.png',
  );
  assert.equal(
    sessionData.layers[0].imageSession.activeItemList[0].src,
    'https://static.samsar.one/assets_v2/video/outro/cloned-session/outro_tile_1.png',
  );
});

test('blank quick sessions retain defaults while clone initial state cannot override owner or frame rate', async (t) => {
  const userId = '6b0000000000000000000001';
  const created = [];
  t.mock.method(User, 'findById', () => ({ select: () => ({ lean: async () => ({ videoFramesPerSecond: 24 }) }) }));
  t.mock.method(VideoSession, 'create', async (initialState) => {
    const document = new VideoSession(initialState);
    created.push(document);
    return document;
  });

  await createNewBlankQuickSession(userId);
  await createNewBlankQuickSession(userId, {
    expressGenerationPending: false,
    userId: '6b0000000000000000000002',
    framesPerSecond: 16,
  });

  assert.equal(created[0].expressGenerationPending, true);
  assert.equal(created[1].expressGenerationPending, false);
  assert.equal(String(created[1].userId), userId);
  assert.equal(created[1].framesPerSecond, 24);
});

async function mockClonePublication(t, { shared = false } = {}) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'samsar-clone-publication-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const assetsRoot = path.join(root, 'assets_v2');
  const sourceSessionId = '6b0000000000000000000011';
  const newSessionId = '6b0000000000000000000012';
  const sourceOwner = '6b0000000000000000000013';
  const userId = shared ? '6b0000000000000000000014' : sourceOwner;
  const layerId = '6b0000000000000000000015';
  const sourcePath = `ai_video/generations/${sourceSessionId}/${layerId}/video.mp4`;
  await fs.promises.mkdir(path.dirname(path.join(assetsRoot, sourcePath)), { recursive: true });
  await fs.promises.writeFile(path.join(assetsRoot, sourcePath), 'reusable-ai-video');
  const framePath = `video/frames/${sourceSessionId}/${layerId}/0.png`;
  await fs.promises.mkdir(path.dirname(path.join(assetsRoot, framePath)), { recursive: true });
  await fs.promises.writeFile(path.join(assetsRoot, framePath), 'ordinary-clone-frame');
  const source = {
    _id: sourceSessionId,
    userId: sourceOwner,
    isExpressGeneration: true,
    hostedAgentBilling: { version: 2, state: 'COMPLETED', revision: 4, netFunded: 120 },
    sessionReceipt: { totalCharged: 120, refunded: 50 },
    expressGenerationCreditCharges: { totalCharged: 120, stages: { pipeline: { status: 'CHARGED' } } },
    postProcessingBilling: { version: 1, sessionId: sourceSessionId, creditsCharged: 75 },
    legacyProvisionalRefund: { sessionId: sourceSessionId, amount: 500 },
    finalVideoDurationSeconds: 2,
    expressGenerationPending: false,
    videoLink: `/assets_v2/video/output/${sourceSessionId}/final.mp4`,
    narratorAvatarImagePrompt: 'A narrator presenting the source story.',
    totalDuration: 2,
    layers: [{
      _id: layerId,
      duration: 2,
      durationOffset: 0,
      layerAiVideoType: 'character',
      hasAiVideoLayer: true,
      aiVideoLayer: `assets_v2/${sourcePath}`,
      aiVideoRemoteLink: `https://static.example.com/assets_v2/user_resources/${sourceOwner}/ai_videos/${sourceSessionId}/${layerId}/video.mp4`,
      aiVideoGenerationStatus: 'COMPLETED',
      frames: [`assets_v2/${framePath}`],
      imageSession: { activeItemList: [] },
    }],
    audioLayers: [],
  };
  const events = [];
  const placeholders = [];
  let savedSession;
  const destination = { _id: newSessionId, userId };
  t.mock.method(mongoose, 'connect', async () => mongoose);
  t.mock.method(User, 'findById', () => ({ select: () => ({ lean: async () => ({ videoFramesPerSecond: 30 }) }) }));
  t.mock.method(VideoSession, 'findOne', async (query) => {
    if (shared) {
      assert.deepEqual(query, { shareToken: 'shared-source', shareEnabled: true });
    } else {
      assert.deepEqual(query, { _id: sourceSessionId, userId });
    }
    return { _id: sourceSessionId, toObject: () => structuredClone(source) };
  });
  t.mock.method(VideoSession, 'create', async (initialState) => {
    const placeholder = new VideoSession(initialState);
    assert.equal(placeholder.expressGenerationPending, false, 'placeholder must be inactive from its first insert');
    placeholders.push(placeholder);
    events.push('placeholder');
    return { _id: newSessionId };
  });
  const saves = t.mock.method(VideoSession, 'updateOne', async (_query, update) => {
    if (update.$set?.postProcessingBilling) { Object.assign(destination, structuredClone(update.$set)); return { matchedCount: 1 }; }
    events.push('activate');
    savedSession = structuredClone(update.$set);
    return { matchedCount: 1 };
  });
  t.mock.method(VideoSession, 'findById', async () => ({ ...destination, ...savedSession }));
  const mappings = t.mock.method(GlobalSession, 'findOneAndUpdate', async () => { events.push('mapping'); });
  const audioJobs = t.mock.method(AudioGeneration.prototype, 'save', async () => assert.fail('A clone must reuse audio'));
  const aiJobs = t.mock.method(AIVideoLayerGeneration.prototype, 'save', async () => assert.fail('A clone must reuse base AI video'));
  const imageJobs = t.mock.method(ImageGeneration.prototype, 'save', async () => assert.fail('No image job before publication'));
  return {
    assetsRoot, sourceSessionId, newSessionId, sourceOwner, userId, layerId, source,
    events, placeholders, saves, mappings, audioJobs, aiJobs, imageJobs,
    payload: shared ? { shareToken: 'shared-source' } : { session_id: sourceSessionId },
    dependencies: { resolveAssetsRoots: () => [assetsRoot] },
    savedSession: () => savedSession,
  };
}

for (const [label, clone] of [
  ['render clone', cloneVideoSessionAndQueueRender],
  ['narrator-avatar clone', cloneVideoSessionAndRegenerateNarratorAvatar],
  ['Studio copy', copyVideoSession],
]) {
  test(`${label} stays inactive and queues nothing when copied media publication fails`, async (t) => {
    const fixture = await mockClonePublication(t);
    const before = structuredClone(fixture.source);
    let publicationAttempts = 0;
    await assert.rejects(clone(fixture.userId, fixture.payload, {
      ...fixture.dependencies,
      publishFile: async ({ filePath }) => {
        publicationAttempts += 1;
        assert.equal(await fs.promises.readFile(filePath, 'utf8'), 'reusable-ai-video');
        throw new Error('CDN cache prime returned status 403');
      },
    }), /CDN cache prime returned status 403/);

    assert.equal(publicationAttempts, 1);
    assert.equal(fixture.placeholders.length, 1);
    assert.equal(fixture.saves.mock.calls.filter(call => !call.arguments[1].$set?.postProcessingBilling).length, 0);
    assert.equal(fixture.mappings.mock.callCount(), 0);
    assert.equal(fixture.audioJobs.mock.callCount(), 0);
    assert.equal(fixture.aiJobs.mock.callCount(), 0);
    assert.equal(fixture.imageJobs.mock.callCount(), 0);
    assert.deepEqual(fixture.source, before);
  });
}

for (const shared of [false, true]) {
  test(`${shared ? 'shared Studio copy' : 'render clone'} publishes reused AI media for the destination owner before saving`, async (t) => {
    const fixture = await mockClonePublication(t, { shared });
    const before = structuredClone(fixture.source);
    const publishedObjects = new Map();
    const clone = shared ? copyVideoSession : cloneVideoSessionAndQueueRender;
    const result = await clone(fixture.userId, fixture.payload, {
      ...fixture.dependencies,
      publishFile: async ({ filePath, key, contentType }) => {
        assert.equal(fixture.saves.mock.calls.filter(call => !call.arguments[1].$set?.postProcessingBilling).length, 0);
        assert.equal(fixture.mappings.mock.callCount(), 0);
        assert.equal(fixture.placeholders[0].expressGenerationPending, false);
        assert.equal(contentType, 'video/mp4');
        assert.equal(key, `user_resources/${fixture.userId}/ai_videos/${fixture.newSessionId}/${fixture.layerId}/video.mp4`);
        const secureKey = `assets_v2/${key}`;
        publishedObjects.set(secureKey, await fs.promises.readFile(filePath, 'utf8'));
        fixture.events.push('publish');
        return `https://static.example.com/${secureKey}`;
      },
    });

    const saved = fixture.savedSession();
    assert.equal(saved.hostedAgentBilling, undefined);
    assert.equal(saved.sessionReceipt, undefined);
    assert.equal(saved.expressGenerationCreditCharges, undefined);
    assert.equal(saved.postProcessingBilling, undefined, 'copy writes cannot overwrite destination admission');
    assert.equal(saved.legacyProvisionalRefund, undefined);
    assert.equal(saved.finalVideoDurationSeconds, undefined);
    const selectedKey = new URL(saved.layers[0].aiVideoRemoteLink).pathname.slice(1);
    assert.equal(publishedObjects.get(selectedKey), 'reusable-ai-video');
    assert.equal(saved.userId, fixture.userId);
    assert.equal(saved.layers[0].hasAiVideoLayer, true);
    assert.equal(saved.layers[0].aiVideoGenerationPending, false);
    assert.equal(saved.expressGenerationPending, !shared);
    assert.deepEqual(fixture.events.slice(0, 3), ['placeholder', 'publish', 'activate']);
    assert.equal(fixture.audioJobs.mock.callCount(), 0);
    assert.equal(fixture.aiJobs.mock.callCount(), 0);
    assert.equal(fixture.imageJobs.mock.callCount(), 0);
    assert.equal(await fs.promises.readFile(path.join(fixture.assetsRoot, 'video/frames', fixture.newSessionId, fixture.layerId, '0.png'), 'utf8'), 'ordinary-clone-frame');
    assert.deepEqual(fixture.source, before);
    assert.equal(result.session_id, fixture.newSessionId);
  });
}
