import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import VideoSession from './schema/VideoSession.js';
import AIVideoLayerGeneration from './schema/AIVideoLayerGeneration.js';
import {
  generatePendingAiVideoLayerRequests,
  pollForAIVideoCompletion,
  protectsAmbiguousVideoSubmission,
  shouldRetryBaseGeneration,
  processVideoGenerationFailed,
} from './VideoGenerationListener.js';
import { requestGenBlazeVideo, generateGenBlazeVideoLayer } from './base/GenBlazeVideoListener.js';

function fixture(t, model) {
  Object.defineProperty(mongoose.connection, 'readyState', { configurable: true, value: 1 });
  t.after(() => { delete mongoose.connection.readyState; });
  t.mock.method(Math, 'random', () => 0);
  t.mock.method(Date, 'now', () => 2_000_000_000_000);
  t.mock.method(console, 'error', () => {});
  const previous = process.env.SAMSAR_GENBLAZE_ENABLED;
  process.env.SAMSAR_GENBLAZE_ENABLED = 'true';
  t.after(() => {
    if (previous === undefined) delete process.env.SAMSAR_GENBLAZE_ENABLED;
    else process.env.SAMSAR_GENBLAZE_ENABLED = previous;
  });
  const layer = { _id: 'layer', layerAiVideoType: 'sound_effect', aiVideoGenerationStatus: 'PENDING', aiVideoGenerationPending: true };
  const completed = { _id: 'completed', aiVideoGenerationStatus: 'COMPLETED', aiVideoLayer: 'keep.mp4' };
  const job = {
    _id: 'job', sessionId: 'session', layerId: 'layer', model,
    generationType: 'generate', submittedAdapter: 'gmicloud',
    generationId: 'genblaze-video:existing-job', status: 'PENDING',
    requestSubmitAt: new Date(Date.now()), retryOnFail: true,
    numRetries: 2, rowLocked: false, transientProviderErrorCount: 0,
    dockerAdapterFailoverDisabled: true,
  };
  const row = () => ({ ...job, toObject: () => ({ ...job }) });
  let deleted = false;
  t.mock.method(AIVideoLayerGeneration, 'find', (filter) => {
    const matches = !deleted && (
      filter.status === job.status || filter.status?.$in?.includes(job.status) ||
      (filter.$or && job.status === 'PENDING')
    );
    const query = { exec: async () => matches ? [row()] : [], sort: () => query };
    return query;
  });
  t.mock.method(AIVideoLayerGeneration, 'findById', () => ({ lean: async () => ({ ...job }) }));
  t.mock.method(AIVideoLayerGeneration, 'findByIdAndUpdate', async (id, update) => {
    assert.equal(id, 'job');
    Object.assign(job, update.$set || update);
    for (const [key, value] of Object.entries(update.$inc || {})) job[key] = (job[key] || 0) + value;
  });
  t.mock.method(VideoSession, 'findById', async () => ({ layers: [completed, layer] }));
  t.mock.method(VideoSession, 'updateOne', async (filter, update) => {
    assert.equal(filter['layers._id'], 'layer');
    for (const [key, value] of Object.entries(update.$set)) {
      if (key.startsWith('layers.$.')) layer[key.slice(9)] = value;
    }
  });
  t.mock.method(AIVideoLayerGeneration, 'findByIdAndDelete', async () => {
    assert.equal(layer.aiVideoGenerationStatus, 'FAILED');
    deleted = true;
  });
  let reply = { status: 'pending' };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, method: options.method });
    assert.equal(options.method, 'GET');
    assert.ok(url.endsWith('/media/requests/existing-job'));
    return {
      ok: true, status: 200, headers: {},
      text: async () => typeof reply === 'string' ? reply : JSON.stringify(reply),
    };
  });
  return { job, layer, completed, row, calls, respond: value => { reply = value; } };
}

