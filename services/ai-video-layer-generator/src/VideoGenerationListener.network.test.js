import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { fal } from '@fal-ai/client';
import { GoogleAuth } from 'google-auth-library';
import { generateGenBlazeVideoLayer } from './base/GenBlazeVideoListener.js';
import AIVideoLayerGeneration from './schema/AIVideoLayerGeneration.js';
import VideoSession from './schema/VideoSession.js';
import { providerNetworkCircuit, providerRequestAxiosOptions } from './utils/ProviderNetworkTransport.js';
import { withProviderRequestClaim, generatePendingAiVideoLayerRequests, processVideoGenerationFailed,
  pollForAIVideoCompletion } from './VideoGenerationListener.js';

function fixture(t) {
  providerNetworkCircuit.recordSuccess();
  Object.defineProperty(mongoose.connection, 'readyState', { configurable: true, value: 1 });
  t.after(() => { delete mongoose.connection.readyState; });
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  const sessionId = new mongoose.Types.ObjectId(), layerId = new mongoose.Types.ObjectId();
  const session = new VideoSession({ _id: sessionId, expressGenerationPending: true,
    expressGenerationStatus: { lip_sync_generation: 'PENDING' },
    layers: [{ _id: layerId, layerAiVideoType: 'character', aiVideoLayer: '/base.mp4',
      aiVideoGenerationStatus: 'COMPLETED', hasAiVideoLayer: true,
      lipSyncVideoGenerationStatus: 'PENDING', lipSyncGenerationPending: true }] });
  const job = new AIVideoLayerGeneration({ sessionId: String(sessionId), layerId: String(layerId),
    model: 'SYNCLIPSYNC', generationType: 'lip_sync', framesPerSecond: 24, duration: 5,
    videoLink: 'https://cdn.example.com/base.mp4', audioLink: 'https://cdn.example.com/audio.wav',
    retryOnFail: true, rowLocked: false, status: 'INIT' });
  const apply = update => {
    job.set(update.$set || update);
    for (const [key, value] of Object.entries(update.$inc || {})) job.set(key, (job.get(key) || 0) + value);
    for (const key of Object.keys(update.$unset || {})) job.set(key, undefined);
  };
  t.mock.method(AIVideoLayerGeneration, 'find', filter => {
    const matches = !job.infrastructureFailureFinalized && (filter.status === job.status ||
      filter.status?.$in?.includes(job.status) || (filter.$or && job.status === 'PENDING'));
    const query = { exec: async () => matches ? [job] : [], sort: () => query };
    return query;
  });
  t.mock.method(AIVideoLayerGeneration, 'findOneAndUpdate', async (filter, update) => {
    if (filter.status !== job.status || (filter.requestOwner && filter.requestOwner !== job.requestOwner) ||
      (filter.rowLocked === false && job.rowLocked) ||
      (filter.providerSubmissionStartedAt === null && job.providerSubmissionStartedAt)) return null;
    apply(update);
    return job;
  });
  t.mock.method(AIVideoLayerGeneration, 'findByIdAndUpdate', async (_id, update) => { apply(update); return job; });
  t.mock.method(AIVideoLayerGeneration, 'updateOne', async (filter, update) => {
    if (filter.requestOwner && filter.requestOwner !== job.requestOwner) return { matchedCount: 0 };
    apply(update);
    return { matchedCount: 1 };
  });
  t.mock.method(VideoSession, 'findById', () => ({ select: async () => session,
    then: (resolve, reject) => Promise.resolve(session).then(resolve, reject) }));
  t.mock.method(VideoSession, 'updateOne', async (_filter, update, options) => {
    assert.equal(options.strict, false);
    for (const [key, value] of Object.entries(update.$set)) {
      if (key.startsWith('layers.$.')) session.layers[0].set(key.slice(9), value, { strict: false });
      else session.set(key, value, { strict: false });
    }
    return { matchedCount: 1, modifiedCount: 1 };
  });
  return { job, session };
}

