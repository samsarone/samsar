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

test('subtitle post-processing copies and rewrites a reusable assets_v2 lip-sync video', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'samsar-subtitle-assets-'));
  const oldSessionId = 'source-session';
  const newSessionId = 'subtitle-session';
  const layerId = 'layer-1';
  const v2Root = path.join(tmpDir, 'assets_v2');
  const sourceRelativePath =
    `assets_v2/ai_video/generations/${oldSessionId}/${layerId}/lip-sync.mp4`;
  const targetRelativePath =
    `assets_v2/ai_video/generations/${newSessionId}/${layerId}/lip-sync.mp4`;

  await fs.promises.mkdir(
    path.join(v2Root, 'ai_video', 'generations', oldSessionId, layerId),
    { recursive: true },
  );
  await fs.promises.writeFile(
    path.join(v2Root, 'ai_video', 'generations', oldSessionId, layerId, 'lip-sync.mp4'),
    'lip-sync-video',
  );

  const originalSessionData = {
    layers: [{
      _id: layerId,
      hasLipSyncVideoLayer: true,
      lipSyncVideoLayer: sourceRelativePath,
      lipSyncVideoGenerationStatus: 'COMPLETED',
    }],
  };
  const clonedSession = structuredClone(originalSessionData);

  const result = await __testOnly__.clonePostProcessingSessionAssets({
    originalSessionData,
    clonedSession,
    oldSessionId,
    newSessionId,
    assetsRoots: [v2Root],
  });

  assert.equal(result.copyResult.missingCritical.length, 0);
  assert.equal(clonedSession.layers[0].lipSyncVideoLayer, targetRelativePath);
  assert.equal(
    await fs.promises.readFile(
      path.join(v2Root, 'ai_video', 'generations', newSessionId, layerId, 'lip-sync.mp4'),
      'utf8',
    ),
    'lip-sync-video',
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

test('add subtitles prep reuses completed lip sync without scheduling lip sync generation', () => {
  const lipSyncVideoLayer =
    'assets_v2/ai_video/generations/source-session/layer-1/video.mp4';
  const clonedSession = {
    expressGenerationStatus: {
      lip_sync_generation: 'PENDING',
      transcript_generation: 'COMPLETED',
      frame_generation: 'COMPLETED',
      video_generation: 'COMPLETED',
    },
    lipSyncGenerationPending: true,
    layers: [{
      lipSyncVideoLayer,
      hasLipSyncVideoLayer: true,
      lipSyncGenerationPending: true,
      lipSyncVideoGenerationStatus: 'PENDING',
      frameGenerationPending: false,
      frames: ['assets_v2/video/frames/source-session/layer-1/0.png'],
    }],
    audioLayers: [],
  };

  __testOnly__.prepareSessionForSubtitleAddition({ clonedSession });

  assert.equal(clonedSession.lipSyncGenerationPending, false);
  assert.equal(clonedSession.layers[0].lipSyncGenerationPending, false);
  assert.equal(clonedSession.layers[0].lipSyncVideoGenerationStatus, 'COMPLETED');
  assert.equal(clonedSession.layers[0].lipSyncVideoLayer, lipSyncVideoLayer);
  assert.equal(clonedSession.layers[0].hasLipSyncVideoLayer, true);
  assert.equal(clonedSession.expressGenerationStatus.lip_sync_generation, 'COMPLETED');
  assert.equal(clonedSession.expressGenerationStatus.transcript_generation, 'INIT');
  assert.equal(clonedSession.expressGenerationStatus.frame_generation, 'INIT');
  assert.equal(clonedSession.expressGenerationStatus.video_generation, 'INIT');
});

test('add subtitles prep regenerates translated text, alignment, and localized speakers', async () => {
  const clonedSession = {
    sessionLanguage: 'en',
    subtitleLanguage: 'en',
    subtitleTranslationRequired: false,
    audioLayers: [
      {
        generationType: 'speech',
        prompt: 'Hello world.',
        speechLanguage: 'en',
        subtitleText: 'stale text',
        subtitleAlignmentMap: [{ sourceText: 'stale', translatedText: 'stale' }],
        speakerCharacterName: 'Guide',
        subtitleSpeakerCharacterName: 'Old guide',
      },
      {
        generationType: 'speech',
        prompt: 'Welcome.',
        speechLanguage: 'en',
      },
      {
        generationType: 'music',
        prompt: 'instrumental',
      },
    ],
  };
  const calls = [];

  const result = await __testOnly__.prepareSubtitleLanguageMetadataForAddition({
    clonedSession,
    subtitleLanguage: 'FR-fr',
    inferenceModel: 'QWEN3.8',
    translateSpeechImpl: async (text, targetLanguage, inferenceModel, options) => {
      calls.push({ text, targetLanguage, inferenceModel, options });
      if (text === 'Hello world.') {
        return {
          text: 'Bonjour monde.',
          subtitleAlignmentMap: [
            { sourceText: 'Hello', translatedText: 'Bonjour' },
            { sourceText: 'world.', translatedText: 'monde.' },
          ],
          subtitleSpeakerCharacterName: 'Guide français',
        };
      }
      return {
        text: 'Bienvenue.',
        subtitleAlignmentMap: [
          { sourceText: 'Welcome.', translatedText: 'Bienvenue.' },
        ],
        subtitleSpeakerCharacterName: null,
      };
    },
  });

  assert.equal(result.selectionProvided, true);
  assert.equal(result.subtitleLanguage, 'fr');
  assert.equal(result.metadataUpdatedCount, 2);
  assert.equal(clonedSession.subtitleLanguage, 'fr');
  assert.equal(clonedSession.subtitleLanguageString, 'French');
  assert.equal(clonedSession.subtitleLanguageExplicit, true);
  assert.equal(clonedSession.subtitleTranslationRequired, true);
  assert.equal(clonedSession.audioLayers[0].subtitleText, 'Bonjour monde.');
  assert.equal(clonedSession.audioLayers[0].subtitleSpeakerCharacterName, 'Guide français');
  assert.equal(clonedSession.audioLayers[0].subtitleTranslationRequired, true);
  assert.deepEqual(clonedSession.audioLayers[0].subtitleAlignmentMap, [
    { sourceText: 'Hello', translatedText: 'Bonjour' },
    { sourceText: 'world.', translatedText: 'monde.' },
  ]);
  assert.equal(clonedSession.audioLayers[1].subtitleText, 'Bienvenue.');
  assert.equal(clonedSession.audioLayers[2].subtitleLanguage, undefined);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].targetLanguage, 'French');
  assert.equal(calls[0].inferenceModel, 'QWEN3.8');
  assert.equal(calls[0].options.includeSubtitleAlignment, true);
  assert.equal(calls[0].options.targetLanguageCode, 'fr');
  assert.equal(calls[0].options.speakerCharacterName, 'Guide');
});

