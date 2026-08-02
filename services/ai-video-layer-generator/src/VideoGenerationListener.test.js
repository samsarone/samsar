import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildBaseAiVideoCompletionUpdate,
  buildBaseGenerationFailureMessage,
  buildDockerVideoAdapterRetryPlan,
  buildTransientProviderErrorUpdate,
  buildBaseGenerationTerminalFailureUpdate,
  getPendingPollIntervalMs,
  getExplicitFailureRetryBackoffMs,
  getInferenceModelForSession,
  getInferenceSettingsForSession,
  getRetryLipSyncModel,
  getRetryPromptSeedAction,
  isTransientProviderError,
  isSafeProviderSubmissionRetry,
  resolveCompletedLayerDuration,
  resolveConnectedAudioLayerDuration,
  selectFilterPassForBaseGenerationRetry,
  shouldRetryBaseGeneration,
  shouldUseAlibabaNativeHappyHorse,
} from './VideoGenerationListener.js';
import { isTransientMongoError } from './DBString.js';

test('base AI-video completion marks the generated media as available', () => {
  assert.deepEqual(buildBaseAiVideoCompletionUpdate({
    localVideoLink: '/assets/video.mp4',
    remoteAIVideoLink: 'https://static.example/video.mp4',
    startFrameGenerationPath: '/assets/start.png',
    lastFrameGenerationPath: '/assets/end.png',
    thumbnailVideoPath: '/assets/preview.mp4',
  }), {
    aiVideoGenerationPending: false,
    hasAiVideoLayer: true,
    aiVideoLayer: '/assets/video.mp4',
    aiVideoRemoteLink: 'https://static.example/video.mp4',
    aiVideoThumbnailPath: '/assets/start.png',
    aiVideoEndThumbnailPath: '/assets/end.png',
    aiVideoThumbnailVideo: '/assets/preview.mp4',
    aiVideoGenerationStatus: 'COMPLETED',
  });
});

test('base generation retry picks the next highest scored filter pass for each retry', () => {
  const passes = [
    { score: 0.45, src: 'low.png' },
    { score: 0.95, src: 'best.png' },
    { score: 0.72, src: 'middle.png' },
  ];

  assert.equal(selectFilterPassForBaseGenerationRetry(passes, 0).pass.src, 'best.png');
  assert.equal(selectFilterPassForBaseGenerationRetry(passes, 1).pass.src, 'middle.png');
  assert.equal(selectFilterPassForBaseGenerationRetry(passes, 2).pass.src, 'low.png');
});

test('base generation retry stops after unique filter passes are exhausted', () => {
  const passes = [
    { score: 10, src: 'best.png' },
    { score: 5, src: 'second.png' },
  ];

  const selected = selectFilterPassForBaseGenerationRetry(passes, 4);

  assert.equal(selected, null);
});

test('base generation retry excludes the active image before ranking fallbacks', () => {
  const passes = [
    { score: 10, src: 'generations/current.png', description: 'current' },
    { score: 8, src: 'assets/generations/fallback.png', description: 'fallback' },
  ];

  const selected = selectFilterPassForBaseGenerationRetry(passes, 0, {
    excludeSources: ['/generations/current.png'],
  });

  assert.equal(selected.pass.src, 'assets/generations/fallback.png');
  assert.equal(selected.pass.description, 'fallback');
});

test('legacy express Cosmos jobs retry even when the old queue row omitted the flag', () => {
  assert.equal(shouldRetryBaseGeneration({
    generation: { retryOnFail: false },
    videoSession: { isExpressGeneration: true },
    model: 'COSMOS3SUPERI2V',
  }), true);
  assert.equal(shouldRetryBaseGeneration({
    generation: { retryOnFail: false },
    videoSession: { isExpressGeneration: false },
    model: 'COSMOS3SUPERI2V',
  }), false);
});

test('terminal AI-video errors retain the provider moderation reason', () => {
  const message = buildBaseGenerationFailureMessage({
    tries: 2,
    providerFailureMessage: '400 Input text data may contain inappropriate content.',
  });

  assert.match(message, /failed after 3 attempts/);
  assert.match(message, /inappropriate content/);
});

