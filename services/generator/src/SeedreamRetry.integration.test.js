import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import OpenAI from 'openai';

import { handleSeedreamRequest, pollSeedreamRequest, submitSeedreamRequest } from './providers/Seedream.js';
import { isSafetyRejectionMessage } from './utils/ImageFailureClassification.js';
import { getAlternatePromptFromPrompt } from './OpenAI.js';
import {
  deferAcceptedImagePoll,
  observeImageSubmissionFailure,
  runImageSubmissionAttempt,
} from './utils/ImageSubmissionAttempt.js';

const imageSource = fs.readFileSync(new URL('./Image.js', import.meta.url), 'utf8');

// Exercise the actual queue/recovery functions with isolated persistence and
// provider boundaries. Importing the live worker entrypoint would start its loop.
function workerFunction(name) {
  const declaration = new RegExp(`(?:export )?(?:async )?function ${name}\\(`);
  const start = imageSource.search(declaration);
  assert.notEqual(start, -1, `worker function ${name} exists`);
  const rest = imageSource.slice(start);
  const next = rest.search(/\n(?:export )?(?:async )?function /);
  return (next < 0 ? rest : rest.slice(0, next)).replace(/^export /, '');
}

function fixture({ legacy = false, accepted = false, generationRetryCount = 0, prune = false, rewritePrompt } = {}) {
  let now = 1_000_000;
  const row = {
    _id: 'image-job', videoSessionId: 'video-session', layerId: 'scene-five',
    model: 'SEEDREAM', operationType: 'GENERATE', isBatchGeneration: true,
    prompt: 'A weathered train inside an underground repair depot.',
    generationStatus: 'INIT', apiGenerationStatus: 'INIT', rowLocked: false,
    failureRetryCount: 0, filterRetryCount: 0, generationRetryCount,
    ...(accepted ? { generationStatus: 'PENDING', apiGenerationStatus: 'PENDING',
      apiRequestId: 'already-accepted', apiSubmittedAt: new Date(now - 1000),
      ...(!legacy ? { imageSubmissionAttempt: {
        version: 1, state: 'ACCEPTED', token: 'accepted-owner',
        operation: 'GENERATE', attempt: '0:0:0:0', filterAttempt: '0:0:0',
      } } : {}),
    } : {}),
  };
  const session = { _id: row.videoSessionId, layers: [{ _id: row.layerId, filterPasses: [] }],
    ...(prune ? { isExpressGeneration: true, __v: 0, expressGenerationPending: true,
      expressGenerationFailed: false, expressGenerationStatus: { image_generation: 'PENDING', status: 'PENDING' },
      layers: [
        { _id: 'accepted-before', duration: 4, durationOffset: 0, imageSession: { generationStatus: 'COMPLETED', activeGeneratedImage: 'before.png' } },
        { _id: row.layerId, duration: 6, durationOffset: 4, filterPasses: [], imageSession: { generationStatus: 'PENDING' } },
        { _id: 'accepted-after', duration: 5, durationOffset: 10, imageSession: { generationStatus: 'COMPLETED', activeGeneratedImage: 'after.png' },
          aiVideoGenerationStatus: 'COMPLETED', aiVideoLayer: 'after.mp4' },
      ], audioLayers: [
        { _id: 'before-speech', connectedLayerId: 'accepted-before', startTime: 0, endTime: 3, duration: 3 },
        { _id: 'failed-speech', connectedLayerId: row.layerId, startTime: 4, endTime: 9, duration: 5 },
        { _id: 'after-speech', connectedLayerId: 'accepted-after', startTime: 11, endTime: 14, duration: 3 },
      ] } : {}),
  };
  const updates = [], rewrites = [], terminal = [], submittedPrompts = [], prunedQueues = [], sessionUpdates = [];
  const read = (object, key) => key.split('.').reduce((value, part) => value?.[part], object);
  function write(object, key, value) {
    const parts = key.split('.'), field = parts.pop();
    const parent = parts.reduce((value, part) => value[part] ||= {}, object);
    parent[field] = structuredClone(value);
  }
  function matches(filter) {
    return Object.entries(filter).every(([key, expected]) => {
      if (key === '$or') return expected.some(matches);
      const actual = read(row, key);
      if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
        if ('$exists' in expected) return expected.$exists === (actual !== undefined);
        if ('$in' in expected) return expected.$in.includes(actual);
        if ('$ne' in expected) return actual !== expected.$ne;
      }
      return expected === null ? actual == null : actual === expected;
    });
  }
  function apply(update, target = row) {
    for (const [key, value] of Object.entries(update.$set || {})) write(target, key, value);
    for (const key of Object.keys(update.$unset || {})) {
      const parts = key.split('.'), field = parts.pop();
      const parent = parts.reduce((value, part) => value?.[part], target);
      if (parent) delete parent[field];
    }
    for (const [key, value] of Object.entries(update.$push || {})) {
      target[key] ||= [];
      target[key].push(...structuredClone(value.$each));
      if (value.$slice < 0) target[key] = target[key].slice(value.$slice);
    }
    for (const [key, value] of Object.entries(update.$inc || {})) write(target, key, (read(target, key) || 0) + value);
  }
  const Model = {
    async updateOne(filter, update) {
      if (!matches(filter)) return { matchedCount: 0 };
      apply(update);
      updates.push(structuredClone(update));
      return { matchedCount: 1 };
    },
    async findByIdAndUpdate(id, update) { assert.equal(id, row._id); apply({ $set: update }); },
    async findOneAndUpdate(filter, update) {
      assert.equal(filter._id, row._id);
      apply({ $set: update });
    },
    async findOne() { return structuredClone(row); },
    findById() { return { lean: async () => structuredClone(row) }; },
    async deleteMany(filter) { prunedQueues.push(structuredClone(filter)); return { deletedCount: 1 }; },
  };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const functionNames = [
    'normalizeRetryCount', 'normalizeString', 'normalizePromptForComparison',
    'getImageGenerationRetryCount', 'getImageGenerationRetryPlan',
    'getImageGenerationRetryDelayMs', 'getImageGenerationNextAttemptAfter',
    'getImageGenerationFailureMessage', 'hasUnsafeImageSubmissionOutcome',
    'getAlteredPromptForRetry',
    'buildFailureHistoryEntry', 'recordImageGenerationFailure',
    'getImageGenerationAdapterRetryState', 'shouldPreserveExpressImageLayerOnFailure',
    'shouldRetryUnhandledGenerationTask', 'recoverUnhandledGenerationTask',
    'scheduleImageGenerationRetry', 'handleNoImageRetryOrFailure',
    'getTerminalGenerationPruneOptions',
    ...(prune ? ['markImageGenerationRequestFailed', 'pruneExpressImageLayerAfterFailure',
      'buildExpressLayerPrunePlan', 'isPrunableExpressImageLayer', 'isBranchedVideoSession',
      'getImageLayerVisualState', 'hasCompletedLayerVisual', 'isExpressImageFailureSessionStopped',
      'findImageFailureVideoSession', 'cloneDocumentObject', 'getExpressImageFailureUpdate',
      'reflowLayersAndConnectedAudio', 'clampAudioLayersToTimeline', 'getAudioLayerDuration',
      'getConnectedAudioRelativeStart'] : []),
  ];
  const context = vm.createContext({
    Date: Clock, MAX_IMAGE_GENERATION_RETRIES: 3, MAX_IMAGE_GENERATION_FAILURES: 4,
    MAX_IMAGE_GENERATION_FILTER_RETRIES: 4, IMAGE_GENERATION_RETRY_BASE_DELAY_MS: 2000,
    IMAGE_GENERATION_RETRY_MAX_DELAY_MS: 30000, FAILURE_HISTORY_LIMIT: 10,
    ImageGeneration: Model, VideoSession: {
      findOne: async () => structuredClone(session),
      async updateOne(filter, update) {
        assert.equal(filter._id, session._id);
        if (filter.__v !== undefined && filter.__v !== session.__v) return { modifiedCount: 0 };
        if (filter['layers._id'] && !session.layers.some(layer => layer._id === filter['layers._id'])) return { modifiedCount: 0 };
        apply(update, session); sessionUpdates.push(structuredClone(update));
        return { modifiedCount: 1 };
      },
    },
    observeImageSubmissionFailure: (payload, error, options) => observeImageSubmissionFailure(payload, error, { ...options, Model }),
    deferAcceptedImagePoll: payload => deferAcceptedImagePoll(payload, { Model, now }),
    isStandaloneEdition: () => false,
    isSafetyRejectionMessage,
    resolveImageInferenceSettings: async () => ({ model: 'gpt-6.2-astra', authorization: 'native' }),
    getAlternatePromptFromPrompt: async (prompt, retryCount, failureMessage, ...args) => {
      rewrites.push({ prompt, retryCount, failureMessage });
      if (rewritePrompt) return rewritePrompt(prompt, retryCount, failureMessage, ...args);
      return `${prompt} Repair composition and geometry for attempt ${retryCount}.`;
    },
    getTimeout: async () => {}, removeTaskFromQueueById() {},
    isAvatarVoiceoverImageRequest: () => false, isExpressNarratorAvatarImageRequest: () => false,
    getTerminalFilterFailurePolicy: () => ({ fallbackScoreCutoff: 50 }),
    processBestFilterPassIfAvailable: async () => false,
    updateLayerPromptForRetry: async (_payload, prompt) => { session.layers.find(layer => layer._id === row.layerId).prompt = prompt; },
    markVideoGlobalSessionFailed: async () => assert.fail('a pruned scene must not fail the whole session'),
    markImageGenerationRequestFailed: async (_payload, data, options) => {
      terminal.push({ data, options });
      apply({ $set: { generationStatus: 'FAILED', apiGenerationStatus: 'FAILED',
        rowLocked: false, ...options.setFields } });
    },
    console: { error() {}, warn() {} },
  });
  const worker = vm.runInContext(`${functionNames.map(workerFunction).join('\n')}\n({
    handleNoImageRetryOrFailure, recoverUnhandledGenerationTask,
  })`, context);
  const dependencies = {
    connect: async () => {}, imageGenerationModel: Model,
    logger: { error() {} },
    queueSubmit: async (_endpoint, request) => {
      assert.ok(!row.nextAttemptAfter || now >= row.nextAttemptAfter.getTime(), 'backoff must elapse before a new submission');
      submittedPrompts.push(request.input.prompt);
      return { request_id: `accepted-${submittedPrompts.length}` };
    },
    queueStatus: async () => ({ status: 'COMPLETED' }),
    queueResult: async () => { throw Object.assign(new Error('Unprocessable Entity'), {
      status: 422, body: { detail: [{ msg: 'Generated image failed provider validation.' }] },
    }); },
    saveFile: async () => assert.fail('a rejected result cannot be downloaded'),
  };
  dependencies.submitRequest = payload => submitSeedreamRequest(payload, dependencies);
  dependencies.pollRequest = payload => pollSeedreamRequest(payload, dependencies);
  return { row, worker, Model, dependencies, updates, rewrites, terminal, submittedPrompts,
    now: () => now, advanceTo: value => { now = Number(value); },
    payload: () => structuredClone(row), session, prunedQueues, sessionUpdates };
}

