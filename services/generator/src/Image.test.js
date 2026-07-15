import test from 'node:test';
import assert from 'node:assert/strict';

import { __testOnly__ } from './Image.js';

test('image scoring context prefers current request prompt over movie resource scene index', () => {
  const context = __testOnly__.buildImageThemeScoringContext(
    {
      movieResourceList: {
        scenes: [
          { visual: 'Asha scene visual' },
        ],
      },
      layers: [
        {
          originalImageGenerationPrompt: 'Kenji layer prompt',
        },
      ],
    },
    0,
    'Kenji current retry prompt',
  );

  assert.equal(context, 'Layer visual prompt: Kenji current retry prompt');
});

test('image scoring context falls back to layer prompt before scene visual', () => {
  const context = __testOnly__.buildImageThemeScoringContext(
    {
      movieResourceList: {
        scenes: [
          { visual: 'Asha scene visual' },
        ],
      },
      layers: [
        {
          originalImageGenerationPrompt: 'Kenji layer prompt',
        },
      ],
    },
    0,
    '',
  );

  assert.equal(context, 'Layer visual prompt: Kenji layer prompt');
});

test('image scoring context does not use layer index as scene index when scene and layer arrays diverge', () => {
  const context = __testOnly__.buildImageThemeScoringContext(
    {
      movieResourceList: {
        scenes: [
          { visual: 'Asha scene visual' },
          { visual: 'Rack scene visual' },
          { visual: 'Kenji scene visual' },
        ],
      },
      layers: [
        {},
      ],
    },
    0,
    '',
  );

  assert.equal(context, '');
});

test('image scoring context uses explicit source scene index when available', () => {
  const context = __testOnly__.buildImageThemeScoringContext(
    {
      movieResourceList: {
        scenes: [
          { visual: 'Asha scene visual' },
          { visual: 'Rack scene visual' },
          { visual: 'Kenji scene visual' },
        ],
      },
      layers: [
        {
          sourceSceneIndex: 2,
        },
      ],
    },
    0,
    '',
  );

  assert.equal(context, 'Scene visual: Kenji scene visual');
});

test('image scoring payload context uses explicit source scene index for reroll scene visual', () => {
  const details = __testOnly__.buildImageThemeScoringContextDetailsForPayload(
    {
      movieResourceList: {
        scenes: [
          { visual: 'Asha scene visual' },
          { visual: 'Rack scene visual' },
          { visual: 'Kenji scene visual' },
        ],
      },
      layers: [
        {},
      ],
    },
    0,
    {
      sourceSceneIndex: 2,
    },
  );

  assert.equal(details.context, 'Scene visual: Kenji scene visual');
  assert.equal(details.diagnostics.contextType, 'scene_visual');
  assert.equal(details.diagnostics.layerDataIndex, 0);
  assert.equal(details.diagnostics.sourceSceneIndex, 2);
  assert.equal(details.diagnostics.sourceSceneIndexSource, 'payload.sourceSceneIndex');
  assert.equal(details.diagnostics.sceneIndexFallbackUsed, false);
});

test('image scoring context diagnostics identifies selected prompt source', () => {
  const details = __testOnly__.buildImageThemeScoringContextDetails(
    {
      movieResourceList: {
        scenes: [
          { visual: 'Asha scene visual' },
        ],
      },
      layers: [
        {
          originalImageGenerationPrompt: 'Kenji layer prompt',
        },
      ],
    },
    0,
    '',
  );

  assert.equal(details.context, 'Layer visual prompt: Kenji layer prompt');
  assert.equal(details.diagnostics.contextType, 'layer_prompt');
  assert.equal(details.diagnostics.selectedPromptSource, 'layer.originalImageGenerationPrompt');
  assert.equal(details.diagnostics.layerDataIndex, 0);
  assert.equal(details.diagnostics.selectedPromptText.length, 'Kenji layer prompt'.length);
});

