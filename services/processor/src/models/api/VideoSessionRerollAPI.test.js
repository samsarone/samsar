import test from 'node:test';
import assert from 'node:assert/strict';

import { __testOnly__ } from './VideoSessionRerollAPI.js';

test('reroll clone integrity allows matching first and last scene positions', () => {
  const sourceSession = {
    layers: [
      { _id: 'layer-1' },
      { _id: 'layer-2' },
      { _id: 'layer-3' },
    ],
  };
  const clonedSession = {
    layers: [
      { _id: 'layer-1' },
      { _id: 'layer-2' },
      { _id: 'layer-3' },
    ],
  };

  assert.doesNotThrow(() => {
    __testOnly__.assertRerollCloneIntegrity(sourceSession, clonedSession, [1, 3]);
  });
});

test('reroll clone integrity rejects partial clones before resetting selected layers', () => {
  const sourceSession = {
    layers: [
      { _id: 'layer-1' },
      { _id: 'layer-2' },
      { _id: 'layer-3' },
    ],
  };
  const clonedSession = {
    layers: [
      { _id: 'layer-3' },
    ],
  };

  assert.throws(
    () => __testOnly__.assertRerollCloneIntegrity(sourceSession, clonedSession, [3]),
    /expected 3 layers but cloned 1/,
  );
});

test('reroll clone integrity rejects shifted selected layer positions', () => {
  const sourceSession = {
    layers: [
      { _id: 'layer-1' },
      { _id: 'layer-2' },
      { _id: 'layer-3' },
    ],
  };
  const clonedSession = {
    layers: [
      { _id: 'layer-3' },
      { _id: 'layer-1' },
      { _id: 'layer-2' },
    ],
  };

  assert.throws(
    () => __testOnly__.assertRerollCloneIntegrity(sourceSession, clonedSession, [1, 3]),
    /layer mismatch at index 1/,
  );
});

test('reroll marks every cloned layer for frame regeneration only', () => {
  const sessionData = {
    frameGenerationPending: false,
    layers: [
      {
        frameGenerationPending: false,
        aiVideoFrameGenerationPending: true,
        initFramesGenerated: true,
        frames: ['/video/frames/source/layer-1/0.png'],
        aiVideoGenerationPending: false,
        aiVideoGenerationStatus: 'COMPLETED',
      },
      {
        frameGenerationPending: false,
        aiVideoFrameGenerationPending: false,
        initFramesGenerated: true,
        frames: ['/video/frames/source/layer-2/0.png'],
        aiVideoGenerationPending: true,
        aiVideoGenerationStatus: 'PENDING',
      },
    ],
  };

  __testOnly__.markAllLayersForFrameRegeneration(sessionData);

  assert.equal(sessionData.frameGenerationPending, true);
  assert.deepEqual(
    sessionData.layers.map((layer) => ({
      frameGenerationPending: layer.frameGenerationPending,
      aiVideoFrameGenerationPending: layer.aiVideoFrameGenerationPending,
      initFramesGenerated: layer.initFramesGenerated,
      frames: layer.frames,
      aiVideoGenerationPending: layer.aiVideoGenerationPending,
      aiVideoGenerationStatus: layer.aiVideoGenerationStatus,
    })),
    [
      {
        frameGenerationPending: true,
        aiVideoFrameGenerationPending: false,
        initFramesGenerated: false,
        frames: [],
        aiVideoGenerationPending: false,
        aiVideoGenerationStatus: 'COMPLETED',
      },
      {
        frameGenerationPending: true,
        aiVideoFrameGenerationPending: false,
        initFramesGenerated: false,
        frames: [],
        aiVideoGenerationPending: true,
        aiVideoGenerationStatus: 'PENDING',
      },
    ],
  );
});