test('Seedream completed-result 422 repairs prompts with 2/4/8s backoff and stops after four total submissions', async () => {
  const f = fixture(), delays = [], requestIds = [];
  for (let attempt = 1; attempt <= 4; attempt++) {
    await runImageSubmissionAttempt(f.payload(), () => handleSeedreamRequest(f.payload(), f.dependencies), {
      Model: f.Model, token: `owner-${attempt}`,
    });
    assert.equal(f.row.apiGenerationStatus, 'PENDING');
    assert.equal(f.row.imageSubmissionAttempt.state, 'ACCEPTED');
    requestIds.push(f.row.apiRequestId);

    const failure = await pollSeedreamRequest(f.payload(), f.dependencies);
    assert.equal(failure.definitiveAdapterFailure, true);
    assert.match(failure.error, /422.*Generated image failed provider validation/);
    await f.worker.handleNoImageRetryOrFailure(f.payload(), failure);

    if (attempt < 4) {
      assert.equal(f.row.generationRetryCount, attempt);
      assert.equal(f.row.apiGenerationStatus, 'INIT');
      assert.equal(f.row.apiRequestId, undefined, 'the rejected provider ID must be cleared');
      assert.equal(f.row.imageSubmissionAttempt.state, 'REJECTED');
      assert.equal(f.session.layers[0].prompt, f.row.prompt);
      delays.push(f.row.nextAttemptAfter.getTime() - f.now());
      f.advanceTo(f.row.nextAttemptAfter.getTime());
    }
  }
  assert.deepEqual(delays, [2000, 4000, 8000]);
  assert.equal(f.submittedPrompts.length, 4);
  assert.equal(new Set(f.submittedPrompts).size, 4, 'each new generation must use a changed prompt');
  assert.equal(new Set(requestIds).size, 4);
  assert.equal(f.rewrites.length, 3);
  assert.equal(f.row.generationRetryCount, 3);
  assert.equal(f.row.generationStatus, 'FAILED');
  assert.equal(f.terminal.length, 1);
  assert.match(f.terminal[0].options.message, /Max image generation failures/);
});

