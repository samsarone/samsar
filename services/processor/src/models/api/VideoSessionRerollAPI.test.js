import test from 'node:test';
import assert from 'node:assert/strict';

import { __testOnly__, rerollVideoSessionLayersAndQueueGeneration } from './VideoSessionRerollAPI.js';
import { buildSourceSceneFields } from '../video/SceneIdentity.js';

test('F2P: legacy sound-effect scene resolves through an appended outro without altering the source', () => {
  const scenes = Array.from({ length: 13 }, (_, index) => ({
    visual: `Original scene ${index}`, type: 'sound_effect', duration: 10,
  }));
  const session = {
    _id: 'original-session',
    movieResourceList: { scenes },
    layers: [
      ...scenes.map((scene, index) => ({
        _id: `layer-${index}`, originalImageGenerationPrompt: scene.visual,
        layerBaseAiImageType: 'sound_effect', imageSession: {},
      })),
      { _id: 'outro', layerBaseAiImageType: 'none', skipAiVideoGeneration: true },
    ],
    audioLayers: [{ connectedLayerId: 'layer-0', generationType: 'sound_effect' }],
  };
  const before = structuredClone(session);
  const resolved = __testOnly__.resolveLayerSourceSceneIndexDetails(session, session.layers[0], 0);
  assert.equal(resolved.sourceSceneIndex, 0);
  assert.deepEqual(session, before);
});

test('F2P: original prompt identity wins over a reordered audio timeline position', () => {
  const layer = { _id: 'scene-b', originalImageGenerationPrompt: 'Scene B', imageSession: {} };
  const session = {
    movieResourceList: { scenes: [{ visual: 'Scene A' }, { visual: 'Scene B' }] },
    layers: [layer, { _id: 'scene-a', originalImageGenerationPrompt: 'Scene A' }],
    audioLayers: [{ connectedLayerId: 'scene-b', connectedLayerIndex: 0 }],
  };
  assert.equal(__testOnly__.resolveLayerSourceSceneIndex(session, layer, 0), 1);
});

test('F2P: all connected audio rows are considered when the first row has no index', () => {
  const layer = { _id: 'scene-b' };
  const session = {
    movieResourceList: { scenes: [{ visual: 'Scene A' }, { visual: 'Scene B' }] },
    layers: [layer],
    audioLayers: [
      { connectedLayerId: 'scene-b', generationType: 'sound_effect' },
      { connectedLayerId: 'scene-b', generationType: 'speech', connectedLayerIndex: 1 },
    ],
  };
  assert.equal(__testOnly__.resolveLayerSourceSceneIndex(session, layer, 0), 1);
});

test('F2P: narrative-only sessions retain reroll scene resolution', () => {
  const layer = { _id: 'scene-a', originalImageGenerationPrompt: 'Scene A' };
  const session = { narrativeJson: { scenes: [{ visual: 'Scene A' }] }, layers: [layer] };
  assert.equal(__testOnly__.resolveLayerSourceSceneIndex(session, layer, 0), 0);
});

function rerollHarness() {
  const source = {
    _id: 'source-session', userId: 'user', aspectRatio: '9:16', videoTone: 'grounded',
    expressGenerationImageModel: 'SEEDREAM', expressGenerativeVideoModel: 'HAPPYHORSEI2V',
    movieResourceList: { scenes: [{ visual: 'The original commander', type: 'sound_effect', duration: 10 }] },
    layers: [{
      _id: 'first-layer', originalImageGenerationPrompt: 'The original commander',
      layerBaseAiImageType: 'sound_effect', duration: 10, refilterImageScore: 74,
      frames: ['original/0.png'], aiVideoLayer: 'original/video.mp4',
      imageSession: { activeGeneratedImage: 'original/clean.png', generationStatus: 'COMPLETED', activeItemList: [] },
    }, { _id: 'outro', layerBaseAiImageType: 'none', skipAiVideoGeneration: true, frames: ['outro/0.png'] }],
    expressGenerationStatus: { status: 'COMPLETED', image_generation: 'COMPLETED' },
    videoLink: 'original/render.mp4',
  };
  const clone = structuredClone(source);
  clone._id = 'clone-session';
  const events = [];
  clone.markModified = () => {};
  clone.save = async () => { events.push('save'); };
  const dependencies = {
    loadOwnedSession: async (_user, id) => id === source._id ? source : clone,
    prepareImageRequestBilling: async () => { events.push('billing'); },
    copyVideoSession: async () => { events.push('copy'); return { sessionId: clone._id }; },
    buildMovieResourceListVisualPrompts: async (options) => {
      events.push('visual');
      assert.equal(options.movieResourceList.scenes[0].visual, 'The original commander');
      return { promptList: [{ prompt: 'Regenerated commander prompt' }] };
    },
    deleteStaleQueuedWork: async () => { events.push('delete'); },
    queueImageRerollRequests: async (_user, _session, layers) => {
      events.push('queue');
      assert.equal(layers[0].sourceSceneRef.scene.visual, 'The original commander');
    },
    upsertGlobalSessionMapping: async () => { events.push('mapping'); },
  };
  return { source, clone, events, dependencies };
}

