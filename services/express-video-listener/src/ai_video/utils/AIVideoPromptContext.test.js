import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAiVideoPromptSeedContext,
  buildRankedFallbackStartImages,
  getLayerImageDescription,
  normalizeImageCandidateSource,
} from './AIVideoPromptContext.js';

test('fallback images are ranked, deduplicated, and exclude the active image', () => {
  const layer = {
    imageSession: {
      activeGeneratedImage: 'generations/current.png',
      activeSelectedImage: '/generations/current.png',
    },
    filterPasses: [
      { src: '/generations/current.png', score: 99, description: 'current' },
      { src: 'assets/generations/second.png', score: 80, description: 'second description' },
      { src: 'generations/third.png', score: 60, description: 'third description' },
      { src: '/generations/second.png', score: 40, description: 'duplicate' },
    ],
  };

  assert.deepEqual(buildRankedFallbackStartImages(layer), [
    { src: 'assets/generations/second.png', score: 80, description: 'second description', rank: 0 },
    { src: 'generations/third.png', score: 60, description: 'third description', rank: 1 },
  ]);
});

test('fallback images preserve missing scores as null', () => {
  const layer = {
    filterPasses: [
      { src: 'generations/null-score.png', score: null, description: 'null score' },
      { src: 'generations/blank-score.png', score: '', description: 'blank score' },
    ],
  };

  assert.deepEqual(buildRankedFallbackStartImages(layer), [
    {
      src: 'generations/null-score.png',
      score: null,
      description: 'null score',
      rank: 0,
    },
    {
      src: 'generations/blank-score.png',
      score: null,
      description: 'blank score',
      rank: 1,
    },
  ]);
});

test('asset normalization aligns remote, assets, and relative generation paths', () => {
  assert.equal(
    normalizeImageCandidateSource('https://cdn.example.com/assets_v2/generations/a.png?Expires=1'),
    'generations/a.png',
  );
  assert.equal(normalizeImageCandidateSource('/assets/generations/a.png'), 'generations/a.png');
});

test('prompt seed context uses the canonical nested image description', () => {
  const layer = {
    prompt: 'The presenter points to the chart.',
    layerAiVideoType: 'character',
    activeImageDescription: 'legacy description',
    imageSession: { activeImageDescription: 'current selected image description' },
  };

  assert.equal(getLayerImageDescription(layer), 'current selected image description');
  assert.deepEqual(buildAiVideoPromptSeedContext({
    layer,
    layerIndex: 1,
    layerCount: 3,
    sceneDescriptions: ['one', 'current selected image description', 'three'],
    cameraTransition: 'Slow pan right',
    videoTone: 'grounded',
    userInferenceModel: 'QWEN3.8',
    selectedInferenceModelAuthorization: 'native',
  }), {
    sceneAction: 'The presenter points to the chart.',
    startImageDescription: 'current selected image description',
    sceneDescriptions: ['one', 'current selected image description', 'three'],
    cameraTransition: 'Slow pan right',
    indexData: { isStartScene: false, isEndScene: false },
    isSpeakerTransition: true,
    videoTone: 'grounded',
    userInferenceModel: 'QWEN3.8',
    selectedInferenceModelAuthorization: 'native',
    useShortFormPrompt: false,
    reasoningEffort: 'high',
  });
});

test('prompt seed context can preserve a resolved Infinitezoom motion strategy', () => {
  const swirlPrompt = 'Camera swirls clockwise and zooms in';
  const context = buildAiVideoPromptSeedContext({
    layer: {
      prompt: 'The original narrative scene action.',
      imageSession: { activeImageDescription: 'A mountain reflected in a lake.' },
    },
    sceneAction: 'The original narrative scene action.',
    resolvedPrompt: swirlPrompt,
    promptStrategy: 'infinitezoom',
    layerIndex: 0,
    layerCount: 2,
    sceneDescriptions: ['A mountain reflected in a lake.', 'A cabin in the forest.'],
  });

  assert.equal(context.sceneAction, 'The original narrative scene action.');
  assert.equal(context.resolvedPrompt, swirlPrompt);
  assert.equal(context.promptStrategy, 'infinitezoom');
});