test('grounded scoring relaxes to 50 only after multiple score-only failures', () => {
  assert.equal(
    __testOnly__.getScoreThresholdCutoff('grounded', {
      failureRetryCount: 0,
      filterRetryCount: 1,
    }),
    61,
  );
  assert.equal(
    __testOnly__.getScoreThresholdCutoff('grounded', {
      failureRetryCount: 0,
      filterRetryCount: 2,
    }),
    50,
  );
  assert.equal(
    __testOnly__.getImageFilterScoreCutoff('grounded', {
      failureRetryCount: 0,
      filterRetryCount: 2,
    }),
    61,
  );
});

test('image generation failures do not enable score-only layer pruning', () => {
  const policy = __testOnly__.getTerminalFilterFailurePolicy('grounded', {
    failureRetryCount: 1,
    filterRetryCount: 2,
  });

  assert.equal(policy.fallbackScoreCutoff, 51);
  assert.equal(policy.allowExpressLayerPrune, false);
  assert.equal(
    __testOnly__.hasReachedScoreOnlyFilterRelaxation({
      failureRetryCount: 1,
      filterRetryCount: 2,
    }),
    false,
  );
});

test('terminal score-only fallback accepts the best candidate at or above 50', () => {
  const passes = [
    { score: 42, src: 'attempt-1.png' },
    { score: 58, src: 'attempt-2.png' },
    { score: 44, src: 'attempt-3.png' },
  ];
  const policy = __testOnly__.getTerminalFilterFailurePolicy('grounded', {
    failureRetryCount: 0,
    filterRetryCount: 2,
  });

  assert.equal(policy.fallbackScoreCutoff, 50);
  assert.equal(policy.allowExpressLayerPrune, true);
  assert.deepEqual(
    __testOnly__.getBestFilterPass(passes, policy.fallbackScoreCutoff),
    { pass: passes[1], score: 58 },
  );
  assert.equal(
    __testOnly__.getBestFilterPass([
      { score: 42, src: 'attempt-1.png' },
      { score: 49, src: 'attempt-2.png' },
      { score: 44, src: 'attempt-3.png' },
    ], policy.fallbackScoreCutoff),
    null,
  );
});

test('selected image candidate keeps its source, score, and description aligned', () => {
  assert.deepEqual(__testOnly__.buildActiveImageCandidate({
    src: 'generations/selected.png',
    remoteSrc: '/generations/selected.png',
    description: 'A presenter points to the quarterly chart.',
    score: '82',
  }), {
    src: 'generations/selected.png',
    remoteSrc: '/generations/selected.png',
    description: 'A presenter points to the quarterly chart.',
    score: 82,
  });
});

test('selected image candidate explicitly clears a missing description', () => {
  assert.deepEqual(__testOnly__.buildActiveImageCandidate({
    src: 'generations/replacement.png',
    description: null,
    score: null,
  }), {
    src: 'generations/replacement.png',
    remoteSrc: '',
    description: '',
    score: null,
  });
});

test('optional image scores preserve missing values and numeric zero', () => {
  assert.equal(__testOnly__.normalizeOptionalScore(null), null);
  assert.equal(__testOnly__.normalizeOptionalScore(''), null);
  assert.equal(__testOnly__.normalizeOptionalScore('not-a-score'), null);
  assert.equal(__testOnly__.normalizeOptionalScore(0), 0);
  assert.equal(__testOnly__.normalizeOptionalScore('0'), 0);
});

test('provider inappropriate-content responses use the safety retry path', () => {
  assert.equal(
    __testOnly__.isSafetyRejectionMessage('400 Input text data may contain inappropriate content.'),
    true,
  );
});

test('image generation retries use bounded exponential backoff', () => {
  const firstDelay = __testOnly__.getImageGenerationRetryDelayMs(1);
  const secondDelay = __testOnly__.getImageGenerationRetryDelayMs(2);
  const thirdDelay = __testOnly__.getImageGenerationRetryDelayMs(3);

  assert.ok(firstDelay >= 250);
  assert.equal(secondDelay, Math.min(firstDelay * 2, thirdDelay));
  assert.ok(thirdDelay >= secondDelay);
  assert.ok(thirdDelay <= 30000);
  assert.equal(
    __testOnly__.getImageGenerationNextAttemptAfter(1, 1000).getTime(),
    1000 + firstDelay,
  );
});

