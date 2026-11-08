import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildAudioNetworkRecovery, recoverAudioProviderNetworkError, canDispatchAudioRequest, recoverExpiredAudioSubmissions, isAudioNetworkError } from './AudioNetworkRecovery.js';

const networkError = () => Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
function fixture(overrides = {}) {
  const request = { _id: 'audio-request', sessionId: 'session', audioLayerId: 'speech', status: 'PENDING',
    rowLocked: true, apiRequestId: 'accepted-provider-request', generationId: 'accepted-provider-request', submittedAdapter: 'original-adapter', ...overrides };
  const session = { _id: 'session', isExpressGeneration: true, expressGenerationPending: true,
    audioLayers: [{ _id: 'speech', generationStatus: 'PENDING' }] };
  const updates = []; const sessionUpdates = [];
  const AudioModel = {
    findById: async () => structuredClone(request),
    updateOne: async (query, update) => {
      updates.push({ query, update }); Object.assign(request, update.$set); return { matchedCount: 1 };
    },
  };
  const SessionModel = { findOne: async () => session,
    updateOne: async (...args) => { sessionUpdates.push(args); return { matchedCount: 1 }; } };
  return { request, session, updates, sessionUpdates, dependencies: { AudioModel, SessionModel, now: 1000000, env: {} } };
}

test('transport failures back off without clearing provider identity or adapter affinity', () => {
  const f = fixture();
  const result = buildAudioNetworkRecovery(f.request, networkError(), { now: 1000000, env: {} });
  assert.equal(result.exhausted, false);
  assert.equal(result.set.providerNetworkErrorCount, 1);
  assert.equal(result.set.nextAttemptAfter.getTime(), 1002000);
  for (const key of ['generationId', 'apiRequestId', 'submittedAdapter', 'status']) assert.equal(key in result.set, false);
});

test('repeated or terminal failures stop the existing execution without requesting a new one', () => {
  const f = fixture({ providerNetworkErrorCount: 4 });
  const plan = buildAudioNetworkRecovery(f.request, networkError(), { now: 1000000, env: {} });
  assert.equal(plan.exhausted, true); assert.equal(plan.set.status, 'FAILED'); assert.equal(plan.set.retryOnFail, false);
  assert.equal(buildAudioNetworkRecovery(f.request, networkError(), { now: 1000000, definitive: true }).code, 'AUDIO_PROVIDER_MEDIA_UNAVAILABLE');
  assert.equal(buildAudioNetworkRecovery({ providerNetworkFirstErrorAt: new Date(0) }, networkError(), { now: 1000000, env: {} }).exhausted, true);
});

test('a stale INIT payload cannot erase the receipt saved before a later submission-side error', async () => {
  const f = fixture();
  await recoverAudioProviderNetworkError({ _id: f.request._id, status: 'INIT' }, networkError(), f.dependencies);
  assert.equal(f.request.apiRequestId, 'accepted-provider-request');
  assert.equal(f.request.status, 'PENDING');
  assert.equal(f.updates[0].query.apiRequestId, 'accepted-provider-request');
  assert.equal(f.sessionUpdates.length, 0);
});

test('exhaustion emits one guarded session marker and retains the paid request record', async () => {
  const f = fixture({ providerNetworkErrorCount: 4 });
  await recoverAudioProviderNetworkError(f.request, networkError(), f.dependencies);
  assert.equal(f.request.status, 'FAILED');
  assert.equal(f.request.generationId, 'accepted-provider-request');
  const [filter, update, options] = f.sessionUpdates[0];
  assert.deepEqual(filter.expressGenerationCancelled, { $ne: true });
  assert.deepEqual(filter.expressGenerationPaused, { $ne: true });
  assert.equal(update.$set.providerNetworkFailure.providerRequestId, 'accepted-provider-request');
  assert.equal(update.$set.providerNetworkFailure.stage, 'audio_generation');
  assert.equal(options.arrayFilters[0]['audio._id'], 'speech');
  await recoverAudioProviderNetworkError(f.request, networkError(), f.dependencies);
  assert.equal(f.sessionUpdates.length, 1);
});

test('stale competing updates cannot publish a terminal session failure', async () => {
  const f = fixture({ providerNetworkErrorCount: 4 });
  f.dependencies.AudioModel.updateOne = async () => ({ matchedCount: 0 });
  await recoverAudioProviderNetworkError(f.request, networkError(), f.dependencies);
  assert.equal(f.sessionUpdates.length, 0);
});

test('non-network errors retain the original provider-specific handling', async () => {
  const f = fixture();
  assert.equal(await recoverAudioProviderNetworkError(f.request, new Error('Invalid output encoding'), f.dependencies), false);
  assert.equal(f.updates.length, 0);
});