test('Infinitezoom retries retain the resolved swirl and zoom strategy', () => {
  assert.equal(getRetryPromptSeedAction({
    promptSeedContext: {
      sceneAction: 'Original narrative action',
      resolvedPrompt: 'Camera swirls clockwise and zooms in',
      promptStrategy: 'infinitezoom',
    },
    currentLayer: { prompt: 'Current layer prompt' },
    fallbackPrompt: 'Previously generated prompt',
  }), 'Camera swirls clockwise and zooms in');

  assert.equal(getRetryPromptSeedAction({
    promptSeedContext: {
      sceneAction: 'Original narrative action',
      resolvedPrompt: 'Previously generated meta prompt',
      promptStrategy: 'image_to_video_meta_prompt',
    },
    currentLayer: { prompt: 'Current layer prompt' },
  }), 'Original narrative action');
});

test('session inference override wins for express generation retries', async () => {
  assert.equal(await getInferenceModelForSession({
    expressGenerationInferenceModel: 'Qwen 3.7',
    inferenceModel: 'gemini-3.1-pro',
  }), 'QWEN3.7');
  assert.equal(await getInferenceModelForSession({
    inferenceModel: 'gemini-3.1-pro',
  }), 'gemini-3.1-pro');
  assert.equal(await getInferenceModelForSession({
    expressGenerationInferenceModel: 'Kimi K3',
  }), 'kimi-k3');
});

test('request inference settings win over express session and account fallbacks', async () => {
  assert.deepEqual(await getInferenceSettingsForSession({
    expressGenerationInferenceModel: 'gemini-3.1-pro',
    expressGenerationInferenceModelAuthorization: 'deployed',
  }, {
    inferenceModel: 'Qwen 3.7',
    selectedInferenceModelAuthorization: 'native',
  }), {
    model: 'QWEN3.7',
    authorization: 'native',
  });
});

test('express session authorization wins over generic session authorization', async () => {
  assert.deepEqual(await getInferenceSettingsForSession({
    expressGenerationInferenceModel: 'Qwen 3.7',
    inferenceModel: 'gemini-3.1-pro',
    expressGenerationInferenceModelAuthorization: 'deployed',
    inferenceModelAuthorization: 'native',
  }), {
    model: 'QWEN3.7',
    authorization: 'deployed',
  });
});

test('connected audio duration is clamped to the connected scene duration', () => {
  assert.equal(
    resolveConnectedAudioLayerDuration({
      generationType: 'sound_effect',
      generatedAudioDuration: 11.4,
      layerDuration: 8,
    }),
    8,
  );
  assert.equal(
    resolveConnectedAudioLayerDuration({
      generationType: 'speech',
      generatedAudioDuration: 11.4,
      layerDuration: 8,
    }),
    8,
  );
});

test('lip-sync completion shrinks to materially shorter extracted frame duration', () => {
  assert.equal(
    resolveCompletedLayerDuration({
      currentLayerDuration: 4.87,
      generatedLayerDuration: 4.04,
      generatedFrameCount: 97,
      framesPerSecond: 24,
      model: 'SYNCLIPSYNC',
      isAudioVideoGeneration: true,
    }),
    4.041667,
  );
});

test('lip-sync completion keeps the existing duration for frame-rounding differences', () => {
  assert.equal(
    resolveCompletedLayerDuration({
      currentLayerDuration: 4.87,
      generatedLayerDuration: 4.875,
      generatedFrameCount: 117,
      framesPerSecond: 24,
      model: 'SYNCLIPSYNC',
      isAudioVideoGeneration: true,
    }),
    4.87,
  );
});

test('lip-sync retries alternate between the two fallback models', () => {
  assert.equal(getRetryLipSyncModel('SYNCLIPSYNC'), 'HUMMINGBIRDLIPSYNC');
  assert.equal(getRetryLipSyncModel('HUMMINGBIRDLIPSYNC'), 'SYNCLIPSYNC');
  assert.equal(getRetryLipSyncModel('KLINGLIPSYNC'), 'KLINGLIPSYNC');
});

test('non-lip-sync completion follows generated duration', () => {
  assert.equal(
    resolveCompletedLayerDuration({
      currentLayerDuration: 4.87,
      generatedLayerDuration: 2.16,
      model: 'COSMOS3SUPERI2V',
      isAudioVideoGeneration: false,
    }),
    2.16,
  );
});