test('retryable vision failures return to the normal express image retry path', () => {
  assert.equal(__testOnly__.shouldRetryUnhandledGenerationTask({
    operationType: 'GENERATE',
    isBatchGeneration: true,
  }, {
    nonPromptProviderFailure: true,
    preserveExpressImageLayer: true,
  }), true);

  assert.equal(__testOnly__.shouldRetryUnhandledGenerationTask({
    operationType: 'GENERATE',
    isBatchGeneration: true,
  }, new Error('Unexpected coding error')), false);
});

test('timeline reflow shifts only later layers and their connected audio', () => {
  const layers = [
    { _id: 'layer-1', durationOffset: 0, duration: 5 },
    { _id: 'layer-3', durationOffset: 10, duration: 5 },
  ];
  const audioLayers = [
    {
      connectedLayerId: 'layer-3',
      connectedLayerStartTimeOffset: 2,
      startTime: 12,
      endTime: 14,
      duration: 2,
    },
    {
      generationType: 'music',
      startTime: 0,
      endTime: 15,
      duration: 15,
    },
  ];

  const totalDuration = __testOnly__.reflowLayersAndConnectedAudio(layers, audioLayers);

  assert.equal(totalDuration, 10);
  assert.equal(layers[0].durationOffset, 0);
  assert.equal(layers[1].durationOffset, 5);
  assert.equal(audioLayers[0].connectedLayerStartTimeOffset, 2);
  assert.equal(audioLayers[0].startTime, 7);
  assert.equal(audioLayers[0].endTime, 9);
  assert.equal(audioLayers[1].startTime, 0);
  assert.equal(audioLayers[1].endTime, 10);
});

test('score-only prune plan removes the failed layer and its connected audio', () => {
  const plan = __testOnly__.buildExpressLayerPrunePlan({
    isExpressGeneration: true,
    layers: [
      {
        _id: 'layer-1',
        durationOffset: 0,
        duration: 5,
        layerBaseAiImageType: 'scene',
        layerAiVideoType: 'scene',
      },
      {
        _id: 'layer-2',
        durationOffset: 5,
        duration: 5,
        layerBaseAiImageType: 'sound_effect',
        layerAiVideoType: 'sound_effect',
      },
      {
        _id: 'layer-3',
        durationOffset: 10,
        duration: 5,
        layerBaseAiImageType: 'scene',
        layerAiVideoType: 'scene',
      },
    ],
    audioLayers: [
      {
        _id: 'failed-layer-audio',
        connectedLayerId: 'layer-2',
        startTime: 5,
        endTime: 10,
        duration: 5,
      },
      {
        _id: 'later-layer-audio',
        connectedLayerId: 'layer-3',
        startTime: 11,
        endTime: 14,
        duration: 3,
      },
      {
        _id: 'music',
        generationType: 'music',
        startTime: 0,
        endTime: 15,
        duration: 15,
      },
    ],
  }, 'layer-2');

  assert.equal(plan.pruned, true);
  assert.deepEqual(plan.layers.map((layer) => layer._id), ['layer-1', 'layer-3']);
  assert.equal(plan.layers[1].durationOffset, 5);
  assert.equal(plan.layers[1].frameGenerationPending, true);
  assert.deepEqual(
    plan.audioLayers.map((audioLayer) => audioLayer._id),
    ['later-layer-audio', 'music'],
  );
  assert.equal(plan.audioLayers[0].startTime, 6);
  assert.equal(plan.audioLayers[0].endTime, 9);
  assert.equal(plan.audioLayers[1].endTime, 10);
  assert.equal(plan.totalDuration, 10);
});