test('reroll reset clears stale selected image sources while preserving non-image overlays', () => {
  const sessionData = { userId: 'user-1' };
  const layer = {
    _id: 'layer-1',
    layerBaseAiImageType: 'character',
    layerAiVideoType: 'character',
    failureRetryCount: 2,
    filterRetryCount: 2,
    retryCount: 2,
    failureHistory: [{ message: 'old failure' }],
    imageSession: {
      activeGeneratedImage: 'assets_v2/generations/source/old.png',
      activeSelectedImage: 'https://static.samsar.one/assets_v2/generations/source/old.png?Expires=123',
      activeEditedImage: 'assets_v2/generations/source/edit.png',
      activeImageRemoteLink: 'https://static.samsar.one/assets_v2/generations/source/old.png?Expires=123',
      activeImageDescription: 'old description',
      failureRetryCount: 2,
      filterRetryCount: 2,
      retryCount: 2,
      failureHistory: [{ message: 'old failure' }],
      lastFailureAt: new Date('2026-01-01T00:00:00Z'),
      lastFailureMessage: 'old failure',
      lastFailureSource: 'old_source',
      activeItemList: [
        { id: 'image-1', type: 'image', src: 'assets_v2/generations/source/old.png', is_base_image: true },
        { id: 'text-1', type: 'text', text: 'Keep me' },
      ],
    },
  };

  __testOnly__.resetLayerForReroll(
    sessionData,
    layer,
    1,
    { prompt: 'new prompt', source: 'original' },
  );

  assert.equal(layer.imageSession.activeGeneratedImage, '');
  assert.equal(layer.imageSession.activeSelectedImage, '');
  assert.equal(layer.imageSession.activeEditedImage, '');
  assert.equal(layer.imageSession.activeImageRemoteLink, '');
  assert.equal(layer.imageSession.activeImageDescription, '');
  assert.deepEqual(layer.imageSession.activeItemList, [
    { id: 'text-1', type: 'text', text: 'Keep me' },
  ]);
  assert.equal(layer.imageSession.generationStatus, 'PENDING');
  assert.equal(layer.aiVideoLayer, null);
  assert.equal(layer.aiVideoRemoteLink, null);
  assert.equal(layer.failureRetryCount, 0);
  assert.equal(layer.filterRetryCount, 0);
  assert.equal(layer.retryCount, 0);
  assert.deepEqual(layer.failureHistory, []);
  assert.equal(layer.imageSession.failureRetryCount, 0);
  assert.equal(layer.imageSession.filterRetryCount, 0);
  assert.equal(layer.imageSession.retryCount, 0);
  assert.deepEqual(layer.imageSession.failureHistory, []);
  assert.equal(layer.imageSession.lastFailureAt, null);
  assert.equal(layer.imageSession.lastFailureMessage, null);
  assert.equal(layer.imageSession.lastFailureSource, null);
});

test('reroll visual regeneration uses the raw narrative scene and enriched speech metadata', async () => {
  const calls = [];
  const sessionData = {
    _id: 'source-session-1',
    aspectRatio: '16:9',
    expressGenerationInferenceModel: 'QWEN3.8',
    videoTone: 'grounded',
    parentJsonTheme: JSON.stringify({
      actors: [{ name: 'Control Crew', keywords: ['male and female technicians'] }],
    }),
    narrativeJson: {
      scenes: [
        { visual: 'Raw opening visual.', type: 'narration', duration: 5, speaker: '' },
        {
          visual: 'Raw mixed-gender control-room visual.',
          type: 'character',
          duration: 10,
          speaker: 'Control Crew',
        },
      ],
      sounds: [],
    },
    movieResourceList: {
      scenes: [
        { visual: 'Expanded opening prompt.', type: 'narration', duration: 5, speaker: '' },
        {
          visual: 'Old female-centered expanded prompt.',
          type: 'character',
          duration: 10,
          speaker: 'Control Crew',
        },
      ],
      sounds: [{
        type: 'speech',
        subType: 'character',
        actor: 'Control Crew',
        gender: 'M',
        sceneIndex: 1,
        audio: 'Altitude dropping.',
        speaker: 'echo',
      }],
    },
  };

  const result = await __testOnly__.regenerateRerollVisualPrompts(
    sessionData,
    [1],
    {
      buildMovieResourceListVisualPrompts: async (options) => {
        calls.push(options);
        return {
          promptList: [{
            prompt: 'New male-centered expanded prompt.',
            duration: 10,
            sceneType: 'character',
          }],
        };
      },
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].movieResourceList.scenes[1].visual, 'Raw mixed-gender control-room visual.');
  assert.equal(calls[0].movieResourceList.sounds[0].gender, 'M');
  assert.equal(calls[0].movieResourceList.sounds[0].speaker, 'echo');
  assert.deepEqual(calls[0].themeJson, {
    actors: [{ name: 'Control Crew', keywords: ['male and female technicians'] }],
  });
  assert.equal(calls[0].aspectRatio, '16:9');
  assert.equal(calls[0].inferenceModel, 'QWEN3.8');
  assert.equal(calls[0].videoTone, 'grounded');
  assert.deepEqual(calls[0].sceneIndexes, [1]);
  assert.deepEqual(result, [{ sceneIndex: 1, prompt: 'New male-centered expanded prompt.' }]);
});