for (const model of ['SEEDANCE2.0I2V', 'VEO3.1', 'VEO3.1FAST', 'HAILUOPRO']) {
  test(`${model}: malformed polls retry the same job, recover, and exhaust without resubmission`, async t => {
    const f = fixture(t, model);
    f.respond('<html>temporary proxy failure</html>');
    await generatePendingAiVideoLayerRequests();
    assert.equal(f.job.status, 'PENDING');
    assert.equal(f.job.transientProviderErrorCount, 1);
    assert.equal(f.job.nextAttemptAfter.getTime() - Date.now(), 10_000);
    f.respond({ status: 'pending' });
    f.job.nextAttemptAfter = null;
    await generatePendingAiVideoLayerRequests();
    assert.equal(f.job.transientProviderErrorCount, 0);
    f.respond({ status: 'unrecognized' });
    for (const delay of [10_000, 20_000, 40_000, 60_000, 60_000, 0]) {
      f.job.nextAttemptAfter = null;
      await generatePendingAiVideoLayerRequests();
      assert.equal(f.job.nextAttemptAfter === null ? 0 : f.job.nextAttemptAfter.getTime() - Date.now(), delay);
    }
    assert.equal(f.job.status, 'FAILED');
    assert.equal(f.job.retryOnFail, false);
    assert.equal(f.job.providerFailureDefinitive, false);
    assert.equal(f.job.generationId, 'genblaze-video:existing-job');
    assert.equal(shouldRetryBaseGeneration({ generation: f.job, payload: { retryOnFail: true } }), false);
    await generatePendingAiVideoLayerRequests();
    assert.equal(f.layer.aiVideoGenerationStatus, 'FAILED');
    assert.equal(f.layer.aiVideoGenerationPending, false);
    assert.match(f.layer.aiVideoGenerationError, /status checks exhausted/);
    assert.deepEqual(f.completed, { _id: 'completed', aiVideoGenerationStatus: 'COMPLETED', aiVideoLayer: 'keep.mp4' });
    assert.equal(f.calls.length, 8);
  });

  test(`${model}: continuously pending jobs time out and finalize without another generation`, async t => {
    const f = fixture(t, model);
    f.job.requestSubmitAt = new Date(Date.now() - 31 * 60_000);
    await generatePendingAiVideoLayerRequests();
    assert.equal(f.job.status, 'FAILED');
    assert.equal(f.job.providerPollingTimedOut, true);
    assert.equal(f.job.providerFailureDefinitive, false);
    assert.equal(f.job.retryOnFail, false);
    await generatePendingAiVideoLayerRequests();
    assert.equal(f.layer.aiVideoGenerationStatus, 'FAILED');
    assert.match(f.layer.aiVideoGenerationError, /remained pending/);
    assert.equal(f.calls.length, 1);
  });

  for (const status of ['failed', 'cancelled']) {
    test(`${model}: confirmed ${status} reaches base failure immediately`, async t => {
      const f = fixture(t, model);
      f.respond({ status, error: 'Provider rejected generation.' });
      await pollForAIVideoCompletion(f.row());
      assert.equal(f.layer.aiVideoGenerationStatus, 'FAILED');
      assert.match(f.layer.aiVideoGenerationError, /Provider rejected generation/);
      assert.equal(f.calls.length, 1);
      assert.equal(f.job.transientProviderErrorCount, 0);
    });
  }
}

test('GMI T2V submission protection applies in hosted deployments too', t => {
  const previous = process.env.SAMSAR_DEPLOYMENT_EDITION;
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'hosted';
  t.after(() => {
    if (previous === undefined) delete process.env.SAMSAR_DEPLOYMENT_EDITION;
    else process.env.SAMSAR_DEPLOYMENT_EDITION = previous;
  });
  for (const model of ['VEO3.1', 'VEO3.1FAST', 'HAILUOPRO']) {
    assert.equal(protectsAmbiguousVideoSubmission({ model, dockerVideoProvider: 'gmicloud' }), true);
  }
  assert.equal(protectsAmbiguousVideoSubmission({ model: 'SYNCLIPSYNC', dockerVideoProvider: 'fal' }), false);
  assert.equal(protectsAmbiguousVideoSubmission({ model: 'SEEDANCE2.0I2V', generationType: 'sound_effect', dockerVideoProvider: 'gmicloud' }), false);
});

test('accepted submissions without a request ID remain ambiguous and must not be resubmitted', async () => {
  await assert.rejects(generateGenBlazeVideoLayer({ model: 'VEO3.1' }, {
    request: async () => ({}),
  }), error => error.status === 502 && error.code === 'invalid_upstream_response');
});

for (const status of [403, 429, 502, 503]) {
  test(`non-JSON HTTP ${status} retains its status and retry headers`, async () => {
    await assert.rejects(requestGenBlazeVideo('/media/requests/job', {
      env: { SAMSAR_GENBLAZE_ENABLED: 'true' },
      fetchImpl: async () => ({ ok: false, status, headers: { 'Retry-After': '20' }, text: async () => '<html>error</html>' }),
    }), error => error.status === status && error.headers['retry-after'] === '20');
  });
}

