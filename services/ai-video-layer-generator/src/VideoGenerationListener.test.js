import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBaseGenerationFailureMessage,
  buildTransientProviderErrorUpdate,
  buildBaseGenerationTerminalFailureUpdate,
  getInferenceModelForSession,
  getInferenceSettingsForSession,
  getRetryPromptSeedAction,
  isTransientProviderError,
  resolveCompletedLayerDuration,
  resolveConnectedAudioLayerDuration,
  selectFilterPassForBaseGenerationRetry,
  shouldRetryBaseGeneration,
  shouldUseAlibabaNativeHappyHorse,
} from './VideoGenerationListener.js';
import { isTransientMongoError } from './DBString.js';

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

test('provider submit 503 is held in INIT for retry without consuming generation retries', () => {
  const error = {
    message: 'Service unavailable',
    response: { status: 503, headers: {} },
  };

  const update = buildTransientProviderErrorUpdate(
    { status: 'INIT', transientProviderErrorCount: 2 },
    error,
    'submit'
  );

  assert.equal(isTransientProviderError(error), true);
  assert.equal(update.set.status, 'INIT');
  assert.equal(update.set.lastTransientProviderErrorStatus, 503);
  assert.equal(update.set.transientProviderErrorPhase, 'submit');
  assert.equal(Object.hasOwn(update.set, 'numRetries'), false);
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
  const originalAlibabaApiKey = process.env.ALIBABA_API_KEY;
  const originalFalApiKey = process.env.FAL_API_KEY;
  try {
    process.env.CURRENT_ENV = 'docker';
    process.env.ALIBABA_API_KEY = 'alibaba-key';
    process.env.FAL_API_KEY = 'fal-key';
    assert.equal(shouldUseAlibabaNativeHappyHorse({ model: 'HAPPYHORSEI2V' }), true);

    delete process.env.ALIBABA_API_KEY;
    assert.equal(shouldUseAlibabaNativeHappyHorse({ model: 'HAPPYHORSEI2V' }), false);
  } finally {
    if (originalCurrentEnv === undefined) delete process.env.CURRENT_ENV;
    else process.env.CURRENT_ENV = originalCurrentEnv;
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