test('add subtitles prep clears translation-only metadata for the audio language', async () => {
  const clonedSession = {
    sessionLanguage: 'ja',
    subtitleLanguage: 'en',
    subtitleTranslationRequired: true,
    audioLayers: [{
      generationType: 'speech',
      prompt: 'こんにちは。',
      speechLanguage: 'jpn',
      subtitleLanguage: 'en',
      subtitleTranslationRequired: true,
      subtitleText: 'Hello.',
      subtitleAlignmentMap: [{ sourceText: 'こんにちは', translatedText: 'Hello' }],
      speakerCharacterName: '案内人',
      subtitleSpeakerCharacterName: 'Guide',
    }],
  };

  const result = await __testOnly__.prepareSubtitleLanguageMetadataForAddition({
    clonedSession,
    subtitleLanguage: 'ja-JP',
    inferenceModel: 'gemini-3.1-pro',
    translateSpeechImpl: () => {
      throw new Error('same-language subtitles must not invoke translation');
    },
  });

  assert.equal(result.metadataUpdatedCount, 0);
  assert.equal(clonedSession.subtitleLanguage, 'ja');
  assert.equal(clonedSession.subtitleTranslationRequired, false);
  assert.equal(clonedSession.audioLayers[0].subtitleLanguage, 'ja');
  assert.equal(clonedSession.audioLayers[0].subtitleText, 'こんにちは。');
  assert.equal(clonedSession.audioLayers[0].subtitleTranslationRequired, false);
  assert.deepEqual(clonedSession.audioLayers[0].subtitleAlignmentMap, []);
  assert.equal(clonedSession.audioLayers[0].subtitleSpeakerCharacterName, null);
});

test('add subtitles prep preserves legacy metadata when target language is omitted', async () => {
  const clonedSession = {
    sessionLanguage: 'en',
    subtitleLanguage: 'fr',
    subtitleTranslationRequired: true,
    audioLayers: [{
      generationType: 'speech',
      prompt: 'Hello.',
      subtitleLanguage: 'fr',
      subtitleText: 'Bonjour.',
      subtitleTranslationRequired: true,
    }],
  };
  const before = structuredClone(clonedSession);

  const result = await __testOnly__.prepareSubtitleLanguageMetadataForAddition({
    clonedSession,
    subtitleLanguage: undefined,
    inferenceModel: 'QWEN3.8',
    translateSpeechImpl: () => {
      throw new Error('omitted target must not invoke translation');
    },
  });

  assert.equal(result.selectionProvided, false);
  assert.equal(result.metadataUpdatedCount, 0);
  assert.deepEqual(clonedSession, before);
});