test('content-checker failures use safety rewrites then prune only the exhausted express scene and reflow its audio', async (t) => {
  const overrides = { CURRENT_ENV: 'production', SAMSAR_DEPLOYMENT_EDITION: 'production',
    SAMSAR_EXTERNAL_INFERENCE_ENABLED: 'false', SAMSAR_FORCE_EXTERNAL_INFERENCE: 'false' };
  const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const rewriteRequests = [];
  t.mock.method(OpenAI.Chat.Completions.prototype, 'create', async (request, options) => {
    rewriteRequests.push(request);
    assert.equal(request.model, 'gpt-6.2-astra');
    assert.equal(options.maxRetries, 0);
    return { choices: [{ message: { role: 'assistant',
      content: `An original adult character moves through a quiet underground train depot, with a distinct clear composition ${rewriteRequests.length}.` } }] };
  });
  const f = fixture({ prune: true, rewritePrompt: getAlternatePromptFromPrompt });
  const originalSeed = f.row.prompt;
  const failureDetail = 'The image was flagged by a content checker.';
  f.dependencies.queueResult = async () => { throw Object.assign(new Error('Unprocessable Entity'), {
    status: 422, body: { detail: [{ msg: failureDetail }] },
  }); };
  const delays = [];
  for (let attempt = 1; attempt <= 4; attempt++) {
    await runImageSubmissionAttempt(f.payload(), () => handleSeedreamRequest(f.payload(), f.dependencies), {
      Model: f.Model, token: `safety-owner-${attempt}`,
    });
    const failure = await pollSeedreamRequest(f.payload(), f.dependencies);
    assert.equal(isSafetyRejectionMessage(failure.error), true);
    await f.worker.handleNoImageRetryOrFailure(f.payload(), failure);
    if (attempt < 4) {
      delays.push(f.row.nextAttemptAfter.getTime() - f.now());
      f.advanceTo(f.row.nextAttemptAfter.getTime());
    }
  }
  assert.deepEqual(delays, [2000, 4000, 8000]);
  assert.equal(f.submittedPrompts.length, 4);
  assert.equal(new Set(f.submittedPrompts).size, 4);
  assert.equal(rewriteRequests.length, 3);
  for (const request of rewriteRequests) {
    assert.match(request.messages[0].content, /- Safety rejection:/);
    assert.match(request.messages[0].content, /Rewrite at theme level; do not produce a near-identical prompt/);
    assert.ok(request.messages[1].content.includes(originalSeed));
    assert.ok(request.messages[1].content.includes(failureDetail));
  }
  assert.equal(f.row.originalRetryPrompt, originalSeed, 'retry drafts must not replace the original source');
  assert.deepEqual(f.session.layers.map(layer => layer._id), ['accepted-before', 'accepted-after']);
  assert.deepEqual(f.session.layers.map(layer => layer.durationOffset), [0, 4]);
  assert.equal(f.session.totalDuration, 9);
  assert.deepEqual(f.session.audioLayers.map(audio => audio._id), ['before-speech', 'after-speech']);
  const audio = f.session.audioLayers.find(value => value._id === 'after-speech');
  assert.equal(audio.startTime, 5);
  assert.equal(audio.endTime, 8);
  assert.equal(f.session.layers[0].imageSession.activeGeneratedImage, 'before.png');
  assert.equal(f.session.layers[1].imageSession.activeGeneratedImage, 'after.png');
  assert.equal(f.session.layers[1].aiVideoLayer, 'after.mp4');
  assert.equal(f.session.expressGenerationFailed, false);
  assert.equal(f.session.expressGenerationPending, true);
  assert.equal(f.session.expressGenerationStatus.image_generation, 'PENDING');
  assert.deepEqual(f.prunedQueues, [{ videoSessionId: 'video-session', layerId: 'scene-five' }]);
});