test('scene reroll uses the source inference model and separately saved effort', async () => {
  const { source, dependencies } = rerollHarness();
  source.expressGenerationInferenceModel = 'claude-opus-5.5';
  source.expressGenerationInferenceEffort = 'xhigh';
  source.inferenceModel = 'gemini-4-carbon';
  dependencies.buildMovieResourceListVisualPrompts = async (options) => {
    assert.equal(options.inferenceModel, 'claude-opus-5.5-xhigh');
    return { promptList: [{ prompt: 'Regenerated commander prompt' }] };
  };
  await rerollVideoSessionLayersAndQueueGeneration(
    'user', { videoSessionId: source._id, layerIndexes: [1] }, dependencies,
  );
});

test('F2P: invalid scene mapping aborts reroll before billing, inference or clone creation', async () => {
  const { source, events, dependencies } = rerollHarness();
  delete source.movieResourceList;
  await assert.rejects(
    rerollVideoSessionLayersAndQueueGeneration('user', { videoSessionId: source._id, layerIndexes: [1] }, dependencies),
    (error) => error.code === 'REROLL_VISUAL_SCENE_MISSING' && error.status === 422 && error.layerIndex === 1,
  );
  assert.deepEqual(events, []);
  assert.equal(source.layers[0].imageSession.activeGeneratedImage, 'original/clean.png');
});

test('F2P: failed visual inference does not leave a cloned session', async () => {
  const { source, events, dependencies } = rerollHarness();
  dependencies.buildMovieResourceListVisualPrompts = async () => {
    events.push('visual');
    throw new Error('inference unavailable');
  };
  await assert.rejects(
    rerollVideoSessionLayersAndQueueGeneration('user', { videoSessionId: source._id, layerIndexes: [1] }, dependencies),
    /inference unavailable/,
  );
  assert.deepEqual(events, ['billing', 'visual']);
});

test('F2P/P2P: legacy SFX reroll queues the correct new frame while preserving the original render', async () => {
  const { source, clone, events, dependencies } = rerollHarness();
  const before = structuredClone(source);
  const result = await rerollVideoSessionLayersAndQueueGeneration(
    'user', { videoSessionId: source._id, layerIndexes: [1] }, dependencies,
  );
  assert.equal(result.session_id, 'clone-session');
  assert.deepEqual(events, ['billing', 'visual', 'copy', 'delete', 'save', 'queue', 'mapping']);
  assert.deepEqual(source, before);
  assert.equal(clone.layers[0].imageSession.generationStatus, 'PENDING');
  assert.equal(clone.layers[0].sourceSceneIndex, 0);
  assert.equal(clone.layers[0].sourceSceneRef.scene.visual, 'The original commander');
  assert.equal(clone.layers[0].prompt, 'Regenerated commander prompt');
  assert.equal(clone.layers[0].soundEffectGenerationPending, true);
  assert.equal(clone.layers[1].skipAiVideoGeneration, true);
  assert.equal(result.creditQuote.totalCredits, 0);
});