test('reroll reset replaces stored original prompts with the regenerated visual prompt', () => {
  const sessionData = { userId: 'user-1' };
  const layer = {
    _id: 'layer-1',
    layerBaseAiImageType: 'character',
    layerAiVideoType: 'character',
    originalImageGenerationPrompt: 'Old female-centered prompt.',
    originalImageGenerationPromptSource: 'original',
    originalImagePrompt: 'Old female-centered prompt.',
    sourcePrompt: 'Old female-centered prompt.',
    originalPrompt: 'Old female-centered prompt.',
    imageSession: {
      originalImageGenerationPrompt: 'Old female-centered prompt.',
      originalImageGenerationPromptSource: 'original',
      originalImagePrompt: 'Old female-centered prompt.',
      sourcePrompt: 'Old female-centered prompt.',
      originalPrompt: 'Old female-centered prompt.',
      activeItemList: [],
    },
  };

  const result = __testOnly__.resetLayerForReroll(
    sessionData,
    layer,
    1,
    { prompt: 'New male-centered prompt.', source: 'reroll_visual_pipeline' },
    0,
    'layerIndexEqualSceneIndexFallback',
  );

  assert.equal(result.promptSource, 'reroll_visual_pipeline');
  assert.equal(layer.prompt, 'New male-centered prompt.');
  assert.equal(layer.originalImageGenerationPrompt, 'New male-centered prompt.');
  assert.equal(layer.originalImageGenerationPromptSource, 'reroll_visual_pipeline');
  assert.equal(layer.originalImagePrompt, 'New male-centered prompt.');
  assert.equal(layer.sourcePrompt, 'New male-centered prompt.');
  assert.equal(layer.originalPrompt, 'New male-centered prompt.');
  assert.equal(layer.imageSession.prompt, 'New male-centered prompt.');
  assert.equal(layer.imageSession.originalImageGenerationPrompt, 'New male-centered prompt.');
  assert.equal(layer.imageSession.originalImageGenerationPromptSource, 'reroll_visual_pipeline');
  assert.equal(layer.imageSession.originalImagePrompt, 'New male-centered prompt.');
  assert.equal(layer.imageSession.sourcePrompt, 'New male-centered prompt.');
  assert.equal(layer.imageSession.originalPrompt, 'New male-centered prompt.');
  assert.equal(layer.imageSession.originalRetryPrompt, 'New male-centered prompt.');
});

test('reroll resolves source scene index from connected audio when layer and scene arrays differ', () => {
  const sessionData = {
    movieResourceList: {
      scenes: [
        { visual: 'Intro scene' },
        { visual: 'Badge reader scene' },
        { visual: 'Asha scene' },
        { visual: 'Rack lift scene' },
        { visual: 'Kenji scene visual' },
      ],
    },
    layers: [
      { _id: 'layer-intro' },
      { _id: 'layer-badge' },
      { _id: 'layer-kenji' },
    ],
    audioLayers: [
      {
        generationType: 'speech',
        connectedLayerId: 'layer-kenji',
        connectedLayerIndex: 4,
      },
    ],
  };
  const layer = sessionData.layers[2];

  const sourceSceneIndexDetails = __testOnly__.resolveLayerSourceSceneIndexDetails(sessionData, layer, 2);
  const sourceSceneIndex = __testOnly__.resolveLayerSourceSceneIndex(sessionData, layer, 2);
  const promptInfo = __testOnly__.getLayerPromptInfo(sessionData, layer, 2, sourceSceneIndex);

  assert.equal(sourceSceneIndexDetails.sourceSceneIndex, 4);
  assert.equal(sourceSceneIndexDetails.sourceSceneIndexSource, 'connectedAudioLayer.connectedLayerIndex');
  assert.equal(sourceSceneIndex, 4);
  assert.deepEqual(promptInfo, { prompt: 'Kenji scene visual', source: 'seed' });
});

test('reroll reset stores resolved source scene index on cloned layer image state', () => {
  const sessionData = { userId: 'user-1' };
  const layer = {
    _id: 'layer-kenji',
    layerBaseAiImageType: 'character',
    layerAiVideoType: 'character',
    imageSession: {
      activeItemList: [],
    },
  };

  __testOnly__.resetLayerForReroll(
    sessionData,
    layer,
    3,
    { prompt: 'Kenji prompt', source: 'original' },
    4,
    'connectedAudioLayer.connectedLayerIndex',
  );

  assert.equal(layer.sourceSceneIndex, 4);
  assert.equal(layer.sourceSceneIndexSource, 'connectedAudioLayer.connectedLayerIndex');
  assert.equal(layer.imageSession.sourceSceneIndex, 4);
  assert.equal(layer.imageSession.sourceSceneIndexSource, 'connectedAudioLayer.connectedLayerIndex');
});
