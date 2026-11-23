import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSessionPostProcessingPreferenceController,
  readSessionPostProcessingPreferences,
} from './sessionPostProcessingPreferences.mjs';

const defaults = { translationEnableSubtitles: false, translationTranslateOutro: false, translationTranslateFooter: false };
const turn = () => new Promise(setImmediate);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

test('missing preferences are opt-in and only explicitly saved boolean fields hydrate', () => {
  assert.deepEqual(readSessionPostProcessingPreferences(), defaults);
  assert.deepEqual(readSessionPostProcessingPreferences({ _id: 'source', enableSubtitles: true }), defaults);
  assert.deepEqual(readSessionPostProcessingPreferences({ session: { _id: 'source', postProcessingPreferences: {
    translationEnableSubtitles: true, translationTranslateOutro: 'true', translationTranslateFooter: false,
    inference_model: 'unexpected',
  } } }), { ...defaults, translationEnableSubtitles: true });
  assert.deepEqual(readSessionPostProcessingPreferences({ _id: 'source', postProcessingPreferences: {
    translationTranslateFooter: true,
  } }, 'other'), defaults);
});

test('late matching hydration respects local changes and ignores other sessions', async () => {
  const writes = [];
  const controller = createSessionPostProcessingPreferenceController({ sessionId: 'target', persist: async (...args) => writes.push(args) });
  controller.hydrate({ _id: 'old', postProcessingPreferences: { translationTranslateFooter: true } });
  assert.deepEqual(controller.getSnapshot().preferences, defaults);
  controller.hydrate({ session: { _id: 'target', postProcessingPreferences: { translationTranslateOutro: true } } });
  assert.equal(controller.getSnapshot().preferences.translationTranslateOutro, true);
  controller.updatePreference('translationTranslateFooter', true);
  controller.hydrate({ _id: 'target', postProcessingPreferences: { translationTranslateFooter: false, translationTranslateOutro: true } });
  assert.equal(controller.getSnapshot().preferences.translationTranslateFooter, true);
  await controller.flushPreferences();
  assert.deepEqual(writes, [['target', { translationTranslateFooter: true }]]);
});

test('rapid preference changes serialize writes and flush waits for the final save', async () => {
  const first = deferred();
  const second = deferred();
  const writes = [];
  let active = 0, maximumActive = 0;
  const controller = createSessionPostProcessingPreferenceController({ sessionId: 'source', persist: async (sessionId, patch) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    writes.push([sessionId, patch]);
    try { await (writes.length === 1 ? first.promise : second.promise); }
    finally { active -= 1; }
  } });
  controller.updatePreference('translationTranslateOutro', true);
  await turn();
  controller.updatePreference('translationTranslateOutro', false);
  controller.updatePreference('translationTranslateFooter', true);
  let flushed = false;
  const flush = controller.flushPreferences().then(() => { flushed = true; });
  await turn();
  assert.equal(writes.length, 1);
  assert.equal(flushed, false);
  first.resolve();
  await turn();
  assert.deepEqual(writes[1], ['source', { translationTranslateOutro: false, translationTranslateFooter: true }]);
  assert.equal(flushed, false);
  second.resolve();
  await flush;
  assert.equal(maximumActive, 1);
  assert.equal(flushed, true);
});

test('failed saves remain pending until an explicit retry and preserve the latest value', async () => {
  const writes = [];
  const failures = [];
  const controller = createSessionPostProcessingPreferenceController({ sessionId: 'source', onError: error => failures.push(error),
    persist: async (...args) => {
      writes.push(args);
      if (writes.length === 1) throw { response: { data: { message: 'Preference save failed' } } };
    },
  });
  controller.updatePreference('translationTranslateFooter', true);
  await turn();
  assert.equal(writes.length, 1);
  assert.equal(controller.getSnapshot().error.message, 'Preference save failed');
  assert.equal(failures.length, 1);
  controller.updatePreference('translationTranslateFooter', false);
  await controller.flushPreferences();
  assert.deepEqual(writes[1], ['source', { translationTranslateFooter: false }]);
  assert.equal(controller.getSnapshot().error, null);
});

test('switching sessions cannot leak old choices or late failures into the new target', async () => {
  const first = deferred();
  const writes = [];
  const failures = [];
  const controller = createSessionPostProcessingPreferenceController({ sessionId: 'old', onError: error => failures.push(error),
    persist: async (...args) => { writes.push(args); if (writes.length === 1) await first.promise; },
  });
  controller.updatePreference('translationTranslateFooter', true);
  const oldFlush = controller.flushPreferences().catch(error => error);
  await turn();
  controller.setSession('new', { _id: 'old', postProcessingPreferences: { translationTranslateFooter: true } });
  assert.deepEqual(controller.getSnapshot().preferences, defaults);
  controller.updatePreference('translationEnableSubtitles', true);
  const newFlush = controller.flushPreferences();
  first.reject(new Error('Old request failed'));
  await newFlush;
  assert.equal((await oldFlush).code, 'POST_PROCESSING_PREFERENCE_SESSION_CHANGED');
  assert.deepEqual(writes, [
    ['old', { translationTranslateFooter: true }], ['new', { translationEnableSubtitles: true }],
  ]);
  assert.deepEqual(controller.getSnapshot().preferences, { ...defaults, translationEnableSubtitles: true });
  assert.deepEqual(failures, []);
});

test('unmounting drops pending writes and suppresses late error notifications', async () => {
  const first = deferred();
  const writes = [], failures = [];
  const controller = createSessionPostProcessingPreferenceController({ sessionId: 'source', onError: error => failures.push(error),
    persist: async (...args) => { writes.push(args); await first.promise; },
  });
  controller.updatePreference('translationTranslateOutro', true);
  const flush = controller.flushPreferences().catch(error => error);
  await turn();
  controller.updatePreference('translationTranslateFooter', true);
  controller.dispose();
  first.reject(new Error('Late failure'));
  assert.equal((await flush).code, 'POST_PROCESSING_PREFERENCE_SESSION_CHANGED');
  await turn();
  assert.equal(writes.length, 1);
  assert.deepEqual(failures, []);
});

test('only boolean preference keys can schedule a write', async () => {
  const controller = createSessionPostProcessingPreferenceController({ sessionId: 'source', persist: () => assert.fail('Unexpected write') });
  assert.equal(controller.updatePreference('inferenceModel', true), false);
  assert.equal(controller.updatePreference('translationTranslateFooter', 'true'), false);
  await controller.flushPreferences();
  assert.deepEqual(controller.getSnapshot().preferences, defaults);
});