test('expired new-protocol submissions fail without replaying an unconfirmed POST', async () => {
  const f = fixture({ status: 'INIT', apiRequestId: null, generationId: null,
    providerSubmissionStartedAt: new Date(1), providerSubmissionLeaseExpiresAt: new Date(2) });
  f.dependencies.AudioModel.find = async query => {
    if (query.status === 'FAILED') return [];
    assert.equal(query.status, 'INIT');
    assert.deepEqual(query.providerSubmissionStartedAt, { $ne: null });
    return [f.request];
  };
  await recoverExpiredAudioSubmissions(f.dependencies);
  assert.equal(f.request.status, 'FAILED');
  assert.equal(f.request.submissionOutcomeUnknown, true);
  assert.equal(f.sessionUpdates[0][1].$set.providerNetworkFailure.code, 'PROVIDER_SUBMISSION_OUTCOME_UNKNOWN');
});

test('a lost session failure write is finalized later without restarting the provider execution', async () => {
  const f = fixture({ providerNetworkErrorCount: 4 });
  f.dependencies.SessionModel.updateOne = async () => { throw networkError(); };
  await assert.rejects(recoverAudioProviderNetworkError(f.request, networkError(), f.dependencies));
  assert.equal(f.request.status, 'FAILED'); assert.equal(f.request.providerNetworkFailureFinalized, false);
  f.dependencies.SessionModel.updateOne = async (...args) => { f.sessionUpdates.push(args); return { matchedCount: 1 }; };
  f.dependencies.AudioModel.find = async query => query.status === 'FAILED' ? [f.request] : [];
  await recoverExpiredAudioSubmissions(f.dependencies);
  assert.equal(f.request.providerNetworkFailureFinalized, true);
  assert.equal(f.sessionUpdates.length, 1);
  assert.equal(f.request.apiRequestId, 'accepted-provider-request');
});

test('an unpollable synchronous receipt fails ambiguous rather than causing a second generation', async () => {
  const f = fixture();
  const error = Object.assign(networkError(), { providerRequestUnpollable: true });
  await recoverAudioProviderNetworkError(f.request, error, { ...f.dependencies, ambiguous: true });
  assert.equal(f.request.status, 'FAILED'); assert.equal(f.request.submissionOutcomeUnknown, true);
});

test('an ambiguous INIT failure preserves the request and fails with no provider ID', async () => {
  const f = fixture({ status: 'INIT', apiRequestId: null, generationId: null, providerSubmissionStartedAt: new Date(1) });
  assert.equal(await recoverAudioProviderNetworkError(f.request, networkError(), { ...f.dependencies, ambiguous: true }), true);
  assert.equal(f.request.status, 'FAILED'); assert.equal(f.request.retryOnFail, false);
  assert.equal(f.sessionUpdates[0][1].$set.providerNetworkFailure.providerRequestId, null);
});

test('queued audio checks current controls without deadlocking on stale network markers', async () => {
  const f = fixture();
  assert.equal(await canDispatchAudioRequest(f.request, f.dependencies), true);
  // An inherited scene-stage COMPLETED value alone does not suppress a new translation.
  f.session.audioGenerationStatus = 'COMPLETED';
  assert.equal(await canDispatchAudioRequest(f.request, f.dependencies), true);
  f.session.providerNetworkFailure = { stage: 'audio_generation', audioLayerId: 'old-source-target' };
  assert.equal(await canDispatchAudioRequest(f.request, f.dependencies), true);
  for (const field of ['expressGenerationPaused', 'expressGenerationCancelled', 'expressGenerationFailed']) {
    f.session[field] = true;
    assert.equal(await canDispatchAudioRequest(f.request, f.dependencies), false);
    delete f.session[field];
  }
});

for (const control of ['expressGenerationPaused', 'expressGenerationCancelled', 'expressGenerationFailed', 'completed']) {
  test(`${control} protects the session and existing audio from recovery failure writes`, async () => {
    const f = fixture({ providerNetworkErrorCount: 4 });
    if (control === 'completed') Object.assign(f.session.audioLayers[0], { generationStatus: 'COMPLETED', selectedLocalAudioLink: '/valid.wav' });
    else f.session[control] = true;
    await recoverAudioProviderNetworkError(f.request, networkError(), f.dependencies);
    assert.equal(f.sessionUpdates.length, 0); assert.equal(f.request.status, 'PENDING');
  });
}

