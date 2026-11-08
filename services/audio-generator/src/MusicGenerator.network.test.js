import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { recoverAudioProviderNetworkError } from './utils/AudioNetworkRecovery.js';
import { createNetworkOutageCircuit } from './utils/NetworkOutagePolicy.js';

function workerFixture(dispatch) {
  const request = { _id: 'request', sessionId: 'session', audioLayerId: 'audio',
    generationType: 'speech', status: 'INIT', rowLocked: false };
  const session = { isExpressGeneration: true, expressGenerationPending: true,
    audioLayers: [{ _id: 'audio', generationStatus: 'PENDING' }] };
  const sessionWrites = [], staleUnlockFilters = [];
  const matches = query => query._id === request._id &&
    (query.rowLocked === undefined || query.rowLocked === request.rowLocked) &&
    (query.status === undefined || query.status === request.status);
  const Model = {
    find: query => ({ limit: async () => query.status.$in.includes(request.status) && !request.rowLocked ? [structuredClone(request)] : [] }),
    findById: async () => structuredClone(request),
    updateMany: async filter => { staleUnlockFilters.push(filter); },
    findOneAndUpdate: async (query, update) => {
      if (!matches(query)) return null;
      Object.assign(request, update.$set || update);
      return structuredClone(request);
    },
    updateOne: async (query, update) => {
      if (!matches(query)) return { matchedCount: 0 };
      Object.assign(request, update.$set); return { matchedCount: 1 };
    },
    deleteOne: async () => assert.fail('An uncertain provider receipt must be retained'),
  };
  const SessionModel = { findOne: async () => session,
    updateOne: async (...args) => { sessionWrites.push(args); return { matchedCount: 1 }; } };
  const source = fs.readFileSync(new URL('./MusicGenerator.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('async function checkForPendingRequestsAndGenerate()'), source.indexOf('// ES Module equivalent'));
  const run = vm.runInNewContext(`${body};checkForPendingRequestsAndGenerate`, {
    Date, console: { error() {} }, MAX_CONCURRENT_REQUESTS: 3,
    getDBConnectionString: async () => {}, AudioGeneration: Model,
    recoverExpiredAudioSubmissions: async () => {}, canDispatchAudioRequest: async () => true,
    networkOutageCircuit: createNetworkOutageCircuit(),
    dispatchSpeechRequest: payload => dispatch(payload, request),
    recoverAudioProviderNetworkError: (payload, error, options) => recoverAudioProviderNetworkError(payload, error,
      { ...options, AudioModel: Model, SessionModel }),
    isSubmissionOutcomeUnknownError: error => error.submissionOutcomeUnknown === true,
    markAudioGenerationAsFailed: async () => assert.fail('Infrastructure failures use shared settlement'),
  });
  return { run, request, sessionWrites, staleUnlockFilters };
}

test('concurrent audio scans claim one INIT execution and retain its provider identity for polling', async () => {
  let posts = 0, polls = 0;
  const f = workerFixture(async (payload, request) => {
    if (payload.status === 'INIT') {
      posts++;
      assert.ok(payload.providerSubmissionStartedAt);
      assert.ok(payload.providerSubmissionLeaseExpiresAt > payload.providerSubmissionStartedAt);
      Object.assign(request, { status: 'PENDING', apiRequestId: 'accepted', rowLocked: false });
    } else {
      polls++;
      assert.equal(payload.apiRequestId, 'accepted'); request.rowLocked = false;
    }
  });
  await Promise.all([f.run(), f.run()]);
  await f.run();
  assert.equal(posts, 1); assert.ok(polls >= 1);
  assert.equal(f.request.apiRequestId, 'accepted');
});

test('a lost submission response fails once and is never submitted by the next scan', async () => {
  let posts = 0;
  const f = workerFixture(async () => {
    posts++;
    throw Object.assign(new Error('Connection reset after POST'), {
      code: 'ECONNRESET', submissionOutcomeUnknown: true,
    });
  });
  await f.run(); await f.run();
  assert.equal(posts, 1); assert.equal(f.request.status, 'FAILED');
  assert.equal(f.request.submissionOutcomeUnknown, true);
  assert.equal(f.sessionWrites.length, 1);
});


test('each accepted PENDING claim renews its lease without replacing the provider receipt or original submission time', async () => {
  const originalStart = new Date(1);
  const f = workerFixture(async (payload, request) => {
    assert.equal(payload.status, 'PENDING');
    assert.equal(payload.apiRequestId, 'accepted');
    assert.equal(payload.providerSubmissionStartedAt.getTime(), originalStart.getTime());
    assert.ok(payload.providerSubmissionLeaseExpiresAt.getTime() > Date.now() + 14 * 60 * 1000);
    request.rowLocked = false;
  });
  Object.assign(f.request, { status: 'PENDING', apiRequestId: 'accepted',
    providerSubmissionStartedAt: originalStart, providerSubmissionLeaseExpiresAt: new Date(2) });
  await f.run();
  assert.equal(f.request.apiRequestId, 'accepted');
  assert.equal(f.staleUnlockFilters[0].$or[0].providerSubmissionLeaseExpiresAt, null);
  assert.equal(f.staleUnlockFilters[0].$or[1].status, 'PENDING');
});