test('a definitive Seedream result rejection repairs a legacy accepted job instead of treating it as a read outage', async () => {
  const f = fixture({ legacy: true, accepted: true });
  const failure = await pollSeedreamRequest(f.payload(), f.dependencies);
  await f.worker.handleNoImageRetryOrFailure(f.payload(), failure);
  assert.equal(f.row.apiGenerationStatus, 'INIT');
  assert.equal(f.row.apiRequestId, undefined);
  assert.equal(f.row.generationRetryCount, 1);
  assert.equal(f.rewrites.length, 1);
  assert.equal(f.row.nextAttemptAfter.getTime() - f.now(), 2000);
  assert.equal(f.terminal.length, 0);
});

test('prior quality retries consume the same budget as later Seedream provider failures', async () => {
  const f = fixture({ accepted: true, generationRetryCount: 2 });
  f.row.filterRetryCount = 2;
  const failure = await pollSeedreamRequest(f.payload(), f.dependencies);
  await f.worker.handleNoImageRetryOrFailure(f.payload(), failure);
  assert.equal(f.row.generationRetryCount, 3);
  assert.equal(f.row.nextAttemptAfter.getTime() - f.now(), 8000);
  f.advanceTo(f.row.nextAttemptAfter.getTime());

  await runImageSubmissionAttempt(f.payload(), () => handleSeedreamRequest(f.payload(), f.dependencies), {
    Model: f.Model, token: 'final-owner',
  });
  const lastFailure = await pollSeedreamRequest(f.payload(), f.dependencies);
  await f.worker.handleNoImageRetryOrFailure(f.payload(), lastFailure);
  assert.equal(f.submittedPrompts.length, 1, 'only the one remaining generation retry is allowed');
  assert.equal(f.rewrites.length, 1);
  assert.equal(f.row.generationRetryCount, 3);
  assert.equal(f.row.generationStatus, 'FAILED');
  assert.equal(f.terminal.length, 1);
});