function speechWorker(f, { status, finalize = async () => {}, submit = async () => ({ requestId: 'accepted-provider-request' }) }) {
  const source = fs.readFileSync(new URL('../external/SamsarExternalAudioAdapter.js', import.meta.url), 'utf8');
  const start = source.indexOf('export async function processSamsarExternalSpeechRequest(');
  const implementation = source.slice(start, source.indexOf('\n}\n', start) + 2).replace('export ', '');
  f.dependencies.AudioModel.findByIdAndUpdate = async (_id, update) => Object.assign(f.request, update);
  f.dependencies.SessionModel.findOneAndUpdate = async () => {};
  return vm.runInNewContext(`${implementation};processSamsarExternalSpeechRequest`, {
    console: { error() {} }, getDBConnectionString: async () => {},
    buildSpeechInputPayload: () => ({}), EXTERNAL_AUDIO_ROUTE_TEXT_TO_SPEECH: 'text_to_speech',
    submitExternalAudio: submit, AudioGeneration: f.dependencies.AudioModel, VideoSession: f.dependencies.SessionModel,
    recordProviderUsageLog: async () => {}, normalizeTtsProvider: () => 'provider', normalizeString: value => String(value || ''),
    getExternalAudioStatus: status, normalizeProviderStatus: row => row.status, getAudioUrl: row => row.audio,
    finalizeExternalSpeechGeneration: finalize,
    recoverAudioProviderNetworkError: (payload, error) => recoverAudioProviderNetworkError(payload, error, f.dependencies),
    isAudioNetworkError,
    markAudioGenerationAsFailed: async () => {},
    createSubmissionOutcomeUnknownError: error => error,
  });
}

async function dispatchAtWorkerBoundary(run, payload, dependencies) {
  try { await run(payload); }
  catch (error) { if (!await recoverAudioProviderNetworkError(payload, error, dependencies)) throw error; }
}

test('actual speech dispatch submits once and polls the same ID through five network errors then fails', async () => {
  const f = fixture({ status: 'INIT', apiRequestId: null, generationId: null });
  let submits = 0; const polled = [];
  const run = speechWorker(f, { submit: async () => { submits++; return { requestId: 'accepted-provider-request' }; },
    status: async requestId => { polled.push(requestId); throw networkError(); } });
  await dispatchAtWorkerBoundary(run, structuredClone(f.request), f.dependencies);
  for (let i = 0; i < 5; i++) await dispatchAtWorkerBoundary(run, structuredClone(f.request), f.dependencies);
  assert.equal(submits, 1);
  assert.deepEqual(polled, Array(5).fill('accepted-provider-request'));
  assert.equal(f.request.status, 'FAILED'); assert.equal(f.sessionUpdates.length, 1);
});

test('completed-provider output download retries use the same receipt without another submission', async () => {
  const f = fixture(); let submits = 0; const ids = []; let downloads = 0;
  const run = speechWorker(f, { submit: async () => { submits++; },
    status: async requestId => { ids.push(requestId); return { status: 'COMPLETED', audio: '/paid-output.wav' }; },
    finalize: async (_payload, url) => { assert.equal(url, '/paid-output.wav'); if (++downloads === 1) throw networkError(); } });
  await dispatchAtWorkerBoundary(run, structuredClone(f.request), f.dependencies);
  await dispatchAtWorkerBoundary(run, structuredClone(f.request), f.dependencies);
  assert.equal(submits, 0); assert.equal(downloads, 2);
  assert.deepEqual(ids, ['accepted-provider-request', 'accepted-provider-request']);
});


test('a pause racing terminal-marker settlement retains the failure receipt until resume', async () => {
  const f = fixture({ providerNetworkErrorCount: 4 });
  f.dependencies.SessionModel.updateOne = async () => {
    f.session.expressGenerationPaused = true;
    return { matchedCount: 0 };
  };
  await recoverAudioProviderNetworkError(f.request, networkError(), f.dependencies);
  assert.equal(f.request.status, 'FAILED');
  assert.equal(f.request.providerNetworkFailureFinalized, false);
  f.session.expressGenerationPaused = false;
  f.dependencies.SessionModel.updateOne = async (...args) => { f.sessionUpdates.push(args); return { matchedCount: 1 }; };
  f.dependencies.AudioModel.find = async query => query.status === 'FAILED' ? [f.request] : [];
  await recoverExpiredAudioSubmissions(f.dependencies);
  assert.equal(f.request.providerNetworkFailureFinalized, true);
  assert.equal(f.sessionUpdates.length, 1);
});

test('a late completed audio target finalizes only the queue failure and never overwrites successful output', async () => {
  const f = fixture({ providerNetworkErrorCount: 4 });
  let attempts = 0;
  f.dependencies.SessionModel.updateOne = async () => {
    attempts++;
    Object.assign(f.session.audioLayers[0], { generationStatus: 'COMPLETED', selectedLocalAudioLink: '/late-success.wav' });
    return { matchedCount: 0 };
  };
  await recoverAudioProviderNetworkError(f.request, networkError(), f.dependencies);
  assert.equal(f.request.providerNetworkFailureFinalized, true);
  assert.equal(f.session.audioLayers[0].selectedLocalAudioLink, '/late-success.wav');
  assert.equal(f.session.providerNetworkFailure, undefined);
  assert.equal(attempts, 1);
});
