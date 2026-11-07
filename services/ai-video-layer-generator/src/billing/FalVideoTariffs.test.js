import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFalVideoSubmissionReceipt, FAL_VIDEO_TARIFFS,
  FAL_VIDEO_TARIFF_VERSIONS, calculateFalVideoUsd,
  sealFalVideoSubmissionReceipt } from './FalVideoTariffs.js';
import { calculateVideoCallCredits } from './VideoPricing.js';
import { resolveVideoAdapterReceipt } from './VideoAdapterReceipt.js';

function price(payload) {
  return calculateVideoCallCredits(buildFalVideoSubmissionReceipt(payload));
}

test('every supported Fal video tariff identifies its exact endpoint and a dated source', () => {
  for (const [model, tariff] of Object.entries(FAL_VIDEO_TARIFFS)) {
    assert.ok(tariff.endpoint, model);
    assert.equal(tariff.source, `https://fal.ai/models/${tariff.endpoint}`);
    assert.equal(tariff.verifiedOn, model.endsWith('TOVID4') ? '2026-11-07' : model === 'MAGIDISTILLED' ? '2026-10-24' : '2026-10-23');
  }
});

test('Kling and Veo seal audio-specific rate and submitted duration', () => {
  assert.equal(price({ model: 'KLINGIMGTOVIDPRO', duration: 5 }).credits, 33.6);
  assert.equal(price({ model: 'KLINGIMGTOVID3PRO', duration: 10,
    generateAudio: false }).credits, 134.4);
  assert.equal(price({ model: 'KLINGIMGTOVID3PRO', duration: 10,
    generateAudio: true }).credits, 201.6);
  assert.equal(price({ model: 'VEO3.1I2VFAST', duration: 8,
    isAudioVideoGeneration: true }).credits, 144);
  assert.equal(price({ model: 'VEO3.1I2VFAST', duration: 8,
    isAudioVideoGeneration: false }).credits, 96);
  assert.equal(price({ model: 'VEO3.1FLIV', duration: 7,
    generate_audio: true }).credits, 384);
});

test('flat, frame, and rounded tariffs reflect submitted listener options', () => {
  assert.equal(price({ model: 'PIXVERSEI2V' }).credits, 48); // default 8s: twice the 5s video
  assert.equal(price({ model: 'PIXVERSEI2VFAST', duration: 5 }).credits, 48);
  assert.equal(price({ model: 'HAPPYHORSEI2V', duration: 7 }).credits, 168); // rounded to 10s
  assert.equal(price({ model: 'WANI2V', duration: 7 }).credits, 72.6); // 121/16 frame seconds
  assert.equal(price({ model: 'COSMOS3SUPERI2V', duration: 5,
    framesPerSecond: 24 }).credits, 30);
  assert.equal(price({ model: 'PIKA2.2I2V', duration: 5 }).credits, 24);
});

test('unverified model and configuration reject before a paid provider call', () => {
  for (const payload of [
    { model: 'HAIPER2.0' },
    { model: 'PIKA2.2I2V', duration: 10 },
    { model: 'WANI2V5B', duration: 7 },
    { model: 'PIXVERSEI2V', duration: 6 },
  ]) {
    assert.throws(() => buildFalVideoSubmissionReceipt(payload),
      error => error.code === 'FAL_VIDEO_TARIFF_UNAVAILABLE');
  }
});

test('hosted adapter seals before submit; pipeline, lip sync, and standalone bypass this guard', async () => {
  const hosted = { _id: 'queued-video', model: 'KLINGIMGTOVID3PRO', duration: 5,
    videoBillingPolicy: 'adapter' };
  const events = [];
  const persist = async (id, receipt) => {
    assert.equal(id, 'queued-video');
    assert.equal(receipt.tariffRateUsd, 0.112);
    events.push('persist');
    return { _id: id };
  };
  await sealFalVideoSubmissionReceipt(hosted, 'fal', persist,
    { SAMSAR_DEPLOYMENT_EDITION: 'production' });
  assert.equal(hosted.videoBillingNativeReceipt.falVideoTariffVersion, '2026-11-07');
  events.push('submit');
  assert.deepEqual(events, ['persist', 'submit']);

  for (const [payload, adapter, env] of [
    [{ ...hosted, videoBillingPolicy: 'pipeline' }, 'fal', { SAMSAR_DEPLOYMENT_EDITION: 'production' }],
    [{ ...hosted, model: 'SYNCLIPSYNC' }, 'fal', { SAMSAR_DEPLOYMENT_EDITION: 'production' }],
    [{ ...hosted, model: 'MIRELOAI' }, 'fal', { SAMSAR_DEPLOYMENT_EDITION: 'production' }],
    [hosted, 'samsar', { SAMSAR_DEPLOYMENT_EDITION: 'production' }],
    [hosted, 'fal', { SAMSAR_DEPLOYMENT_EDITION: 'standalone' }],
  ]) {
    assert.equal(await sealFalVideoSubmissionReceipt(payload, adapter,
      async () => assert.fail('No adapter video tariff persistence'), env), null);
  }
  await assert.rejects(sealFalVideoSubmissionReceipt({ _id: 'unpriced', model: 'HAIPER2.0',
    videoBillingPolicy: 'adapter' }, 'fal', async () => assert.fail('Unpriced request persisted'),
  { SAMSAR_DEPLOYMENT_EDITION: 'production' }),
  error => error.code === 'FAL_VIDEO_TARIFF_UNAVAILABLE');
});