test('a shared known outage defers every adapter before the submit attempt and recovers without a duplicate POST', async t => {
  const { job } = fixture(t);
  let submits = 0;
  t.mock.method(fal.queue, 'submit', async () => { submits++; return { request_id: 'accepted-after-recovery' }; });
  providerNetworkCircuit.recordFailure({ code: 'ENETUNREACH' });
  await generatePendingAiVideoLayerRequests();
  assert.equal(submits, 0);
  assert.equal(job.status, 'INIT');
  assert.equal(job.providerSubmissionStartedAt, undefined);
  assert.equal(job.transientProviderErrorPhase, 'prepare');
  assert.equal(job.submissionOutcomeUnknown, false);
  providerNetworkCircuit.recordSuccess();
  job.nextAttemptAfter = null;
  await generatePendingAiVideoLayerRequests();
  assert.equal(submits, 1);
  assert.equal(job.status, 'PENDING');
  assert.equal(job.generationId, 'accepted-after-recovery');
  assert.equal(job.submittedAdapter, 'fal');
});

test('a repeated shared outage exhausts the queue wait budget without any provider submission', async t => {
  const { job, session } = fixture(t);
  t.mock.method(fal.queue, 'submit', async () => assert.fail('blocked admission cannot send a POST'));
  providerNetworkCircuit.recordFailure({ code: 'ENETUNREACH' });
  for (let attempt = 0; attempt < 6; attempt++) {
    job.nextAttemptAfter = null;
    await generatePendingAiVideoLayerRequests();
  }
  assert.equal(job.status, 'FAILED');
  assert.equal(job.providerSubmissionStartedAt, undefined);
  assert.equal(job.submissionOutcomeUnknown, false);
  await generatePendingAiVideoLayerRequests();
  assert.equal(session.get('providerNetworkFailure').code, 'PROVIDER_NETWORK_RETRY_EXHAUSTED');
});

test('provider HTTP throttling does not open the Docker outage gate and native Axios requests have finite deadlines', () => {
  providerNetworkCircuit.recordSuccess();
  providerNetworkCircuit.recordFailure({ status: 503 });
  assert.equal(providerNetworkCircuit.snapshot().allowed, true);
  const options = providerRequestAxiosOptions({ headers: { Accept: 'application/json' } });
  assert.ok(Number.isFinite(options.timeout) && options.timeout > 0);
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(options.headers.Accept, 'application/json');
});

test('a DB failure after a claimed attempt leaves a scoped lease for safe identity recovery', async t => {
  const { job } = fixture(t);
  const error = Object.assign(new Error('Mongo connection reset'), { name: 'MongoNetworkError', code: 'ECONNRESET' });
  await assert.rejects(withProviderRequestClaim(job, async claimed => {
    claimed.providerSubmissionStartedAt = new Date();
    throw error;
  }), error);
  assert.equal(job.rowLocked, true);
  assert.ok(job.requestOwner);
  assert.ok(job.requestLeaseExpiresAt);
});

test('accepted lip-sync poll outages exhaust a bounded budget while retaining the same ID and adapter', async t => {
  const { job, session } = fixture(t);
  job.set({ status: 'PENDING', generationId: 'accepted', submittedAdapter: 'fal', requestSubmitAt: new Date() });
  let polls = 0;
  t.mock.method(fal.queue, 'submit', async () => assert.fail('accepted poll failure cannot issue a POST'));
  t.mock.method(fal.queue, 'status', async (_model, options) => {
    assert.equal(options.requestId, 'accepted');
    polls++;
    throw Object.assign(new Error('Gateway unavailable'), { status: 504 });
  });
  for (let attempt = 0; attempt < 6; attempt++) {
    job.nextAttemptAfter = null;
    await generatePendingAiVideoLayerRequests();
  }
  assert.equal(polls, 6);
  assert.equal(job.status, 'FAILED');
  assert.equal(job.generationId, 'accepted');
  assert.equal(job.submittedAdapter, 'fal');
  await generatePendingAiVideoLayerRequests();
  assert.equal(session.get('providerNetworkFailure').providerRequestId, 'accepted');
  assert.equal(session.get('providerNetworkFailure').code, 'PROVIDER_NETWORK_RETRY_EXHAUSTED');
});

