import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTranslationProgressReporter,
  markTranslationPreparationFailed,
} from './TranslationPreparationProgress.js';

function recordingLogger() {
  const entries = [];
  return {
    entries,
    info: (...args) => entries.push(['info', ...args]),
    warn: (...args) => entries.push(['warn', ...args]),
  };
}

test('preparation progress persists safe counts without activating workers or logging speech', async () => {
  const writes = [];
  const logger = recordingLogger();
  let timestamp = Date.parse('2026-11-23T06:40:00Z');
  const report = createTranslationProgressReporter({
    sessionId: 'translated', originalSessionId: 'source', model: 'gemini-4-carbon',
    now: () => timestamp, logger,
    write: async (filter, update) => { writes.push({ filter, update }); return { matchedCount: 1 }; },
  });
  timestamp += 500;
  const progress = await report({
    phase: 'speech_validation', event: 'speech_repair_attempt_started', status: 'IN_PROGRESS',
    requestKey: 'retranslation:speech-repair-2:attempt-1', speechIndex: 2, layerIndex: 3,
    speechCount: 8, attempt: 1, maxAttempts: 3, maxCharacters: 28,
    originalCharacters: 51, translatedCharacters: 60,
    prompt: 'PRIVATE SPEECH', messages: [{ content: 'PRIVATE SPEECH' }],
    response: 'PRIVATE RESPONSE', apiKey: 'PRIVATE KEY', usage: { token: 'PRIVATE KEY' },
  });
  assert.equal(progress.startedAt, '2026-11-23T06:40:00.000Z');
  assert.equal(progress.updatedAt, '2026-11-23T06:40:00.500Z');
  assert.equal(progress.elapsedMs, 500);
  assert.equal(progress.speechIndex, 2);
  assert.equal(progress.attempt, 1);
  assert.deepEqual(writes[0].filter, { _id: 'translated', expressGenerationCancelled: { $ne: true } });
  assert.deepEqual(writes[0].update.$set.postProcessingProgress, progress);
  assert.equal(writes[0].update.$set['expressGenerationStatus.status'], 'PROCESSING');
  assert.equal(writes[0].update.$set.expressGenerationPending, undefined);
  assert.equal(JSON.stringify({ writes, logs: logger.entries }).includes('PRIVATE'), false);
  const snapshot = report.snapshot();
  snapshot.phase = 'modified';
  progress.attempt = 99;
  assert.equal(report.snapshot().phase, 'speech_validation');
  assert.equal(report.snapshot().attempt, 1);
});

test('preparation reporter clears prior attempt diagnostics when moving to a new speech item', async () => {
  const report = createTranslationProgressReporter({
    sessionId: 'translated', originalSessionId: 'source', model: 'gemini-4-carbon',
    logger: recordingLogger(), write: async () => ({ matchedCount: 1 }),
  });
  await report({ speechIndex: 0, attempt: 3, maxAttempts: 3, maxCharacters: 28,
    returnedCharacters: 28, finalCharacters: 28 });
  const next = await report({ speechIndex: 1, event: 'speech_validation_started' });
  assert.equal(next.speechIndex, 1);
  for (const field of ['attempt', 'maxAttempts', 'maxCharacters', 'returnedCharacters', 'finalCharacters']) {
    assert.equal(next[field], undefined, field);
  }
});

test('diagnostic write failure resolves without repeating the write or leaking database errors', async () => {
  const logger = recordingLogger();
  let writes = 0;
  const report = createTranslationProgressReporter({
    sessionId: 'translated', originalSessionId: 'source', model: 'gemini-4-carbon', logger,
    write: async () => { writes += 1; throw Object.assign(new Error('PRIVATE DATABASE URI'), { code: 'DB_UNAVAILABLE' }); },
  });
  const progress = await report({ phase: 'speech_validation', attempt: 1 });
  assert.equal(progress.attempt, 1);
  assert.equal(writes, 1);
  assert.equal(logger.entries.filter(([level]) => level === 'warn').length, 1);
  assert.equal(JSON.stringify(logger.entries).includes('PRIVATE'), false);
});