test('a deleted queue row prevents the paid Fal submission', async () => {
  const payload = { _id: 'deleted', model: 'KLINGIMGTOVID3PRO', duration: 5,
    videoBillingPolicy: 'adapter' };
  let paidSubmissions = 0;
  await assert.rejects((async () => {
    await sealFalVideoSubmissionReceipt(payload, 'fal', async () => null,
      { SAMSAR_DEPLOYMENT_EDITION: 'production' });
    paidSubmissions++;
  })(), error => error.code === 'FAL_VIDEO_RECEIPT_NOT_PERSISTED');
  assert.equal(paidSubmissions, 0);
  assert.equal(payload.videoBillingNativeReceipt, undefined);
});

test('Seedance token rates are sealed before submit and use only completed media metadata', async () => {
  const sealed = buildFalVideoSubmissionReceipt({ model: 'SEEDANCE2.5I2V',
    duration: 10, generationType: 'sound_effect' });
  assert.equal(sealed.tariffRateUsd, 0.0214);
  assert.equal(sealed.submittedConfig.duration, 10);
  assert.equal(sealed.submittedConfig.generateAudio, true);
  let probes = 0;
  const resolved = await resolveVideoAdapterReceipt(sealed,
    { result: { localVideoLink: '/saved/completed.mp4' } }, {
      probeVideo: async path => {
        probes++;
        assert.equal(path, '/saved/completed.mp4');
        return { width: 1280, height: 720, seconds: 10, framesPerSecond: 24 };
      },
      fetchImpl: async () => assert.fail('No provider pricing or billing GET'),
      lookupGeneration: async () => assert.fail('Sealed tariff needs no queue'),
    });
  assert.equal(probes, 1);
  assert.equal(resolved.billableQuantity, 216);
  assert.equal(calculateVideoCallCredits(resolved).credits, 554.688);
});

test('Magi bills the exact listener provider defaults while preserving dated snapshots', () => {
  assert.equal(FAL_VIDEO_TARIFF_VERSIONS['2026-10-23'].MAGIDISTILLED, undefined);
  const receipt = buildFalVideoSubmissionReceipt({ model: 'MAGIDISTILLED', duration: 8, framesPerSecond: 30 });
  assert.equal(receipt.falVideoTariffVersion, '2026-11-07');
  assert.equal(receipt.submittedConfig.numFrames, 96);
  assert.equal(receipt.submittedConfig.duration, 4);
  assert.equal(calculateVideoCallCredits({ ...receipt, costUsd: 999 }).credits, 38.4);
});

test('legacy completed Fal video recovers its queue rate; an orphaned variable-price job stays pending', async () => {
  const recovered = await resolveVideoAdapterReceipt(
    { adapter: 'fal', model: 'VEO3.1I2VFAST', providerRequestId: 'paid-job' },
    { requestId: 'original-queue', result: { remoteUrl: 'https://provider.example/output.mp4' } }, {
      lookupGeneration: async () => ({ model: 'VEO3.1I2VFAST', duration: 8,
        isAudioVideoGeneration: true }),
      fetchImpl: async () => assert.fail('No billing request'),
    });
  assert.equal(calculateVideoCallCredits(recovered).credits, 144);
  await assert.rejects(resolveVideoAdapterReceipt(
    { adapter: 'fal', model: 'VEO3.1I2VFAST', providerRequestId: 'paid-job' },
    { requestId: 'deleted-queue', result: { remoteUrl: 'https://provider.example/output.mp4' } }, {
      lookupGeneration: async () => null,
      fetchImpl: async () => assert.fail('No billing request'),
    }), error => error.code === 'VIDEO_BILLING_PENDING');
});

test('a sealed rate survives future tariff changes and ignores arbitrary provider charges', () => {
  const original = buildFalVideoSubmissionReceipt({ model: 'KLINGTXTTOVID3PRO', duration: 5 });
  const previouslySubmitted = { ...original, tariffRateUsd: 0.10, costUsd: 0 };
  assert.equal(calculateVideoCallCredits(previouslySubmitted).credits, 60);
});

test('an older sealed route settles from its version after the current route changes', () => {
  const historical = buildFalVideoSubmissionReceipt({ model: 'KLINGTXTTOVID3PRO', duration: 5 });
  const versions = {
    ...FAL_VIDEO_TARIFF_VERSIONS,
    future: { KLINGTXTTOVID3PRO: { ...FAL_VIDEO_TARIFFS.KLINGTXTTOVID3PRO,
      endpoint: 'fal-ai/kling-video/v4/pro/text-to-video' } },
  };
  assert.equal(calculateFalVideoUsd(historical, versions), 0.56);
  assert.throws(() => calculateFalVideoUsd({ ...historical,
    falVideoTariffVersion: 'future' }, versions), /tariff/);
});