test('an atomic claim allows one competing worker to process the same queued request', async t => {
  const { job } = fixture(t);
  let calls = 0, release;
  const blocked = new Promise(resolve => { release = resolve; });
  const first = withProviderRequestClaim(job, async () => { calls++; await blocked; });
  await withProviderRequestClaim(job, async () => { calls++; });
  release();
  await first;
  assert.equal(calls, 1);
  assert.equal(job.rowLocked, false);
});

test('an ambiguous lip-sync submission fails the session marker and is never replayed or switched', async t => {
  const { job, session } = fixture(t);
  let submits = 0;
  t.mock.method(fal.queue, 'submit', async () => {
    submits++;
    throw Object.assign(new Error('Connection lost after POST'), { code: 'ECONNRESET' });
  });
  await generatePendingAiVideoLayerRequests();
  assert.equal(submits, 1);
  assert.ok(job.providerSubmissionStartedAt);
  assert.equal(job.submissionOutcomeUnknown, true);
  assert.equal(job.status, 'FAILED');
  await generatePendingAiVideoLayerRequests();
  await generatePendingAiVideoLayerRequests();
  assert.equal(submits, 1);
  assert.equal(job.model, 'SYNCLIPSYNC');
  assert.equal(job.infrastructureFailureFinalized, true);
  assert.equal(session.get('providerNetworkFailure').code, 'PROVIDER_SUBMISSION_OUTCOME_UNKNOWN');
  assert.equal(session.expressGenerationPending, true, 'Express must consume and settle the guarded failure');
  assert.equal(session.layers[0].get('lipSyncInfrastructureFailure'), true);
  assert.equal(session.layers[0].aiVideoLayer, '/base.mp4');
});

test('a completed FAL file_download_error fails once and retains the accepted request and receipt', async t => {
  const { job, session } = fixture(t);
  job.set({ status: 'PENDING', generationId: 'accepted', submittedAdapter: 'fal',
    requestSubmitAt: new Date(), videoBillingNativeReceipt: { provider: 'fal', sealed: true } });
  let results = 0;
  t.mock.method(fal.queue, 'submit', async () => assert.fail('accepted request must never be resubmitted'));
  t.mock.method(fal.queue, 'status', async () => ({ status: 'COMPLETED' }));
  t.mock.method(fal.queue, 'result', async () => { results++; throw Object.assign(new Error('Failed to download file'), {
    status: 422, body: { detail: [{ type: 'file_download_error', msg: 'Failed to download file' }] },
  }); });
  await generatePendingAiVideoLayerRequests();
  await generatePendingAiVideoLayerRequests();
  assert.equal(results, 1);
  assert.equal(job.generationId, 'accepted');
  assert.equal(job.submittedAdapter, 'fal');
  assert.equal(job.videoBillingNativeReceipt.sealed, true);
  assert.equal(session.get('providerNetworkFailure').code, 'PROVIDER_MEDIA_DOWNLOAD_FAILED');
});

for (const control of ['expressGenerationPaused', 'expressGenerationCancelled', 'completed']) {
  test(`${control} prevents stale provider failure or new request mutation`, async t => {
    const { job, session } = fixture(t);
    if (control === 'completed') session.layers[0].set({ lipSyncVideoGenerationStatus: 'COMPLETED',
      lipSyncGenerationPending: false, hasLipSyncVideoLayer: true, lipSyncVideoLayer: '/finished.mp4' });
    else session.set(control, true);
    t.mock.method(VideoSession, 'updateOne', async () => assert.fail('inactive/completed session must not be mutated'));
    t.mock.method(fal.queue, 'submit', async () => assert.fail('inactive/completed session must not be submitted'));
    t.mock.method(fal.queue, 'status', async () => assert.fail('inactive/completed session must not be polled'));
    await generatePendingAiVideoLayerRequests();
    await pollForAIVideoCompletion(job);
    await processVideoGenerationFailed({ ...job.toObject(), infrastructureFailureCode: 'PROVIDER_NETWORK_RETRY_EXHAUSTED' });
    assert.equal(job.status, 'INIT');
  });
}

