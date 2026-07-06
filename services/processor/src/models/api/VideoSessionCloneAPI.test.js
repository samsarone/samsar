import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { __testOnly__ } from './VideoSessionCloneAPI.js';

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

  const sessionData = {
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