test('terminal base failure leaves express session active for delete reflow', () => {
  const update = buildBaseGenerationTerminalFailureUpdate(
    { layerAiVideoType: 'narration' },
    'AI video generation failed after 4 attempts.'
  );

  assert.equal(update['layers.$.aiVideoGenerationStatus'], 'FAILED');
  assert.equal(update['layers.$.aiVideoGenerationPending'], false);
  assert.equal(update['expressGenerationStatus.delete_reflow'], 'INIT');
  assert.equal(update['expressGenerationStatus.timeline_reflowed'], 'INIT');
  assert.equal(Object.hasOwn(update, 'expressGenerationPending'), false);
  assert.equal(Object.hasOwn(update, 'expressGenerationFailed'), false);
  assert.equal(Object.hasOwn(update, 'expressGenerationStatus.status'), false);
  assert.equal(Object.hasOwn(update, 'expressGenerationStatus.ai_video_generation'), false);
});

test('terminal character base failure also disables pending lip sync on that layer', () => {
  const update = buildBaseGenerationTerminalFailureUpdate(
    { layerAiVideoType: 'character' },
    'AI video generation failed after 4 attempts.'
  );

  assert.equal(update['layers.$.lipSyncGenerationPending'], false);
});

test('Runway polling 429 is treated as transient provider backoff, not failure', () => {
  const error = {
    message: 'Request failed with status code 429',
    response: {
      status: 429,
      headers: { 'retry-after': '12' },
    },
  };

  assert.equal(isTransientProviderError(error), true);

  const update = buildTransientProviderErrorUpdate(
    { status: 'PENDING', transientProviderErrorCount: 0 },
    error,
    'poll'
  );

  assert.equal(update.set.status, 'PENDING');
  assert.equal(update.set.rowLocked, false);
  assert.equal(update.set.lastTransientProviderErrorStatus, 429);
  assert.equal(update.set.transientProviderErrorPhase, 'poll');
  assert.deepEqual(update.inc, { transientProviderErrorCount: 1 });
  assert.ok(update.set.nextAttemptAfter instanceof Date);
  assert.equal(Object.hasOwn(update.set, 'numRetries'), false);
});

test('image-to-video 429 retries the same adapter and stops after three explicit rejections', () => {
  const request = {
    model: 'COSMOS3SUPERI2V',
    prompt: 'Keep this exact prompt',
    startImage: '/persistent/assets/start.png',
    status: 'INIT',
    transientProviderErrorCount: 0,
  };
  const rateLimitError = {
    message: 'rate limited',
    response: { status: 429, headers: {} },
  };

  assert.equal(isSafeProviderSubmissionRetry(rateLimitError), true);
  const firstRejection = buildTransientProviderErrorUpdate(
    request,
    rateLimitError,
    'submit',
  );
  assert.equal(firstRejection.set.status, 'INIT');
  assert.equal(firstRejection.set.transientProviderErrorExhausted, false);

  const thirdRejection = buildTransientProviderErrorUpdate({
    ...request,
    transientProviderErrorCount: 2,
  }, rateLimitError, 'submit');
  assert.equal(thirdRejection.set.status, 'FAILED');
  assert.equal(thirdRejection.set.retryOnFail, false);
  assert.equal(thirdRejection.set.transientProviderErrorExhausted, true);
  assert.equal(thirdRejection.set.providerFailureDefinitive, true);
  assert.equal(thirdRejection.set.submissionOutcomeUnknown, false);
});

test('image-to-video submit 503 is not safe to resubmit because acceptance is ambiguous', () => {
  const error = {
    message: 'Service unavailable',
    response: { status: 503, headers: {} },
  };

  assert.equal(isTransientProviderError(error), true);
  assert.equal(isSafeProviderSubmissionRetry(error), false);
});

test('nested fetch network failures are treated as transient provider errors', () => {
  const error = new TypeError('fetch failed', {
    cause: Object.assign(new Error('socket reset'), { code: 'ECONNRESET' }),
  });

  assert.equal(isTransientProviderError(error), true);
});