test('F2P: joined layers regenerate from their own source scene, sounds and theme', async () => {
  const second = buildSourceSceneFields({
    sourceSessionId: 'second-origin', sceneIndex: 0,
    scene: { visual: 'A different original', type: 'character', duration: 5 },
    sounds: [{ sceneIndex: 0, gender: 'M', audio: 'Hello' }], themeJson: { setting: 'second origin' },
  });
  const session = {
    _id: 'joined', movieResourceList: { scenes: [{ visual: 'First origin only' }] },
    layers: [{ _id: 'joined-second', ...second }],
  };
  const targets = __testOnly__.resolveRerollTargets(session, [1]);
  const plans = await __testOnly__.prepareRerollVisualPlans(session, targets, {
    buildMovieResourceListVisualPrompts: async (options) => {
      assert.equal(options.movieResourceList.scenes[0].visual, 'A different original');
      assert.deepEqual(options.themeJson, { setting: 'second origin' });
      assert.equal(options.movieResourceList.sounds[0].gender, 'M');
      assert.equal(options.movieResourceList.sounds[0].sceneIndex, 0);
      return { promptList: [{ prompt: 'Correct second-origin prompt' }] };
    },
  });
  assert.equal(plans[0].sourceSceneRef.sourceSessionId, 'second-origin');
  assert.equal(plans[0].prompt, 'Correct second-origin prompt');
});

test('P2P: an empty persisted source theme never inherits another joined video theme', async () => {
  const fields = buildSourceSceneFields({ sourceSessionId: 'empty-theme-origin', sceneIndex: 0,
    scene: { visual: 'An unthemed source', duration: 5 } });
  // The persistence layer minimizes empty objects.
  delete fields.sourceSceneRef.themeJson;
  const session = { _id: 'joined', themeJson: { setting: 'Wrong first-video theme' },
    layers: [{ _id: 'layer', ...fields }] };
  await __testOnly__.prepareRerollVisualPlans(session, __testOnly__.resolveRerollTargets(session, [1]), {
    buildMovieResourceListVisualPrompts: async (options) => {
      assert.deepEqual(options.themeJson, {});
      return { promptList: [{ prompt: 'Unthemed regenerated prompt' }] };
    },
  });
});

test('F2P: a joined layer quote uses its own snapshot visual when no stored image prompt exists', () => {
  const fields = buildSourceSceneFields({ sourceSessionId: 'second-origin', sceneIndex: 0,
    scene: { visual: 'Second source visual', duration: 5 } });
  const layer = { _id: 'joined-layer', ...fields };
  const session = { layers: [layer], movieResourceList: { scenes: [{ visual: 'First source visual' }] } };
  assert.deepEqual(__testOnly__.getLayerPromptInfo(session, layer, 0), { prompt: 'Second source visual', source: 'seed' });
});

test('F2P: a joined layer quote recovers source context retained only on linked audio', () => {
  const fields = buildSourceSceneFields({ sourceSessionId: 'second-origin', sceneIndex: 0,
    scene: { visual: 'Second audio-origin visual', duration: 5 } });
  const layer = { _id: 'joined-layer' };
  const session = { joinedSourceSessionIds: ['first-origin', 'second-origin'], layers: [layer],
    audioLayers: [{ connectedLayerId: layer._id, ...fields }],
    movieResourceList: { scenes: [{ visual: 'First source visual' }] } };
  assert.deepEqual(__testOnly__.getLayerPromptInfo(session, layer, 0), { prompt: 'Second audio-origin visual', source: 'seed' });
});

test('rerolls defer video and image calls without a prepaid stage charge', () => {
  const quote = __testOnly__.buildQuote({ aspectRatio: '16:9', expressGenerativeVideoModel: 'RUNWAYML',
    layers: [{ _id: 'scene', prompt: 'A new scene', duration: 10 }] }, [1]);
  assert.equal(quote.totalCredits, 0);
  assert.equal(quote.aiVideoCredits, 0);
  assert.equal(quote.videoBilling, 'ON_COMPLETION');
});

test('historical GPTIMAGE2 rerolls normalize the model and defer image charges to completion', () => {
  const session = {
    aspectRatio: '16:9',
    expressGenerationImageModel: 'GPTIMAGE2',
    layers: [{ _id: 'layer-1', prompt: 'An anime frame', duration: 0 }],
  };
  const historical = __testOnly__.buildQuote(session, [1]);
  const current = __testOnly__.buildQuote({ ...session, expressGenerationImageModel: 'GPTIMAGE2.5' }, [1]);
  assert.deepEqual(historical, current);
  assert.equal(historical.imageModel, 'GPTIMAGE2.5');
  assert.equal(historical.imageCredits, 0);
  assert.equal(historical.imageBilling, 'ON_COMPLETION');
});

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