function hostedGoogle(t, job, session) {
  const overrides = { CURRENT_ENV: 'production', SAMSAR_DEPLOYMENT_EDITION: 'production',
    SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED: 'false', SAMSAR_HOSTED_GENBLAZE_VIDEO_ENABLED: 'false',
    SAMSAR_GENBLAZE_ENABLED: 'false', SAMSAR_EXTERNAL_PROVIDERS_ENABLED: 'false',
    GOOGLE_CLOUD_PROJECT: 'mock-project', GOOGLE_VEO_NATIVE_ENABLED: 'true', GOOGLE_VEO_USE_FAL: 'false' };
  const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  job.set({ model: 'VEO3.1', generationType: 'generate', prompt: 'A quiet valley',
    generationId: null, videoLink: null, audioLink: null });
  session.layers[0].set({ aiVideoGenerationStatus: 'PENDING', aiVideoGenerationPending: true });
  t.mock.method(GoogleAuth.prototype, 'getClient', async () => ({ getAccessToken: async () => 'mock-token' }));
}

test('hosted Google known submit rejection retains its configured fallback', async t => {
  const { job, session } = fixture(t);
  hostedGoogle(t, job, session);
  let posts = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.method, 'POST'); posts++;
    return new Response(JSON.stringify({ error: { message: 'Unsupported request', status: 'INVALID_ARGUMENT' } }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  });
  await generatePendingAiVideoLayerRequests();
  assert.equal(posts, 1);
  assert.equal(job.status, 'INIT');
  assert.equal(job.get('googleVeoNativeFallbackUsed'), true);
  assert.equal(job.submissionOutcomeUnknown, false);
  assert.equal(job.infrastructureFailure, undefined);
  assert.equal(job.providerSubmissionStartedAt, null);
});

test('hosted Google local pre-POST validation retains fallback without becoming ambiguous', async t => {
  const { job, session } = fixture(t);
  hostedGoogle(t, job, session);
  job.prompt = '';
  t.mock.method(globalThis, 'fetch', async () => assert.fail('validation must precede POST'));
  await generatePendingAiVideoLayerRequests();
  assert.equal(job.status, 'INIT');
  assert.equal(job.get('googleVeoNativeFallbackUsed'), true);
  assert.equal(job.infrastructureFailure, undefined);
  assert.equal(job.providerSubmissionStartedAt, null);
});

test('hosted Google preparation network failure retries preparation without sending a request', async t => {
  const { job, session } = fixture(t);
  hostedGoogle(t, job, session);
  t.mock.method(GoogleAuth.prototype, 'getClient', async () => {
    throw Object.assign(new Error('Credential service route unavailable'), { code: 'ENETUNREACH' });
  });
  t.mock.method(globalThis, 'fetch', async () => assert.fail('no paid POST during preparation outage'));
  await generatePendingAiVideoLayerRequests();
  assert.equal(job.status, 'INIT');
  assert.equal(job.transientProviderErrorPhase, 'prepare');
  assert.equal(job.submissionOutcomeUnknown, false);
  assert.equal(job.providerSubmissionStartedAt, undefined);
});