test('standalone text-to-video 429 uses the same bounded safe-submit retry contract', (t) => {
  const previousEdition = process.env.SAMSAR_DEPLOYMENT_EDITION;
  const previousEnvironment = process.env.CURRENT_ENV;
  t.after(() => {
    if (previousEdition === undefined) delete process.env.SAMSAR_DEPLOYMENT_EDITION;
    else process.env.SAMSAR_DEPLOYMENT_EDITION = previousEdition;
    if (previousEnvironment === undefined) delete process.env.CURRENT_ENV;
    else process.env.CURRENT_ENV = previousEnvironment;
  });
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
  process.env.CURRENT_ENV = 'standalone';

  const request = {
    model: 'VEO3.1',
    prompt: 'A landscape at sunrise',
    status: 'INIT',
    transientProviderErrorCount: 2,
  };
  const rateLimitError = {
    message: 'rate limited',
    response: { status: 429, headers: {} },
  };

  const thirdRejection = buildTransientProviderErrorUpdate(
    request,
    rateLimitError,
    'submit',
  );
  assert.equal(thirdRejection.set.status, 'FAILED');
  assert.equal(thirdRejection.set.providerFailureDefinitive, true);
  assert.equal(thirdRejection.set.submissionOutcomeUnknown, false);
});

test('hosted text-to-video retains the existing provider retry budget', (t) => {
  const previousEdition = process.env.SAMSAR_DEPLOYMENT_EDITION;
  const previousEnvironment = process.env.CURRENT_ENV;
  t.after(() => {
    if (previousEdition === undefined) delete process.env.SAMSAR_DEPLOYMENT_EDITION;
    else process.env.SAMSAR_DEPLOYMENT_EDITION = previousEdition;
    if (previousEnvironment === undefined) delete process.env.CURRENT_ENV;
    else process.env.CURRENT_ENV = previousEnvironment;
  });
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'production';
  process.env.CURRENT_ENV = 'production';

  const update = buildTransientProviderErrorUpdate({
    model: 'VEO3.1',
    status: 'INIT',
    transientProviderErrorCount: 2,
  }, {
    message: 'rate limited',
    response: { status: 429, headers: {} },
  }, 'submit');

  assert.equal(update.set.status, 'INIT');
  assert.equal(update.set.transientProviderErrorExhausted, false);
});

test('definitive standalone failures rotate through the saved adapter order', (t) => {
  const envKeys = [
    'CURRENT_ENV',
    'SAMSAR_DEPLOYMENT_EDITION',
    'SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH',
    'ALIBABA_API_KEY',
    'FAL_API_KEY',
    'SAMSAR_API_KEY',
  ];
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-video-retry-plan-'));
  const preferencesPath = path.join(temporaryDirectory, 'model-adapter-preferences.json');
  t.after(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    envKeys.forEach((key) => {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    });
  });
  fs.writeFileSync(preferencesPath, JSON.stringify({
    modelProviderPriority: {
      HAPPYHORSEI2V: ['alibabaCloud', 'fal', 'samsar'],
      'VEO3.1': ['samsar', 'fal'],
    },
  }));
  process.env.CURRENT_ENV = 'standalone';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
  process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH = preferencesPath;
  process.env.ALIBABA_API_KEY = 'alibaba-key';
  process.env.FAL_API_KEY = 'fal-key';
  process.env.SAMSAR_API_KEY = 'samsar-key';

  assert.deepEqual(buildDockerVideoAdapterRetryPlan({
    model: 'HAPPYHORSEI2V',
    startImage: '/persistent/assets/start.png',
    dockerVideoProvider: 'alibabaCloud',
    providerFailureDefinitive: true,
  }), {
    model: 'HAPPYHORSEI2V',
    currentProvider: 'alibabaCloud',
    nextProvider: 'fal',
    attemptedProviders: ['alibabaCloud'],
  });

  assert.deepEqual(buildDockerVideoAdapterRetryPlan({
    model: 'HAPPYHORSEI2V',
    startImage: '/persistent/assets/start.png',
    dockerVideoProvider: 'fal',
    dockerAdapterAttemptedProviders: ['alibabaCloud'],
    providerFailureDefinitive: true,
  }), {
    model: 'HAPPYHORSEI2V',
    currentProvider: 'fal',
    nextProvider: 'samsar',
    attemptedProviders: ['alibabaCloud', 'fal'],
  });

  assert.deepEqual(buildDockerVideoAdapterRetryPlan({
    model: 'VEO3.1',
    prompt: 'A landscape at sunrise',
    dockerVideoProvider: 'samsar',
    providerFailureDefinitive: true,
  }), {
    model: 'VEO3.1',
    currentProvider: 'samsar',
    nextProvider: 'fal',
    attemptedProviders: ['samsar'],
  });
});