test('completion progress leaves the active worker aggregate status unchanged', async () => {
  const writes = [];
  const report = createTranslationProgressReporter({
    sessionId: 'translated', originalSessionId: 'source', model: 'gemini-4-carbon',
    logger: recordingLogger(), write: async (_filter, update) => writes.push(update),
  });
  await report({ phase: 'ready', event: 'preparation_completed', status: 'COMPLETED' });
  assert.equal(writes[0].$set.postProcessingProgress.status, 'COMPLETED');
  assert.equal(writes[0].$set['expressGenerationStatus.status'], undefined);
});

test('uncertain timeout records a terminal session and global mapping without raw provider errors', async () => {
  const writes = [];
  const mappings = [];
  const cause = Object.assign(new Error('PRIVATE PROVIDER RESPONSE'), {
    code: 'ETIMEDOUT', providerOutcomeUncertain: true,
  });
  const error = Object.assign(new Error('PRIVATE VALIDATION DETAILS'), {
    code: 'TRANSLATED_SPEECH_VALIDATION_FAILED', cause,
  });
  const progress = {
    operation: 'translate_video', sessionId: 'translated', originalSessionId: 'source',
    model: 'gemini-4-carbon', status: 'IN_PROGRESS', phase: 'speech_validation',
    speechIndex: 2, attempt: 1, requestKey: 'retranslation:speech-repair-2:attempt-1',
    startedAt: '2026-11-23T06:40:00.000Z',
  };
  await markTranslationPreparationFailed({ sessionId: 'translated', error, progress }, {
    write: async (filter, update) => { writes.push({ filter, update }); return { matchedCount: 1 }; },
    updateGlobalSession: async (mapping) => mappings.push(mapping),
    now: () => Date.parse('2026-11-23T06:42:00Z'),
  });
  const fields = writes[0].update.$set;
  assert.equal(fields.postProcessingPreparationPending, false);
  assert.equal(fields.expressGenerationFailed, true);
  assert.equal(fields.expressGenerationPending, false);
  assert.equal(fields['expressGenerationStatus.status'], 'FAILED');
  assert.deepEqual(fields.postProcessingProgress, {
    ...progress, status: 'FAILED', errorCode: 'TRANSLATION_PROVIDER_TIMEOUT', updatedAt: '2026-11-23T06:42:00.000Z',
  });
  assert.equal(mappings[0].status, 'FAILED');
  assert.equal(mappings[0].errorMessage, fields.expressGenerationError);
  assert.match(fields.expressGenerationError, /No automatic retry was submitted/);
  assert.equal(Object.keys(fields).some((key) => key.startsWith('postProcessingProgress.')), false);
  assert.equal(JSON.stringify({ writes, mappings }).includes('PRIVATE'), false);
});

test('preparation failure does not overwrite a cancellation or its global mapping', async () => {
  let mappings = 0;
  await markTranslationPreparationFailed({ sessionId: 'translated', error: new Error('failure') }, {
    write: async (filter) => {
      assert.deepEqual(filter, { _id: 'translated', expressGenerationCancelled: { $ne: true } });
      return { matchedCount: 0 };
    },
    updateGlobalSession: async () => { mappings += 1; },
  });
  assert.equal(mappings, 0);
});

test('lost provider responses are distinguished from timeouts without exposing the original error', async () => {
  let fields;
  const error = Object.assign(new Error('PRIVATE PROVIDER RESPONSE'), {
    code: 'ECONNRESET', providerOutcomeUncertain: true, retryable: false,
  });
  await markTranslationPreparationFailed({ sessionId: 'translated', error }, {
    write: async (_filter, update) => { fields = update.$set; return { matchedCount: 1 }; },
    updateGlobalSession: async () => {},
  });
  assert.equal(fields.postProcessingProgress.errorCode, 'TRANSLATION_PROVIDER_OUTCOME_UNCERTAIN');
  assert.match(fields.expressGenerationError, /No automatic retry was submitted/);
  assert.equal(fields.expressGenerationError.includes('timed out'), false);
  assert.equal(JSON.stringify(fields).includes('PRIVATE'), false);
});
