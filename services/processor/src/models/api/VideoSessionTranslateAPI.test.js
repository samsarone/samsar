import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { __testOnly__ } from './VideoSessionTranslateAPI.js';

test('translate video deep-clones referenced assets_v2 render resources', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'samsar-translate-assets-'));
  const oldSessionId = 'source-session';
  const newSessionId = 'translated-session';
  const userId = 'user-1';
  const v2Root = path.join(tmpDir, 'assets_v2');

  await fs.promises.mkdir(path.join(v2Root, 'ai_video', 'generations', oldSessionId, 'layer-1'), { recursive: true });
  await fs.promises.writeFile(
    path.join(v2Root, 'ai_video', 'generations', oldSessionId, 'layer-1', 'video.mp4'),
    'ai-video',
  );
  await fs.promises.mkdir(path.join(v2Root, 'video', 'frames', oldSessionId, 'layer-1'), { recursive: true });
  await fs.promises.writeFile(
    path.join(v2Root, 'video', 'frames', oldSessionId, 'layer-1', '0.png'),
    'frame',
  );
  await fs.promises.mkdir(path.join(v2Root, 'generations', oldSessionId), { recursive: true });
  await fs.promises.writeFile(
    path.join(v2Root, 'generations', oldSessionId, 'image.png'),
    'image',
  );

  const result = await __testOnly__.copyTranslateSessionAssets({
    oldSessionId,
    newSessionId,
    assetsRoots: [v2Root],
    originalSessionData: {
      layers: [
        {
          aiVideoLayer: `assets_v2/ai_video/generations/${oldSessionId}/layer-1/video.mp4`,
          aiVideoRemoteLink: `https://static.samsar.one/assets_v2/user_resources/${userId}/ai_videos/${oldSessionId}/layer-1/video.mp4?Expires=123&Signature=old&Key-Pair-Id=old`,
          frames: [
            `assets_v2/video/frames/${oldSessionId}/layer-1/0.png`,
          ],
          imageSession: {
            activeGeneratedImage: `assets_v2/generations/${oldSessionId}/image.png`,
          },
        },
      ],
    },
  });

  assert.equal(result.missingCritical.length, 0);
  assert.equal(
    await fs.promises.readFile(path.join(v2Root, 'ai_video', 'generations', newSessionId, 'layer-1', 'video.mp4'), 'utf8'),
    'ai-video',
  );
  assert.equal(
    await fs.promises.readFile(path.join(v2Root, 'video', 'frames', newSessionId, 'layer-1', '0.png'), 'utf8'),
    'frame',
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

test('translate video prep requeues speech and lip sync for reusable AI video layers only', () => {
  const clonedSession = {
    languageString: 'Thai',
    expressGenerationStatus: {},
    isStepVideoGeneration: true,
    expressStepGeneration: {
      enabled: true,
      status: 'PENDING',
      currentStep: 'narrator_avatar_generation',
      current_step: 'narrator_avatar_generation',
      nextStep: 'video_generation',
      next_step: 'video_generation',
      waitingForProcessNext: true,
      waiting_for_process_next: true,
      requiresUserAction: true,
      requires_user_action: true,
      canProcessNext: true,
      can_process_next: true,
    },
    layers: [
      {
        layerBaseAiImageType: 'character',
        layerAiVideoType: 'character',
        hasAiVideoLayer: false,
        aiVideoRemoteLink: 'https://static.samsar.one/assets_v2/user_resources/user-1/ai_videos/source-session/layer-1/video.mp4',
        hasLipSyncVideoLayer: true,
        lipSyncVideoLayer: 'assets_v2/video/lip_sync/source-session/layer-1.mp4',
        lipSyncRemoteLink: 'https://static.samsar.one/assets_v2/video/lip_sync/source-session/layer-1.mp4',
        lipSyncVideoGenerationStatus: 'COMPLETED',
        frames: ['assets_v2/video/frames/source-session/layer-1/0.png'],
        aiLayerStartFrame: 'assets_v2/ai_video/frames/source-session/layer-1/0.png',
        aiLayerEndFrame: 'assets_v2/ai_video/frames/source-session/layer-1/119.png',
      },
      {
        layerBaseAiImageType: 'background',
        layerAiVideoType: 'ai_video',
        hasAiVideoLayer: true,
        aiVideoLayer: 'assets_v2/ai_video/generations/source-session/layer-2/video.mp4',
        frames: ['assets_v2/video/frames/source-session/layer-2/0.png'],
        aiLayerStartFrame: 'assets_v2/ai_video/frames/source-session/layer-2/0.png',
        aiLayerEndFrame: 'assets_v2/ai_video/frames/source-session/layer-2/119.png',
      },
    ],
    audioLayers: [
      {
        generationType: 'speech',
        generationStatus: 'COMPLETED',
        audioLink: 'https://cdn.example/speech.mp3',
        localAudioLinks: ['assets_v2/video/audio/source-session/speech.mp3'],
        remoteAudioLinks: ['https://cdn.example/speech.mp3'],
        remoteAudioData: [{ title: 'speech', audio_url: 'https://cdn.example/speech.mp3' }],
        selectedLocalAudioLink: 'assets_v2/video/audio/source-session/speech.mp3',
        selectedRemoteAudioLink: 'https://cdn.example/speech.mp3',
        previousAudioData: { duration: 2 },
      },
      {
        generationType: 'music',
        generationStatus: 'PENDING',
        streamDownloadPending: true,
      },
    ],
  };

  __testOnly__.prepareSessionForTranslate({
    clonedSession,
    normalizedLanguageCode: 'EN',
    enableSubtitles: false,
  });

  assert.equal(clonedSession.audioGenerationPending, true);
  assert.equal(clonedSession.expressGenerationStatus.audio_generation, 'PENDING');
  assert.equal(clonedSession.expressGenerationStatus.speech_generation, 'PENDING');
  assert.equal(clonedSession.expressGenerationStatus.lip_sync_generation, 'INIT');
  assert.equal(clonedSession.expressGenerationStatus.frame_generation, 'INIT');
  assert.equal(clonedSession.expressGenerationStatus.video_generation, 'INIT');
  assert.equal(clonedSession.isStepVideoGeneration, false);
  assert.equal(clonedSession.expressStepGeneration.enabled, false);
  assert.equal(clonedSession.expressStepGeneration.status, 'COMPLETED');
  assert.equal(clonedSession.expressStepGeneration.nextStep, null);
  assert.equal(clonedSession.expressStepGeneration.next_step, null);
  assert.equal(clonedSession.expressStepGeneration.waitingForProcessNext, false);
  assert.equal(clonedSession.expressStepGeneration.waiting_for_process_next, false);
  assert.equal(clonedSession.expressStepGeneration.requiresUserAction, false);
  assert.equal(clonedSession.expressStepGeneration.requires_user_action, false);
  assert.equal(clonedSession.expressStepGeneration.canProcessNext, false);
  assert.equal(clonedSession.expressStepGeneration.can_process_next, false);

  assert.equal(clonedSession.layers[0].hasAiVideoLayer, true);
  assert.equal(clonedSession.layers[0].lipSyncGenerationPending, true);
  assert.equal(clonedSession.layers[0].hasLipSyncVideoLayer, false);
  assert.equal(clonedSession.layers[0].lipSyncVideoLayer, null);
  assert.equal(clonedSession.layers[0].lipSyncRemoteLink, null);
  assert.equal(clonedSession.layers[0].lipSyncVideoGenerationStatus, 'INIT');
  assert.deepEqual(clonedSession.layers[0].frames, []);
  assert.equal(clonedSession.layers[0].aiLayerStartFrame, null);
  assert.equal(clonedSession.layers[0].aiLayerEndFrame, null);
  assert.equal(clonedSession.layers[1].lipSyncGenerationPending, false);
  assert.deepEqual(clonedSession.layers[1].frames, []);
  assert.equal(clonedSession.layers[1].aiLayerStartFrame, null);
  assert.equal(clonedSession.layers[1].aiLayerEndFrame, null);

  assert.equal(clonedSession.audioLayers[0].generationStatus, 'PENDING');
  assert.equal(clonedSession.audioLayers[0].audioLink, null);
  assert.deepEqual(clonedSession.audioLayers[0].localAudioLinks, []);
  assert.deepEqual(clonedSession.audioLayers[0].remoteAudioLinks, []);
  assert.equal(clonedSession.audioLayers[0].previousAudioData, null);
  assert.equal(clonedSession.audioLayers[0].defaultSelected, true);
  assert.equal(clonedSession.audioLayers[1].generationStatus, 'COMPLETED');
  assert.equal(clonedSession.audioLayers[1].streamDownloadPending, false);
});
