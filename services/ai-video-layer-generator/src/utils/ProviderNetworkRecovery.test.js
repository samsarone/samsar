import test from 'node:test';
import assert from 'node:assert/strict';
import { createFalClient } from '@fal-ai/client';
import { SamsarClient } from 'samsar-js';
import { providerRequestFetch, isProviderNetworkError, buildExpiredProviderLeaseRecovery,
  getProviderResultInfrastructureCode } from './ProviderNetworkRecovery.js';
import { generateSyncLipSyncLayer, listenToPendingSyncLipSyncRequests } from '../character/SyncLipSyncListener.js';
import { completeVideoOutput } from '../billing/VideoCompletion.js';

test('the installed FAL SDK sends one POST after an ambiguous 503, with a transport deadline', async t => {
  let posts = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.method, 'POST');
    assert.ok(options.signal instanceof AbortSignal);
    posts++;
    return new Response(JSON.stringify({ detail: 'temporarily unavailable' }), {
      status: 503, headers: { 'content-type': 'application/json' },
    });
  });
  const client = createFalClient({ credentials: 'mock-credential', fetch: providerRequestFetch });
  await assert.rejects(client.queue.submit('fal-ai/sync-lipsync/v3', { input: {} }), { status: 503 });
  assert.equal(posts, 1);
});

test('the installed Samsar SDK sends one POST after an ambiguous 503', async t => {
  let posts = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.method, 'POST');
    assert.ok(options.signal instanceof AbortSignal);
    posts++;
    return new Response(JSON.stringify({ error: 'temporarily unavailable' }), {
      status: 503, headers: { 'content-type': 'application/json' },
    });
  });
  const client = new SamsarClient({ apiKey: 'mock-credential', baseUrl: 'https://api.example.com', fetch: providerRequestFetch });
  await assert.rejects(client.requestV2ExternalVideo('direct_text_to_video', { input: {} }), { status: 503 });
  assert.equal(posts, 1);
});

for (const policy of ['adapter', 'pipeline']) {
  test(`${policy}: poll, result, download and delivery outages reuse one accepted request and durable output`, async t => {
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'error', () => {});
    let submits = 0, statuses = 0, results = 0, downloads = 0, deliveries = 0;
    const payload = { _id: 'queue', sessionId: 'session', layerId: 'layer', model: 'SYNCLIPSYNC',
      submittedAdapter: 'fal', videoBillingPolicy: policy,
      videoLink: 'https://media.example/base.mp4', audioLink: 'https://media.example/speech.wav' };
    const queue = {
      submit: async () => { submits++; return { request_id: 'original-request' }; },
      status: async (_model, options) => {
        assert.equal(options.requestId, 'original-request');
        if (++statuses === 1) throw Object.assign(new Error('network stalled'), { code: 'ETIMEDOUT' });
        return { status: 'COMPLETED' };
      },
      result: async (_model, options) => {
        assert.equal(options.requestId, 'original-request');
        if (++results === 1) throw Object.assign(new Error('gateway unavailable'), { status: 504 });
        return { data: { video: { url: 'https://media.example/completed.mp4' } } };
      },
    };
    payload.generationId = await generateSyncLipSyncLayer(payload, { queue });
    const deps = { connect: async () => {}, queue };
    await assert.rejects(listenToPendingSyncLipSyncRequests(payload, deps), { code: 'ETIMEDOUT' });
    await assert.rejects(listenToPendingSyncLipSyncRequests(payload, deps), { status: 504 });
    const response = await listenToPendingSyncLipSyncRequests(payload, deps);
    let durable;
    const completion = { env: {}, checkpoint: async (_id, saved) => { durable = structuredClone(saved); },
      retain: async () => {}, bill: async () => null,
      attachLocalBillingResult: async (_job, saved) => ({ result: saved }),
      download: async () => {
        if (++downloads === 1) throw Object.assign(new Error('download reset'), { code: 'ECONNRESET' });
        return '/local/completed.mp4';
      },
      deliver: async () => { if (++deliveries === 1) throw new Error('delivery unavailable'); },
    };
    await assert.rejects(completeVideoOutput(payload, response, completion));
    assert.equal(durable.remoteUrl, response.remoteUrl);
    assert.equal(durable.videoBillingReceipt.providerRequestId, 'original-request');
    const retry = { ...payload, videoBillingSavedResult: durable };
    await assert.rejects(completeVideoOutput(retry, undefined, completion));
    await completeVideoOutput({ ...retry, videoBillingSavedResult: durable }, undefined, completion);
    assert.equal(submits, 1);
    assert.equal(statuses, 3);
    assert.equal(results, 2);
    assert.equal(downloads, 2);
    assert.equal(deliveries, 2);
  });
}

test('expired network leases preserve accepted identity and reject ambiguous submission replay', () => {
  const now = new Date();
  const leased = { requestOwner: 'old-worker', requestLeaseExpiresAt: new Date(now.getTime() - 1) };
  const accepted = { ...leased, generationId: 'accepted', submittedAdapter: 'fal', videoBillingNativeReceipt: { sealed: true } };
  const recovery = buildExpiredProviderLeaseRecovery(accepted, now);
  assert.equal(recovery.$set.status, 'PENDING');
  assert.equal(Object.hasOwn(recovery.$set, 'generationId'), false);
  assert.equal(Object.hasOwn(recovery.$set, 'submittedAdapter'), false);
  assert.equal(Object.hasOwn(recovery.$set, 'videoBillingNativeReceipt'), false);
  assert.equal(buildExpiredProviderLeaseRecovery({ ...leased, providerSubmissionStartedAt: now }, now).$set.infrastructureFailureCode,
    'PROVIDER_SUBMISSION_OUTCOME_UNKNOWN');
  assert.equal(buildExpiredProviderLeaseRecovery(leased, now).$set.status, 'INIT');
  assert.equal(buildExpiredProviderLeaseRecovery({ rowLocked: true }, now), null, 'legacy jobs are outside recovery');
});

test('completed provider media-download rejection is terminal and network classification includes Docker DNS/routes', () => {
  assert.equal(getProviderResultInfrastructureCode({ providerStatus: { status: 422,
    detail: [{ type: 'file_download_error', msg: 'Failed to download file' }] } }), 'PROVIDER_MEDIA_DOWNLOAD_FAILED');
  for (const error of [{ status: 530 }, { cause: { code: 'ENETUNREACH' } }, { code: 'ENOTFOUND' }, { name: 'TimeoutError' }]) {
    assert.equal(isProviderNetworkError(error), true);
  }
  assert.equal(isProviderNetworkError({ status: 422 }), false);
});