test('adapter retry plan refuses ambiguous submissions and hosted production', (t) => {
  const envKeys = [
    'CURRENT_ENV',
    'SAMSAR_DEPLOYMENT_EDITION',
    'SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED',
    'FAL_API_KEY',
    'SAMSAR_API_KEY',
  ];
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  t.after(() => {
    envKeys.forEach((key) => {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    });
  });
  process.env.CURRENT_ENV = 'standalone';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
  process.env.FAL_API_KEY = 'fal-key';
  process.env.SAMSAR_API_KEY = 'samsar-key';

  const ambiguousRequest = {
    model: 'COSMOS3SUPERI2V',
    startImage: '/persistent/assets/start.png',
    dockerVideoProvider: 'fal',
    providerFailureDefinitive: true,
    submissionOutcomeUnknown: true,
  };
  assert.equal(buildDockerVideoAdapterRetryPlan(ambiguousRequest), null);

  process.env.CURRENT_ENV = 'production';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'production';
  process.env.SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED = 'true';
  assert.equal(buildDockerVideoAdapterRetryPlan({
    ...ambiguousRequest,
    submissionOutcomeUnknown: false,
  }), null);
});

test('Samsar external pending video status uses a three-second polling cadence', () => {
  assert.equal(
    getPendingPollIntervalMs('SAMSAR_EXTERNAL_VIDEO', {
      samsarExternalProvider: true,
    }),
    3000,
  );
});

test('explicit provider failures use deterministic exponential retry backoff', () => {
  assert.equal(getExplicitFailureRetryBackoffMs(0), 10000);
  assert.equal(getExplicitFailureRetryBackoffMs(1), 20000);
  assert.equal(getExplicitFailureRetryBackoffMs(2), 40000);
  assert.equal(getExplicitFailureRetryBackoffMs(3), 60000);
});

test('an unreachable managed media tunnel defers provider submission for retry', () => {
  const error = Object.assign(new Error('fresh provider media URL unavailable'), {
    code: 'SAMSAR_MEDIA_TUNNEL_UNREACHABLE',
    retryable: true,
  });

  assert.equal(isTransientProviderError(error), true);
  const update = buildTransientProviderErrorUpdate(
    { status: 'INIT', transientProviderErrorCount: 0 },
    error,
    'submit',
  );
  assert.equal(update.set.status, 'INIT');
  assert.equal(update.set.rowLocked, false);
  assert.equal(update.set.transientProviderErrorPhase, 'submit');
  assert.equal(update.set.transientProviderErrorExhausted, false);
  assert.deepEqual(update.inc, { mediaTunnelRefreshErrorCount: 1 });
  assert.equal(Object.hasOwn(update.inc, 'transientProviderErrorCount'), false);
});

test('managed media tunnel refreshes never exhaust the provider retry budget', () => {
  const error = Object.assign(new Error('fresh provider media URL unavailable'), {
    code: 'SAMSAR_MEDIA_TUNNEL_UNREACHABLE',
    retryable: true,
  });

  const update = buildTransientProviderErrorUpdate(
    {
      status: 'INIT',
      model: 'SYNCLIPSYNC',
      transientProviderErrorCount: 99,
      mediaTunnelRefreshErrorCount: 12,
    },
    error,
    'submit',
  );

  assert.equal(update.set.status, 'INIT');
  assert.equal(update.set.nextAttemptAfter instanceof Date, true);
  assert.equal(update.set.transientProviderErrorExhausted, false);
  assert.deepEqual(update.inc, { mediaTunnelRefreshErrorCount: 1 });
});

test('repeated transient provider errors are promoted to FAILED for normal retry handling', () => {
  const error = {
    message: 'Internal Server Error',
    response: { status: 500, headers: {} },
  };

  const update = buildTransientProviderErrorUpdate(
    { status: 'PENDING', transientProviderErrorCount: 99 },
    error,
    'poll'
  );

  assert.equal(update.set.status, 'FAILED');
  assert.equal(update.set.rowLocked, false);
  assert.equal(update.set.nextAttemptAfter, null);
  assert.equal(update.set.transientProviderErrorExhausted, true);
  assert.equal(Object.hasOwn(update.set, 'numRetries'), false);
});

