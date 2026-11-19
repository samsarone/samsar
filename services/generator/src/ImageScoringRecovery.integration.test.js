import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./Image.js', import.meta.url), 'utf8');

// Run the real terminal scoring, completion, failure and reflow functions with
// isolated persistence/media boundaries; no providers or live database are used.
function workerFunction(name) {
  const start = source.search(new RegExp(`(?:export )?(?:async )?function ${name}\\(`));
  assert.notEqual(start, -1, `real worker function ${name} exists`);
  const rest = source.slice(start);
  const next = rest.search(/\n(?:export )?(?:async )?function /);
  return (next < 0 ? rest : rest.slice(0, next)).replace(/^export /, '');
}

function valuesAt(object, parts) {
  if (!parts.length) return [object];
  if (Array.isArray(object)) return object.flatMap(value => valuesAt(value, parts));
  return valuesAt(object?.[parts[0]], parts.slice(1));
}

function same(actual, expected) {
  if (expected === null) return actual == null;
  if (actual instanceof Date || expected instanceof Date) return Number(actual) === Number(expected);
  if (expected && typeof expected === 'object') return JSON.stringify(actual) === JSON.stringify(expected);
  return actual === expected;
}

function matches(document, filter) {
  return Object.entries(filter).every(([field, expected]) => {
    if (field === '$and') return expected.every(value => matches(document, value));
    if (field === '$or') return expected.some(value => matches(document, value));
    const values = valuesAt(document, field.split('.'));
    if (expected && typeof expected === 'object' && !(expected instanceof Date) && !Array.isArray(expected)) {
      if ('$elemMatch' in expected) return values.some(value => Array.isArray(value) && value.some(item => matches(item, expected.$elemMatch)));
      if ('$exists' in expected) return values.some(value => value !== undefined) === expected.$exists;
      if ('$ne' in expected) return values.every(value => !same(value, expected.$ne));
      if ('$in' in expected) return values.some(value => expected.$in.some(option => same(value, option)));
    }
    return values.some(value => same(value, expected));
  });
}

function write(object, key, value) {
  const parts = key.split('.'), field = parts.pop();
  const parent = parts.reduce((current, part) => current[part] ??= {}, object);
  parent[field] = structuredClone(value);
}

function apply(object, update, layerId) {
  for (const [key, value] of Object.entries(update.$set || {})) {
    const positional = key.replace('layers.$.', `layers.${object.layers?.findIndex(layer => layer._id === layerId)}.`);
    write(object, positional, value);
  }
  for (const [key, value] of Object.entries(update.$inc || {})) {
    write(object, key, (valuesAt(object, key.split('.'))[0] || 0) + value);
  }
  for (const [key, value] of Object.entries(update.$push || {})) {
    object[key] ||= [];
    object[key].push(...structuredClone(value.$each));
    if (value.$slice < 0) object[key] = object[key].slice(value.$slice);
  }
}