for (const body of ['', 'null', '[]', '"unexpected"']) {
  test(`invalid successful envelope ${JSON.stringify(body)} is retryable`, async () => {
    await assert.rejects(requestGenBlazeVideo('/media/requests/job', {
      env: { SAMSAR_GENBLAZE_ENABLED: 'true' },
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => body }),
    }), error => error.status === 502);
  });
}

for (const model of ['VEO3.1', 'VEO3.1FAST', 'HAILUOPRO']) {
  test(`${model}: wrapped submit 403 does not resubmit or enter Google fallback`, async t => {
    const f = fixture(t, model);
    Object.assign(f.job, { status: 'INIT', generationId: null, dockerVideoProvider: 'gmicloud', framesPerSecond: 24, numRetries: 0 });
    let submissions = 0;
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      assert.equal(options.method, 'POST');
      assert.ok(url.endsWith('/media/requests'));
      assert.equal(JSON.parse(options.body).model, model);
      submissions++;
      return {
        ok: false, status: 502, headers: {},
        text: async () => JSON.stringify({ error: {
          code: 'server_error', message: 'GMICloud submit failed (500): Backend error (403). Please try again.',
        } }),
      };
    });
    await generatePendingAiVideoLayerRequests();
    assert.equal(submissions, 1);
    assert.equal(f.job.status, 'FAILED');
    assert.equal(f.job.submissionOutcomeUnknown, true);
    assert.equal(f.job.providerFailureDefinitive, false);
    assert.equal(f.job.retryOnFail, false);
    await generatePendingAiVideoLayerRequests();
    assert.equal(submissions, 1);
    assert.equal(f.layer.aiVideoGenerationStatus, 'FAILED');
    assert.match(f.layer.aiVideoGenerationError, /Backend error \(403\)/);
  });
}

for (const response of [{ status: 'succeeded', assets: [] }, { status: 'succeeded', assets: [{ url: 'invalid' }] }]) {
  test(`incomplete success response is retried without failing the provider job: ${JSON.stringify(response)}`, async t => {
    const f = fixture(t, 'VEO3.1');
    f.respond(response);
    await generatePendingAiVideoLayerRequests();
    assert.equal(f.job.status, 'PENDING');
    assert.equal(f.job.transientProviderErrorCount, 1);
    assert.equal(f.layer.aiVideoGenerationStatus, 'PENDING');
    assert.equal(f.calls.length, 1);
  });
}

for (const [model, generationType, field] of [
  ['SEEDANCE2.0I2V', 'sound_effect', 'soundEffectVideoGenerationStatus'],
  ['SYNCLIPSYNC', 'lip_sync', 'lipSyncVideoGenerationStatus'],
]) {
  test(`explicit ${generationType} failure retains its separate handler`, async t => {
    const f = fixture(t, model);
    Object.assign(f.job, { generationType, retryOnFail: false });
    f.layer.aiVideoGenerationStatus = 'COMPLETED';
    f.layer.aiVideoGenerationPending = false;
    if (generationType === 'lip_sync') f.layer.layerAiVideoType = 'ai_video';
    let saved = false;
    t.mock.method(VideoSession, 'findById', async () => ({ layers: [f.layer], save: async () => { saved = true; } }));
    t.mock.method(AIVideoLayerGeneration, 'findByIdAndDelete', async () => { assert.equal(saved, true); });
    await processVideoGenerationFailed(f.job);
    assert.equal(f.layer[field], 'FAILED');
    assert.equal(f.layer.aiVideoGenerationStatus, 'COMPLETED');
  });
}

for (const status of [401, 403]) {
  test(`poll HTTP ${status} cannot trigger HappyHorse's automatic express retry`, async t => {
    const f = fixture(t, 'HAPPYHORSEI2V');
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      assert.equal(options.method, 'GET');
      return { ok: false, status, headers: {}, text: async () => '<html>access denied</html>' };
    });
    await generatePendingAiVideoLayerRequests();
    assert.equal(f.job.status, 'FAILED');
    assert.equal(f.job.providerPollingFailed, true);
    assert.equal(shouldRetryBaseGeneration({ generation: f.job, videoSession: { isExpressGeneration: true } }), false);
    await generatePendingAiVideoLayerRequests();
    assert.equal(f.layer.aiVideoGenerationStatus, 'FAILED');
    assert.match(f.layer.aiVideoGenerationError, new RegExp(`status ${status}`));
  });
}