test('hosted Google non-network completed provider rejection retains its configured fallback', async t => {
  const { job, session } = fixture(t);
  hostedGoogle(t, job, session);
  job.set({ status: 'PENDING', generationId: 'operations/original', submittedAdapter: 'googleCloud', requestSubmitAt: new Date() });
  let polls = 0, fallbackSubmits = 0;
  t.mock.method(fal.queue, 'submit', async () => { fallbackSubmits++; return { request_id: 'known-fallback' }; });
  t.mock.method(globalThis, 'fetch', async () => {
    polls++;
    return new Response(JSON.stringify({ done: true, error: { code: 3, message: 'Content rejected' } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  });
  await generatePendingAiVideoLayerRequests();
  assert.equal(polls, 1);
  assert.equal(fallbackSubmits, 1);
  assert.equal(job.status, 'PENDING');
  assert.equal(job.get('googleVeoNativeFallbackUsed'), true);
  assert.equal(job.infrastructureFailure, undefined);
});

test('terminal failure queue finalization retries after a DB outage without rewriting its consumed session marker', async t => {
  const { job, session } = fixture(t);
  job.set({ status: 'FAILED', generationId: 'accepted', submittedAdapter: 'fal',
    infrastructureFailure: true, infrastructureFailureCode: 'PROVIDER_NETWORK_RETRY_EXHAUSTED' });
  const originalUpdate = AIVideoLayerGeneration.findByIdAndUpdate;
  let updates = 0;
  t.mock.method(AIVideoLayerGeneration, 'findByIdAndUpdate', async (...args) => {
    if (++updates === 1) throw Object.assign(new Error('Mongo connection reset'), { name: 'MongoNetworkError', code: 'ECONNRESET' });
    return originalUpdate(...args);
  });
  await assert.rejects(processVideoGenerationFailed(job), { name: 'MongoNetworkError' });
  const marker = structuredClone(session.get('providerNetworkFailure'));
  session.expressGenerationFailed = true;
  session.expressGenerationPending = false;
  t.mock.method(VideoSession, 'updateOne', async () => assert.fail('consumed marker must remain unchanged'));
  await processVideoGenerationFailed(job);
  assert.equal(job.infrastructureFailureFinalized, true);
  assert.equal(job.generationId, 'accepted');
  assert.deepEqual(session.get('providerNetworkFailure'), marker);
});

test('a stale source marker cannot suppress a new genuine infrastructure failure', async t => {
  const { job, session } = fixture(t);
  session.set('providerNetworkFailure', { requestId: 'old-request', layerId: 'deleted-source-layer',
    code: 'PROVIDER_NETWORK_RETRY_EXHAUSTED', stage: 'ai_video_generation' }, { strict: false });
  job.set({ status: 'FAILED', generationId: 'accepted', submittedAdapter: 'fal',
    infrastructureFailure: true, infrastructureFailureCode: 'PROVIDER_NETWORK_RETRY_EXHAUSTED' });
  await processVideoGenerationFailed(job);
  assert.equal(job.infrastructureFailureFinalized, true);
  assert.equal(session.get('providerNetworkFailure').requestId, String(job._id));
});

test('GMI local validation is explicitly unsent and cannot be mistaken for ambiguous acceptance', async () => {
  await assert.rejects(generateGenBlazeVideoLayer({ model: 'SEEDANCE2.0I2V' }, {
    request: async () => assert.fail('local missing-image validation must precede POST'),
  }), error => error.providerRequestSent === false && /start image/.test(error.message));
});

test('custom adapter pre-POST configuration failure preserves its configured fallback', async t => {
  const { job, session } = fixture(t);
  job.set({ model: 'CUSTOM_IMAGE_TO_VIDEO', generationType: 'generate', customFallbackModel: 'VEO3.1',
    startImage: 'https://cdn.example.com/start.png' });
  session.layers[0].set({ aiVideoGenerationStatus: 'PENDING', aiVideoGenerationPending: true });
  t.mock.method(VideoSession, 'findById', () => {
    const query = { select: () => query, lean: async () => ({ _id: session._id, custom_adapters: null }),
      then: (resolve, reject) => Promise.resolve(session).then(resolve, reject) };
    return query;
  });
  t.mock.method(VideoSession, 'findByIdAndUpdate', async () => session);
  t.mock.method(fal.queue, 'submit', async () => assert.fail('configuration validation must precede POST'));
  await generatePendingAiVideoLayerRequests();
  assert.equal(job.status, 'INIT');
  assert.equal(job.model, 'VEO3.1');
  assert.equal(job.get('customAdapterFallbackUsed'), true);
  assert.equal(job.infrastructureFailure, undefined);
  assert.equal(job.providerSubmissionStartedAt, null);
});
