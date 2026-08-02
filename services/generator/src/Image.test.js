import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Types } from 'mongoose';

import { __testOnly__ } from './Image.js';
import VideoSession from './schema/VideoSession.js';

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

test('terminal score-only fallback accepts the best candidate for singular sessions', () => {
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

test('branched sessions accept the best terminal image candidate at or above 25 before pruning', () => {
  const passes = [
    { score: 27, src: 'attempt-1.png' },
    { score: 35, src: 'attempt-2.png' },
    { score: 24, src: 'attempt-3.png' },
  ];
  const policy = __testOnly__.getTerminalFilterFailurePolicy(
    'grounded',
    { failureRetryCount: 0, filterRetryCount: 2 },
    { narrativeType: 'branched' },
  );

  assert.equal(policy.fallbackScoreCutoff, 25);
  assert.equal(policy.allowExpressLayerPrune, true);
  assert.deepEqual(
    __testOnly__.getBestFilterPass(passes, policy.fallbackScoreCutoff),
    { pass: passes[1], score: 35 },
  );
  assert.equal(
    __testOnly__.getBestFilterPass([
      { score: 24, src: 'attempt-1.png' },
      { score: 17, src: 'attempt-2.png' },
    ], policy.fallbackScoreCutoff),
    null,
  );
});

test('singular sessions retain the standard cutoff and prune-and-retime policy', () => {
  const policy = __testOnly__.getTerminalFilterFailurePolicy(
    'grounded',
    { failureRetryCount: 0, filterRetryCount: 2 },
    { narrativeType: 'singular' },
  );

  assert.equal(policy.fallbackScoreCutoff, 50);
  assert.equal(policy.allowExpressLayerPrune, true);
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

test('standalone image retries advance to the next configured adapter and clear stale request state', () => {
  const previous = {
    CURRENT_ENV: process.env.CURRENT_ENV,
    SAMSAR_DEPLOYMENT_EDITION: process.env.SAMSAR_DEPLOYMENT_EDITION,
    ALIBABA_API_KEY: process.env.ALIBABA_API_KEY,
    FAL_API_KEY: process.env.FAL_API_KEY,
    SAMSAR_API_KEY: process.env.SAMSAR_API_KEY,
    SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH: process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH,
  };

  process.env.CURRENT_ENV = 'standalone';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
  process.env.ALIBABA_API_KEY = 'configured';
  process.env.FAL_API_KEY = 'configured';
  delete process.env.SAMSAR_API_KEY;
  process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH = '/tmp/missing-model-adapter-preferences.json';

  try {
    const retryState = __testOnly__.getImageGenerationAdapterRetryState({
      model: 'WAN2.7PRO',
      adapterProvider: 'alibabaCloud',
      apiGenerationStatus: 'PENDING',
      apiRequestId: 'provider-request-1',
      externalProvider: 'alibabaCloud',
    });

    assert.equal(retryState.provider, 'fal');
    assert.equal(retryState.setFields.adapterProvider, 'fal');
    assert.equal(retryState.setFields.adapterProviderOverride, 'fal');
    assert.deepEqual(retryState.unsetFields, {
      apiRequestId: '',
      apiSubmittedAt: '',
      externalProvider: '',
    });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test('Nano Banana GMI routing preserves exact Pro ratios and bypasses only unsupported Pro ratios', (t) => {
  const environmentKeys = [
    'CURRENT_ENV',
    'SAMSAR_DEPLOYMENT_EDITION',
    'SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED',
    'SAMSAR_GENBLAZE_ENABLED',
    'SAMSAR_GENBLAZE_MODEL_CATALOG_PATH',
    'SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH',
    'FAL_API_KEY',
    'SAMSAR_API_KEY',
    'GOOGLE_APPLICATION_CREDENTIALS_JSON_B64',
    'GOOGLE_APPLICATION_CREDENTIALS_JSON',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'GOOGLE_CLOUD_PROJECT',
    'GOOGLE_PROJECT_ID',
    'GCP_PROJECT',
    'GCLOUD_PROJECT',
    'PROJECT_ID',
    'K_SERVICE',
    'GAE_SERVICE',
    'FUNCTION_TARGET',
  ];
  const previousEnvironment = Object.fromEntries(
    environmentKeys.map((key) => [key, process.env[key]]),
  );
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-nano-gmi-routing-'));
  const catalogPath = path.join(temporaryDirectory, 'catalog.json');
  const preferencesPath = path.join(temporaryDirectory, 'missing-preferences.json');

  t.after(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  fs.writeFileSync(catalogPath, JSON.stringify({
    version: 1,
    provider: 'gmicloud',
    models: {
      NANOBANANA2: { image: { modelId: 'gemini-3.1-flash-image' } },
      NANOBANANAPRO: { image: { modelId: 'gemini-3-pro-image' } },
    },
  }));
  process.env.CURRENT_ENV = 'standalone';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
  process.env.SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED = 'true';
  process.env.SAMSAR_GENBLAZE_ENABLED = 'true';
  process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH = catalogPath;
  process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH = preferencesPath;
  process.env.FAL_API_KEY = 'configured';
  delete process.env.SAMSAR_API_KEY;
  for (const key of environmentKeys.filter(
    (key) => key.startsWith('GOOGLE_') || key.startsWith('GCLOUD_') ||
      ['GCP_PROJECT', 'PROJECT_ID', 'K_SERVICE', 'GAE_SERVICE', 'FUNCTION_TARGET'].includes(key),
  )) {
    delete process.env[key];
  }

  assert.equal(
    __testOnly__.resolveImageProviderForModel('NANOBANANA2', { aspectRatio: '3:2' }),
    'gmicloud',
  );
  assert.equal(
    __testOnly__.resolveImageProviderForModel('NANOBANANAPRO', { aspectRatio: '4:5' }),
    'gmicloud',
  );
  assert.equal(
    __testOnly__.resolveImageProviderForModel('NANOBANANAPRO', { aspectRatio: '3:2' }),
    'fal',
  );
  assert.equal(
    __testOnly__.resolveImageProviderForModel('NANOBANANAPRO', {
      aspect_ratio: '2:3',
      adapterProviderOverride: 'gmicloud',
    }),
    'fal',
  );
  assert.equal(
    __testOnly__.resolveImageProviderForModel('NANOBANANAPRO', {
      aspectRatio: '3:2',
      adapterProviderOverride: 'gmicloud',
      apiRequestId: 'genblaze-image:already-submitted',
    }),
    'gmicloud',
  );

  const retryState = __testOnly__.getImageGenerationAdapterRetryState({
    model: 'NANOBANANAPRO',
    aspectRatio: '3:2',
    adapterProvider: 'samsar',
  });
  assert.equal(retryState.provider, 'fal');
});

test('production image retries never enable standalone adapter rotation', () => {
  const previousEdition = process.env.SAMSAR_DEPLOYMENT_EDITION;
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'production';

  try {
    assert.deepEqual(
      __testOnly__.getImageGenerationAdapterRetryState({
        model: 'WAN2.7PRO',
        adapterProvider: 'alibabaCloud',
      }),
      {
        provider: '',
        setFields: {},
        unsetFields: {},
      },
    );
  } finally {
    if (previousEdition === undefined) {
      delete process.env.SAMSAR_DEPLOYMENT_EDITION;
    } else {
      process.env.SAMSAR_DEPLOYMENT_EDITION = previousEdition;
    }
  }
});

test('standalone Image List enhancement retries advance edit adapters and clear stale requests', () => {
  const previous = {
    CURRENT_ENV: process.env.CURRENT_ENV,
    SAMSAR_DEPLOYMENT_EDITION: process.env.SAMSAR_DEPLOYMENT_EDITION,
    GOOGLE_APPLICATION_CREDENTIALS_JSON: process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON,
    FAL_API_KEY: process.env.FAL_API_KEY,
    SAMSAR_API_KEY: process.env.SAMSAR_API_KEY,
    SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH: process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH,
  };

  process.env.CURRENT_ENV = 'standalone';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
  process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = '{"type":"service_account"}';
  process.env.FAL_API_KEY = 'configured';
  process.env.SAMSAR_API_KEY = 'configured';
  process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH = '/tmp/missing-model-adapter-preferences.json';

  try {
    const retryState = __testOnly__.getImageEditAdapterRetryState({
      model: 'NANOBANANAPROEDIT',
      adapterProvider: 'googleCloud',
      apiEditStatus: 'PENDING',
      apiRequestId: 'google-native-nanobanana-edit:request-1',
    });

    assert.equal(retryState.provider, 'fal');
    assert.deepEqual(retryState.setFields, {
      adapterProvider: 'fal',
      adapterProviderOverride: 'fal',
    });
    assert.deepEqual(retryState.unsetFields, {
      apiRequestId: '',
      apiSubmittedAt: '',
      externalProvider: '',
    });
    assert.equal(
      __testOnly__.getImageEditAdapterRetryState({
        model: 'NANOBANANAPROEDIT',
        adapterProvider: 'samsar',
      }).provider,
      '',
    );
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test('production Image List enhancement retries never enable standalone edit-adapter rotation', () => {
  const previousEdition = process.env.SAMSAR_DEPLOYMENT_EDITION;
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'production';

  try {
    assert.deepEqual(
      __testOnly__.getImageEditAdapterRetryState({
        model: 'NANOBANANAPROEDIT',
        adapterProvider: 'googleCloud',
      }),
      {
        provider: '',
        setFields: {},
        unsetFields: {},
      },
    );
  } finally {
    if (previousEdition === undefined) {
      delete process.env.SAMSAR_DEPLOYMENT_EDITION;
    } else {
      process.env.SAMSAR_DEPLOYMENT_EDITION = previousEdition;
    }
  }
});

test('GenBlaze standalone generation persists its local download before publishing a result URL', async () => {
  const uploads = [];
  const resultUrl = await __testOnly__.resolveStandaloneGenerationResultUrl({
    image: 'generation_gmi.png',
    resultUrl: 'https://upstream.gmicloud.example/temporary.png',
    resultUrls: ['https://upstream.gmicloud.example/temporary.png'],
  }, {
    externalProvider: 'gmicloud',
    apiRequestId: 'genblaze-image:sealed-job',
  }, {
    getAssetsRoot: () => '/mounted/assets',
    uploadImage: async (absolutePath, remotePath) => {
      uploads.push({ absolutePath, remotePath });
      return 'https://f000.backblazeb2.com/file/samsar/temp_images/generations/generation_gmi.png';
    },
  });

  assert.equal(
    resultUrl,
    'https://f000.backblazeb2.com/file/samsar/temp_images/generations/generation_gmi.png',
  );
  assert.deepEqual(uploads, [{
    absolutePath: '/mounted/assets/generations/generation_gmi.png',
    remotePath: 'generations/generation_gmi.png',
  }]);
});

test('GenBlaze standalone edit request ids also replace temporary upstream result URLs', async () => {
  let uploadCount = 0;
  const resultUrl = await __testOnly__.resolveStandaloneGenerationResultUrl({
    image: 'generation_edit.png',
    resultUrl: 'https://upstream.gmicloud.example/edit.png',
  }, {
    apiRequestId: 'genblaze-image-edit:sealed-job',
  }, {
    getAssetsRoot: () => '/assets',
    uploadImage: async () => {
      uploadCount += 1;
      return 'https://public.example/persisted-edit.png';
    },
  });

  assert.equal(resultUrl, 'https://public.example/persisted-edit.png');
  assert.equal(uploadCount, 1);
  assert.equal(__testOnly__.isGenBlazeImageCompletion({
    apiRequestId: 'genblaze-image-edit:sealed-job',
  }), true);
});

test('non-GenBlaze adapters preserve their existing upstream result URL contract', async () => {
  let uploadCount = 0;
  const resultUrl = await __testOnly__.resolveStandaloneGenerationResultUrl({
    image: 'generation_native.png',
    resultUrl: 'https://native-provider.example/result.png',
  }, {
    externalProvider: 'fal',
  }, {
    getAssetsRoot: () => '/assets',
    uploadImage: async () => {
      uploadCount += 1;
      return 'https://should-not-be-used.example/result.png';
    },
  });

  assert.equal(resultUrl, 'https://native-provider.example/result.png');
  assert.equal(uploadCount, 0);
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

function buildBranchedPruneSession() {
  const layer = (id, duration) => ({
    _id: id,
    duration,
    layerBaseAiImageType: 'scene',
    layerAiVideoType: 'scene',
  });
  const timelineEntry = (layerId, sceneIndex, duration, durationOffset) => ({
    assetKey: `asset:${layerId}`,
    layerId,
    sceneIndex,
    sequenceIndex: sceneIndex,
    pathSequenceIndex: sceneIndex,
    duration,
    durationOffset,
    startTime: durationOffset,
    endTime: durationOffset + duration,
    frames: [`frame:${layerId}`],
    frameGenerationStatus: 'COMPLETED',
    frameGenerationPending: false,
  });
  const choice = ({ branchPointId, parentNodeId, nodeId, level, divergenceSceneIndex, switchAtSeconds }) => ({
    branchPointId,
    parentNodeId,
    nodeId,
    level,
    divergenceSceneIndex,
    switchAtSeconds,
    pathName: `Choose ${nodeId}`,
    pathDescription: `Continue through ${nodeId}.`,
  });
  const leftRootChoice = () => choice({
    branchPointId: 'branch:root',
    parentNodeId: 'root',
    nodeId: 'root.1',
    level: 1,
    divergenceSceneIndex: 0,
    switchAtSeconds: 4,
  });
  const rightRootChoice = () => choice({
    branchPointId: 'branch:root',
    parentNodeId: 'root',
    nodeId: 'root.2',
    level: 1,
    divergenceSceneIndex: 0,
    switchAtSeconds: 4,
  });
  const nestedChoice = (parentNodeId, nodeId, switchAtSeconds) => choice({
    branchPointId: `branch:${parentNodeId}`,
    parentNodeId,
    nodeId,
    level: 2,
    divergenceSceneIndex: 2,
    switchAtSeconds,
  });
  const makePath = ({ pathId, middleLayerId, branchRootLayerId, leafLayerId, duration }) => {
    const middleDuration = duration === 16 ? 4 : 5;
    const offsets = [0, 4, 4 + middleDuration, 4 + (middleDuration * 2)];
    const selectionTrail = pathId.startsWith('root.1')
      ? [leftRootChoice(), nestedChoice('root.1', pathId, 12)]
      : [rightRootChoice(), nestedChoice('root.2', pathId, 14)];
    return {
      pathId,
      leafNodeId: pathId,
      nodeIds: ['root', pathId.split('.').slice(0, 2).join('.'), pathId],
      duration,
      selectionTrail,
      branchPointId: selectionTrail[1].branchPointId,
      divergenceSceneIndex: 2,
      switchAtSeconds: selectionTrail[1].switchAtSeconds,
      timeline: [
        timelineEntry('shared-root', 0, 4, offsets[0]),
        timelineEntry(middleLayerId, 1, middleDuration, offsets[1]),
        timelineEntry(branchRootLayerId, 2, middleDuration, offsets[2]),
        timelineEntry(leafLayerId, 3, middleDuration, offsets[3]),
      ],
      audioTimeline: [
        {
          audioLayerId: branchRootLayerId === 'failed-branch-root'
            ? 'failed-audio'
            : `audio:${branchRootLayerId}`,
          connectedLayerId: branchRootLayerId,
          sceneIndex: 2,
          duration: middleDuration,
          startTime: offsets[2],
          endTime: offsets[2] + middleDuration,
        },
        {
          audioLayerId: `audio:${leafLayerId}`,
          connectedLayerId: leafLayerId,
          sceneIndex: 3,
          duration: middleDuration,
          startTime: offsets[3],
          endTime: offsets[3] + middleDuration,
        },
        {
          audioLayerId: 'music',
          duration,
          startTime: 0,
          endTime: duration,
        },
      ],
    };
  };
  const branchPoints = [
    {
      branchPointId: 'branch:root',
      parentNodeId: 'root',
      level: 1,
      divergenceSceneIndex: 0,
      divergencePaths: [
        { childNodeId: 'root.1', path_name: 'Left' },
        { childNodeId: 'root.2', path_name: 'Right' },
      ],
    },
    {
      branchPointId: 'branch:root.1',
      parentNodeId: 'root.1',
      level: 2,
      divergenceSceneIndex: 2,
      divergencePaths: [
        { childNodeId: 'root.1.1', path_name: 'Left one' },
        { childNodeId: 'root.1.2', path_name: 'Left two' },
      ],
    },
    {
      branchPointId: 'branch:root.2',
      parentNodeId: 'root.2',
      level: 2,
      divergenceSceneIndex: 2,
      divergencePaths: [
        { childNodeId: 'root.2.1', path_name: 'Right one' },
        { childNodeId: 'root.2.2', path_name: 'Right two' },
      ],
    },
  ];
  const branchRenderPaths = [
    makePath({
      pathId: 'root.1.1',
      middleLayerId: 'left-middle',
      branchRootLayerId: 'failed-branch-root',
      leafLayerId: 'left-leaf-one',
      duration: 16,
    }),
    makePath({
      pathId: 'root.1.2',
      middleLayerId: 'left-middle',
      branchRootLayerId: 'failed-branch-root',
      leafLayerId: 'left-leaf-two',
      duration: 16,
    }),
    makePath({
      pathId: 'root.2.1',
      middleLayerId: 'right-middle',
      branchRootLayerId: 'right-branch-root',
      leafLayerId: 'right-leaf-one',
      duration: 19,
    }),
    makePath({
      pathId: 'root.2.2',
      middleLayerId: 'right-middle',
      branchRootLayerId: 'right-branch-root',
      leafLayerId: 'right-leaf-two',
      duration: 19,
    }),
  ];
  const choicePoints = branchPoints.map((branchPoint) => ({
    branchPointId: branchPoint.branchPointId,
    parentNodeId: branchPoint.parentNodeId,
    level: branchPoint.level,
    divergenceSceneIndex: branchPoint.divergenceSceneIndex,
    switchAtSeconds: branchPoint.parentNodeId === 'root'
      ? 4
      : (branchPoint.parentNodeId === 'root.1' ? 12 : 14),
    options: branchPoint.divergencePaths.map((option, optionIndex) => ({
      childNodeId: option.childNodeId,
      branchOrdinal: optionIndex + 1,
      branchingHint: option.path_name,
      leafPathIds: branchRenderPaths
        .filter((path) => path.nodeIds.includes(option.childNodeId))
        .map((path) => path.pathId),
    })),
  }));

  return {
    isExpressGeneration: true,
    narrativeType: 'branched',
    defaultBranchPathId: 'root.1.1',
    layers: [
      layer('shared-root', 4),
      layer('left-middle', 4),
      layer('failed-branch-root', 4),
      layer('left-leaf-one', 4),
      layer('left-leaf-two', 4),
      layer('right-middle', 5),
      layer('right-branch-root', 5),
      layer('right-leaf-one', 5),
      layer('right-leaf-two', 5),
    ],
    audioLayers: [
      { _id: 'failed-audio', connectedLayerId: 'failed-branch-root', generationType: 'speech', duration: 4 },
      { _id: 'audio:left-leaf-one', connectedLayerId: 'left-leaf-one', generationType: 'speech', duration: 4 },
      { _id: 'audio:left-leaf-two', connectedLayerId: 'left-leaf-two', generationType: 'speech', duration: 4 },
      { _id: 'audio:right-branch-root', connectedLayerId: 'right-branch-root', generationType: 'speech', duration: 5 },
      { _id: 'audio:right-leaf-one', connectedLayerId: 'right-leaf-one', generationType: 'speech', duration: 5 },
      { _id: 'audio:right-leaf-two', connectedLayerId: 'right-leaf-two', generationType: 'speech', duration: 5 },
      { _id: 'music', generationType: 'music', duration: 19 },
    ],
    branchRenderPaths,
    branchingMeta: {
      rootNodeId: 'root',
      branchSceneIndices: [0, 2],
      branchPoints,
      leafNodeIds: branchRenderPaths.map((path) => path.pathId),
      nodeCount: 7,
    },
    branchingTimeline: {
      schemaVersion: 'branching_timeline.v1',
      timing: { origin: 'media', unit: 'seconds' },
      rootNodeId: 'root',
      defaultPathId: 'root.1.1',
      choicePoints,
    },
  };
}

test('branched prune moves a failed branch root to the previous scene without losing children', () => {
  const session = buildBranchedPruneSession();
  const sourceNodeIds = session.branchRenderPaths.map((path) => [...path.nodeIds]);
  const sourceLeftOptions = structuredClone(
    session.branchingTimeline.choicePoints[1].options,
  );
  const sourceRightPaths = structuredClone(session.branchRenderPaths.slice(2));

  const plan = __testOnly__.buildExpressLayerPrunePlan(
    session,
    'failed-branch-root',
  );

  assert.equal(plan.pruned, true);
  assert.equal(plan.branched, true);
  assert.equal(plan.branchRenderPaths.length, 4);
  assert.deepEqual(
    plan.branchRenderPaths.map((path) => path.nodeIds),
    sourceNodeIds,
    'narrative branch ancestry must remain intact',
  );
  assert.deepEqual(
    plan.branchRenderPaths.slice(2),
    sourceRightPaths,
    'sibling branch paths must not be retimed or rewritten',
  );
  assert.deepEqual(
    plan.layers.map((candidate) => candidate._id),
    session.layers.map((candidate) => candidate._id)
      .filter((candidateId) => candidateId !== 'failed-branch-root'),
  );
  assert.equal(plan.audioLayers.some((audio) => audio._id === 'failed-audio'), false);

  for (const path of plan.branchRenderPaths.slice(0, 2)) {
    assert.deepEqual(
      path.timeline.map((entry) => entry.layerId),
      ['shared-root', 'left-middle', path.pathId.endsWith('.1') ? 'left-leaf-one' : 'left-leaf-two'],
    );
    assert.deepEqual(path.timeline.map((entry) => entry.sceneIndex), [0, 1, 2]);
    assert.deepEqual(path.timeline.map((entry) => entry.sequenceIndex), [0, 1, 2]);
    assert.equal(path.duration, 12);
    assert.equal(path.selectionTrail[1].divergenceSceneIndex, 1);
    assert.equal(path.selectionTrail[1].switchAtSeconds, 8);
    assert.equal(path.timeline[2].durationOffset, 8);
    assert.equal(path.timeline[2].frameGenerationPending, true);
    assert.equal(path.timeline[2].frames.length, 0);
    assert.equal(path.audioTimeline.some((audio) => audio.audioLayerId === 'failed-audio'), false);
    assert.equal(path.audioTimeline.find((audio) => audio.audioLayerId === 'music').endTime, 12);
  }

  const leftBranchPoint = plan.branchingMeta.branchPoints.find(
    (branchPoint) => branchPoint.parentNodeId === 'root.1',
  );
  const rightBranchPoint = plan.branchingMeta.branchPoints.find(
    (branchPoint) => branchPoint.parentNodeId === 'root.2',
  );
  assert.equal(leftBranchPoint.divergenceSceneIndex, 1);
  assert.equal(rightBranchPoint.divergenceSceneIndex, 2);
  assert.deepEqual(plan.branchingMeta.branchSceneIndices, [0, null]);
  assert.deepEqual(leftBranchPoint.divergencePaths, session.branchingMeta.branchPoints[1].divergencePaths);

  const leftChoicePoint = plan.branchingTimeline.choicePoints.find(
    (choicePoint) => choicePoint.parentNodeId === 'root.1',
  );
  assert.equal(leftChoicePoint.divergenceSceneIndex, 1);
  assert.equal(leftChoicePoint.switchAtSeconds, 8);
  assert.deepEqual(leftChoicePoint.options, sourceLeftOptions);
  assert.equal(plan.totalDuration, 19, 'the longest unaffected sibling path remains authoritative');
});

test('branched prune reflows only the failed node path and its descendant leaves', () => {
  const session = buildBranchedPruneSession();
  const sourceRightPaths = structuredClone(session.branchRenderPaths.slice(2));
  const sourceRootOptions = structuredClone(
    session.branchingTimeline.choicePoints[0].options,
  );

  const plan = __testOnly__.buildExpressLayerPrunePlan(session, 'left-middle');

  assert.equal(plan.pruned, true);
  assert.deepEqual(plan.branchRenderPaths.slice(2), sourceRightPaths);
  assert.deepEqual(
    plan.branchRenderPaths.slice(0, 2).map((path) => path.timeline.map((entry) => entry.layerId)),
    [
      ['shared-root', 'failed-branch-root', 'left-leaf-one'],
      ['shared-root', 'failed-branch-root', 'left-leaf-two'],
    ],
  );
  assert.equal(plan.branchRenderPaths[0].selectionTrail[0].switchAtSeconds, 4);
  assert.equal(plan.branchRenderPaths[0].selectionTrail[1].divergenceSceneIndex, 1);
  assert.equal(plan.branchRenderPaths[0].selectionTrail[1].switchAtSeconds, 8);
  assert.equal(plan.branchRenderPaths[0].timeline[1].durationOffset, 4);
  assert.equal(plan.branchRenderPaths[0].timeline[2].durationOffset, 8);
  assert.deepEqual(plan.branchingTimeline.choicePoints[0].options, sourceRootOptions);
  assert.equal(plan.branchRenderPaths.every((path) => path.timeline.length === 3 || path.timeline.length === 4), true);
});

test('branched prune accepts hydrated mongoose session subdocuments without losing layer fields', () => {
  const fixture = buildBranchedPruneSession();
  const layerIdByName = new Map(fixture.layers.map((layer) => [
    layer._id,
    new Types.ObjectId(),
  ]));
  fixture.layers.forEach((layer) => {
    layer._id = layerIdByName.get(layer._id);
  });
  fixture.audioLayers.forEach((audioLayer) => {
    audioLayer._id = new Types.ObjectId();
    if (audioLayer.connectedLayerId) {
      audioLayer.connectedLayerId = layerIdByName.get(audioLayer.connectedLayerId).toString();
    }
  });
  fixture.branchRenderPaths.forEach((path) => {
    path.timeline.forEach((entry) => {
      entry.layerId = layerIdByName.get(entry.layerId).toString();
    });
    path.audioTimeline.forEach((entry) => {
      if (entry.connectedLayerId) {
        entry.connectedLayerId = layerIdByName.get(entry.connectedLayerId).toString();
      }
    });
  });
  const sessionDocument = new VideoSession(fixture);
  const failedLayerId = layerIdByName.get('failed-branch-root').toString();

  const plan = __testOnly__.buildExpressLayerPrunePlan(
    sessionDocument,
    failedLayerId,
  );

  assert.equal(plan.pruned, true);
  assert.equal(plan.layers.some((layer) => layer._id.toString() === failedLayerId), false);
  const followingLayerId = layerIdByName.get('left-leaf-one').toString();
  const followingLayer = plan.layers.find(
    (layer) => layer._id.toString() === followingLayerId,
  );
  assert.equal(followingLayer.duration, 4);
  assert.equal(followingLayer.layerBaseAiImageType, 'scene');
  assert.equal(followingLayer.frameGenerationPending, true);
});

test('branched prune preserves every branch when the first scene is the choice anchor', () => {
  const session = buildBranchedPruneSession();
  const sourceOptions = session.branchingTimeline.choicePoints.map(
    (choicePoint) => structuredClone(choicePoint.options),
  );

  const plan = __testOnly__.buildExpressLayerPrunePlan(session, 'shared-root');

  assert.equal(plan.pruned, true);
  assert.equal(plan.branchRenderPaths.length, 4);
  assert.equal(plan.branchRenderPaths.every((path) => path.timeline.length === 3), true);
  for (const path of plan.branchRenderPaths) {
    assert.equal(path.selectionTrail[0].divergenceSceneIndex, null);
    assert.equal(path.selectionTrail[0].switchAtSeconds, 0);
  }
  assert.equal(plan.branchingMeta.branchPoints[0].divergenceSceneIndex, null);
  assert.equal(plan.branchingTimeline.choicePoints[0].switchAtSeconds, 0);
  assert.deepEqual(
    plan.branchingTimeline.choicePoints.map((choicePoint) => choicePoint.options),
    sourceOptions,
  );
});