for (const legacy of [false, true]) {
  for (const phase of ['status', 'result']) {
    test(`Seedream transient ${phase} failures preserve ${legacy ? 'legacy' : 'tracked'} accepted work and stop after three read retries`, async () => {
      const f = fixture({ legacy, accepted: true });
      let reads = 0;
      f.dependencies[phase === 'status' ? 'queueStatus' : 'queueResult'] = async () => {
        reads++;
        throw Object.assign(new Error('Temporary provider read failure'), { status: 503 });
      };
      const delays = [];
      for (let attempt = 1; attempt <= 4; attempt++) {
        let failure;
        try { await pollSeedreamRequest(f.payload(), f.dependencies); } catch (error) { failure = error; }
        assert.equal(failure?.providerPollFailure, true);
        await f.worker.recoverUnhandledGenerationTask(f.payload(), failure);
        assert.equal(f.row.apiRequestId, 'already-accepted');
        assert.equal(f.row.generationRetryCount, 0);
        assert.equal(f.rewrites.length, 0);
        assert.equal(f.submittedPrompts.length, 0);
        if (attempt < 4) {
          assert.equal(f.row.apiGenerationStatus, 'PENDING');
          assert.equal(f.row.imageSubmissionAttempt.pollFailures, attempt);
          delays.push(f.row.nextAttemptAfter.getTime() - f.now());
          f.advanceTo(f.row.nextAttemptAfter.getTime());
        }
      }
      assert.equal(reads, 4);
      assert.deepEqual(delays, [15000, 30000, 60000]);
      assert.equal(f.row.generationStatus, 'FAILED');
      assert.equal(f.row.submissionOutcomeUnknown, true);
      assert.equal(f.terminal.length, 1);
      assert.match(f.terminal[0].data.error, /polling failed repeatedly/);
      assert.ok(f.updates.every(update => update.$set?.apiGenerationStatus !== 'INIT'));
    });
  }
}