function fixture({ scores = [34, 48], stopped = {}, counters = {} } = {}) {
  const row = {
    _id: 'image-job', videoSessionId: 'video-session', layerId: 'failed-scene',
    model: 'GPTIMAGE2.5', operationType: 'GENERATE', isBatchGeneration: true,
    isBaseGeneration: true, imageFilterScoreRequired: true, aspectRatio: '16:9',
    prompt: 'A watercolor king fires an arrow through twelve bronze axe rings.',
    generationStatus: 'PENDING', apiGenerationStatus: 'COMPLETED', rowLocked: true,
    failureRetryCount: 1, filterRetryCount: 3, generationRetryCount: 3,
    ...counters,
    submissionOutcomeUnknown: false, imageSubmissionAttempt: { state: 'COMPLETED' },
    failureHistory: [
      { source: 'image_generation_filter_retry', message: `Generated image score ${scores[0]} was below the acceptance threshold.`, failureRetryCount: 0 },
      { source: 'image_generation_refilter_retry_safety', message: 'Provider rejected request. safety_violations=[violence].', failureRetryCount: 1 },
      { source: 'image_generation_filter_retry', message: `Generated image score ${scores[1]} was below the acceptance threshold.`, failureRetryCount: 1 },
    ],
  };
  const session = {
    _id: row.videoSessionId, __v: 0, updatedAt: new Date('2026-11-19T11:37:00Z'),
    isExpressGeneration: true, narrativeType: 'singular', videoTone: 'grounded',
    expressGenerationPending: true, expressGenerationFailed: false,
    expressGenerationStatus: { status: 'PENDING', image_generation: 'PENDING', video_generation: 'INIT' },
    hostedAgentBilling: { controlIntent: 'ACTIVE' }, totalDuration: 15,
    layers: [
      { _id: 'completed-before', duration: 4, durationOffset: 0,
        imageSession: { generationStatus: 'COMPLETED', activeGeneratedImage: 'before.png' } },
      { _id: row.layerId, duration: 6, durationOffset: 4,
        imageSession: { generationStatus: 'PENDING', activeItemList: [] },
        filterPasses: scores.map((score, index) => ({ score, src: `candidate-${index + 1}.png`, description: `Saved description ${index + 1}.` })) },
      { _id: 'completed-after', duration: 5, durationOffset: 10,
        imageSession: { generationStatus: 'COMPLETED', activeGeneratedImage: 'after.png' },
        aiVideoGenerationStatus: 'COMPLETED', aiVideoLayer: 'after.mp4' },
    ],
    audioLayers: [
      { _id: 'before-speech', connectedLayerId: 'completed-before', startTime: 0, endTime: 3, duration: 3 },
      { _id: 'failed-speech', connectedLayerId: row.layerId, startTime: 4, endTime: 9, duration: 5 },
      { _id: 'after-speech', connectedLayerId: 'completed-after', startTime: 11, endTime: 14, duration: 3,
        generationStatus: 'COMPLETED', selectedLocalAudioLink: 'after-speech.wav' },
    ],
    ...stopped,
  };
  const deleted = [], dequeued = [], globalFailures = [], sessionUpdates = [], completedImages = [];
  const ImageGeneration = {
    findOne: async () => structuredClone(row),
    async updateOne(filter, update) {
      assert.equal(filter._id, row._id);
      apply(row, update);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async deleteOne(filter) { deleted.push(structuredClone(filter)); },
    async deleteMany(filter) { deleted.push(structuredClone(filter)); },
  };
  const VideoSession = {
    findOne() {
      const hydrate = () => {
        const value = structuredClone(session);
        Object.defineProperty(value, 'toObject', { value: () => structuredClone(session) });
        return value;
      };
      return { then: (resolve, reject) => Promise.resolve(hydrate()).then(resolve, reject), lean: async () => structuredClone(session) };
    },
    async updateOne(filter, update) {
      sessionUpdates.push({ filter: structuredClone(filter), update: structuredClone(update) });
      if (!matches(session, filter)) return { matchedCount: 0, modifiedCount: 0 };
      apply(session, update, row.layerId);
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };
  const names = [
    'normalizeRetryCount', 'normalizeString', 'normalizeDocumentId', 'cloneDocumentObject',
    'getImageGenerationRetryCount', 'getImageGenerationRetryPlan', 'getImageGenerationRetryDelayMs', 'getImageGenerationNextAttemptAfter',
    'getImageGenerationFailureMessage', 'hasReachedScoreOnlyFilterRelaxation', 'getImageFilterScoreCutoff',
    'getScoreThresholdCutoff', 'isBranchedVideoSession', 'getTerminalFilterFailurePolicy',
    'getBestFilterPass', 'normalizeOptionalScore', 'buildActiveImageCandidate', 'processBestFilterPassIfAvailable',
    'processRefilterFailure', 'processImageGenerationSuccess', 'getImageItemPlacementFields',
    'buildFailureHistoryEntry', 'recordImageGenerationFailure', 'markImageGenerationRequestFailed',
    'isPrunableExpressImageLayer', 'getImageLayerVisualState', 'hasCompletedLayerVisual',
    'isExpressImageFailureSessionStopped', 'findImageFailureVideoSession', 'getExpressImageFailureUpdate',
    'getConnectedAudioRelativeStart', 'getAudioLayerDuration', 'clampAudioLayersToTimeline',
    'reflowLayersAndConnectedAudio', 'buildExpressLayerPrunePlan', 'pruneExpressImageLayerAfterFailure',
  ];
  const context = vm.createContext({
    Date, ImageGeneration, VideoSession,
    MAX_IMAGE_GENERATION_RETRIES: 3, MAX_IMAGE_GENERATION_FAILURES: 4, MAX_IMAGE_GENERATION_FILTER_RETRIES: 4,
    IMAGE_GENERATION_RETRY_BASE_DELAY_MS: 2000, IMAGE_GENERATION_RETRY_MAX_DELAY_MS: 30000, FAILURE_HISTORY_LIMIT: 10,
    IMAGE_FILTER_SCORE_CUTOFF: 50, GROUNDED_IMAGE_FILTER_SCORE_CUTOFF: 65, GROUNDED_IMAGE_RETRY_SCORE_CUTOFF: 50,
    SCORE_ONLY_FILTER_FAILURES_BEFORE_RELAXATION: 2, SCORE_ONLY_FILTER_RELAXED_CUTOFF: 50,
    SCORE_ONLY_FILTER_FALLBACK_SCORE_CUTOFF: 42, BRANCHED_IMAGE_FILTER_FALLBACK_SCORE_CUTOFF: 25,
    IMAGE_FILTER_SCORE_RELAXATION_PER_GENERATION_FAILURE: 10, MIN_IMAGE_FILTER_SCORE_CUTOFF: 35, MIN_GROUNDED_IMAGE_FILTER_SCORE_CUTOFF: 41,
    getDBConnectionString: async () => {},
    persistGenerationImageForSession: async image => ({ relativePath: image, remoteImageUrl: `/${image}` }),
    getCanvasDimensionsForAspectRatio: () => ({ width: 1536, height: 864 }),
    getImagePlacementForCanvas: () => ({ x: 0, y: 0, width: 1536, height: 864, sourceWidth: 1536, sourceHeight: 864 }),
    persistFinalGeneratedImageForRequest: async (_payload, image) => completedImages.push(structuredClone(image)),
    resolveImageInferenceSettings: async () => assert.fail('terminal scoring recovery must not start another prompt rewrite'),
    getAlteredPromptForRetry: async () => assert.fail('terminal scoring recovery must not schedule another generation'),
    removeTaskFromQueueById: id => dequeued.push(id),
    markVideoGlobalSessionFailed: async (...args) => globalFailures.push(args),
    console: { error: error => { throw error; }, warn() {} },
  });
  const processRefilterFailure = vm.runInContext(`${names.map(workerFunction).join('\n')}\nprocessRefilterFailure`, context);
  return {
    row, session, deleted, dequeued, globalFailures, sessionUpdates, completedImages,
    run: (score = 28) => processRefilterFailure({ image: 'current.png' }, structuredClone(row), score, 'Current image has fused axes and a duplicated face.'),
  };
}

test('mixed low scores and a safety rejection rescue the saved 48-point candidate after the shared retry budget is exhausted', async () => {
  const f = fixture();
  await f.run();
  const layer = f.session.layers[1];
  assert.equal(layer.imageSession.generationStatus, 'COMPLETED');
  assert.equal(layer.imageSession.activeGeneratedImage, 'candidate-2.png');
  assert.equal(layer.refilterImageScore, 48);
  assert.equal(layer.imageSession.activeImageDescription, 'Saved description 2.');
  assert.equal(f.session.expressGenerationPending, true);
  assert.equal(f.session.expressGenerationFailed, false);
  assert.deepEqual(f.session.layers.map(value => value._id), ['completed-before', 'failed-scene', 'completed-after']);
  assert.deepEqual(f.deleted, [{ _id: 'image-job' }]);
  assert.equal(f.completedImages.length, 1);
  assert.equal(f.completedImages[0].url, 'candidate-2.png');
  assert.equal(f.globalFailures.length, 0);
  assert.equal(f.row.generationRetryCount, 3, 'recovery cannot allocate an additional paid generation');
});

test('exhausted mixed quality failures prune only the failed scene when every saved image is below fallback', async () => {
  const f = fixture({ scores: [34, 40] });
  await f.run();
  assert.deepEqual(f.session.layers.map(value => value._id), ['completed-before', 'completed-after']);
  assert.deepEqual(f.session.layers.map(value => value.durationOffset), [0, 4]);
  assert.equal(f.session.layers[0].imageSession.activeGeneratedImage, 'before.png');
  assert.equal(f.session.layers[1].imageSession.activeGeneratedImage, 'after.png');
  assert.equal(f.session.layers[1].aiVideoLayer, 'after.mp4');
  assert.deepEqual(f.session.audioLayers.map(value => value._id), ['before-speech', 'after-speech']);
  assert.equal(f.session.audioLayers[1].selectedLocalAudioLink, 'after-speech.wav');
  assert.equal(f.session.audioLayers[1].startTime, 5);
  assert.equal(f.session.audioLayers[1].endTime, 8);
  assert.equal(f.session.totalDuration, 9);
  assert.equal(f.session.expressGenerationPending, true);
  assert.equal(f.session.expressGenerationFailed, false);
  assert.equal(f.session.expressGenerationStatus.image_generation, 'PENDING');
  assert.equal(f.globalFailures.length, 0);
  assert.deepEqual(f.deleted, [{ videoSessionId: 'video-session', layerId: 'failed-scene' }]);
});

test('a reached filter-attempt limit still recovers when a legacy shared retry counter is lower', async () => {
  const f = fixture({ counters: { generationRetryCount: 1 } });
  await f.run();
  assert.equal(f.session.layers[1].imageSession.generationStatus, 'COMPLETED');
  assert.equal(f.session.layers[1].imageSession.activeGeneratedImage, 'candidate-2.png');
  assert.equal(f.session.layers[1].refilterImageScore, 48);
  assert.equal(f.session.expressGenerationPending, true);
  assert.equal(f.session.expressGenerationFailed, false);
  assert.equal(f.row.generationRetryCount, 1, 'the exhausted filter path must not schedule another generation');
  assert.equal(f.globalFailures.length, 0);
});

for (const [name, stopped] of [
  ['paused', { expressGenerationPaused: true }],
  ['cancelled', { expressGenerationCancelled: true, expressGenerationPending: false }],
]) {
  test(`terminal mixed quality failures do not reopen or reflow a ${name} parent`, async () => {
    const f = fixture({ scores: [34, 40], stopped });
    await f.run();
    assert.equal(f.session.layers.length, 3);
    assert.equal(f.session.layers[2].durationOffset, 10);
    assert.equal(f.session.audioLayers.length, 3);
    assert.equal(f.session.expressGenerationFailed, false);
    for (const [key, value] of Object.entries(stopped)) assert.equal(f.session[key], value);
    assert.equal(f.deleted.length, 0);
    assert.equal(f.globalFailures.length, 0);
  });
}