test('stale base provider polling transient errors are promoted to FAILED', () => {
  const error = {
    message: 'Internal Server Error',
    response: { status: 500, headers: {} },
  };

  const update = buildTransientProviderErrorUpdate(
    {
      status: 'PENDING',
      model: 'HAPPYHORSEI2V',
      transientProviderErrorCount: 1,
      requestSubmitAt: new Date(Date.now() - 31 * 60 * 1000),
    },
    error,
    'poll'
  );

  assert.equal(update.set.status, 'FAILED');
  assert.equal(update.set.transientProviderErrorExhausted, true);
});

test('hosted Happy Horse uses FAL even when native Alibaba routing is configured', () => {
  const originalCurrentEnv = process.env.CURRENT_ENV;
  const originalDockerRouting = process.env.SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED;
  const originalAlibabaApiKey = process.env.ALIBABA_API_KEY;
  const originalFalApiKey = process.env.FAL_API_KEY;
  try {
    process.env.CURRENT_ENV = 'production';
    process.env.SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED = 'true';
    process.env.ALIBABA_API_KEY = 'alibaba-key';
    process.env.FAL_API_KEY = 'fal-key';

    assert.equal(shouldUseAlibabaNativeHappyHorse({ model: 'HAPPYHORSEI2V' }), false);
  } finally {
    if (originalCurrentEnv === undefined) delete process.env.CURRENT_ENV;
    else process.env.CURRENT_ENV = originalCurrentEnv;
    if (originalDockerRouting === undefined) delete process.env.SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED;
    else process.env.SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED = originalDockerRouting;
    if (originalAlibabaApiKey === undefined) delete process.env.ALIBABA_API_KEY;
    else process.env.ALIBABA_API_KEY = originalAlibabaApiKey;
    if (originalFalApiKey === undefined) delete process.env.FAL_API_KEY;
    else process.env.FAL_API_KEY = originalFalApiKey;
  }
});

test('Docker Happy Horse uses native Alibaba only when it wins provider priority', () => {
  const originalCurrentEnv = process.env.CURRENT_ENV;
  const originalPreferencesPath = process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH;
  const originalAlibabaApiKey = process.env.ALIBABA_API_KEY;
  const originalFalApiKey = process.env.FAL_API_KEY;
  try {
    process.env.CURRENT_ENV = 'docker';
    process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH = path.join(
      os.tmpdir(),
      `samsar-no-saved-video-providers-${process.pid}.json`,
    );
    process.env.ALIBABA_API_KEY = 'alibaba-key';
    process.env.FAL_API_KEY = 'fal-key';
    assert.equal(shouldUseAlibabaNativeHappyHorse({ model: 'HAPPYHORSEI2V' }), true);
    assert.equal(shouldUseAlibabaNativeHappyHorse({
      model: 'HAPPYHORSEI2V',
      dockerVideoProviderOverride: 'fal',
    }), false);

    delete process.env.ALIBABA_API_KEY;
    assert.equal(shouldUseAlibabaNativeHappyHorse({ model: 'HAPPYHORSEI2V' }), false);
  } finally {
    if (originalCurrentEnv === undefined) delete process.env.CURRENT_ENV;
    else process.env.CURRENT_ENV = originalCurrentEnv;
    if (originalPreferencesPath === undefined) delete process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH;
    else process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH = originalPreferencesPath;
    if (originalAlibabaApiKey === undefined) delete process.env.ALIBABA_API_KEY;
    else process.env.ALIBABA_API_KEY = originalAlibabaApiKey;
    if (originalFalApiKey === undefined) delete process.env.FAL_API_KEY;
    else process.env.FAL_API_KEY = originalFalApiKey;
  }
});

test('Happy Horse polling keeps persisted native and legacy FAL task routing stable', () => {
  assert.equal(shouldUseAlibabaNativeHappyHorse({
    model: 'HAPPYHORSEI2V',
    generationId: 'alibaba-happyhorse:task-123',
  }), true);
  assert.equal(shouldUseAlibabaNativeHappyHorse({
    model: 'HAPPYHORSEI2V',
    generationId: 'legacy-fal-request-id',
  }), false);
});

test('Mongo server selection timeouts are treated as transient DB errors', () => {
  const error = {
    name: 'MongoServerSelectionError',
    message: 'connection timed out',
    cause: {
      name: 'MongoNetworkTimeoutError',
      message: 'connection timed out',
    },
  };

  assert.equal(isTransientMongoError(error), true);
});

test('non-Mongo application errors are not treated as transient DB errors', () => {
  const error = new Error('Provider returned invalid payload');

  assert.equal(isTransientMongoError(error), false);
});
