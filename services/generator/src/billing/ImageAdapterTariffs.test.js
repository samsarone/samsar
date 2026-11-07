import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageAdapterTariffSnapshot, calculateImageAdapterTariffCost } from './ImageAdapterTariffs.js';
import { sealImageAdapterSubmission } from './ImageAdapterSubmission.js';
import { resolveImageAdapterReceipt } from './ImageAdapterReceipt.js';
import { billCompletedImage } from './ImageRequestBilling.js';
import { calculateImageCallCredits } from './ImagePricing.js';

const production = { SAMSAR_DEPLOYMENT_EDITION: 'production' };
const openaiUsage = { input_tokens: 300,
  input_tokens_details: { text_tokens: 100, image_tokens: 200 }, output_tokens: 1000 };
const googleUsage = { promptTokenCount: 1000, cachedContentTokenCount: 200,
  candidatesTokenCount: 1200, thoughtsTokenCount: 100,
  candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1120 }, { modality: 'TEXT', tokenCount: 80 }] };

test('F2P: sealed native token tariffs override a provider cost and apply 20% once', async () => {
  for (const [submittedAdapter, model, receipt, expected] of [
    ['openai', 'GPTIMAGE2.5', { model: 'gpt-image-2.6-sunburst', usage: openaiUsage }, 3.852],
    ['googleCloud', 'NANOBANANA2', { calls: [{ adapter: 'googleCloud',
      model: 'gemini-3.1-flash-image', region: 'global', usage: googleUsage, costUsd: 0 }] }, 8.178],
  ]) {
    const snapshot = createImageAdapterTariffSnapshot({ submittedAdapter, model }, { env: production });
    const resolved = await resolveImageAdapterReceipt({ adapter: submittedAdapter, ...receipt, costUsd: 999 },
      { imageAdapterTariffSnapshot: snapshot });
    assert.equal(calculateImageCallCredits(resolved).credits, expected);
    assert.equal(calculateImageCallCredits(resolved).costSource, 'static_tariff');
  }
});

test('F2P: verified GMI image tariffs do not require a reported cost or pricing request', async () => {
  const priorFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('unexpected pricing request'); };
  try {
    for (const [payload, expected] of [
      [{ model: 'SEEDREAM' }, 10.2],
      [{ model: 'BRIA_ERASER', image: 'input.png', maskImage: 'mask.png' }, 4.8],
      [{ model: 'BRIA_GENFILL', image: 'input.png', maskImage: 'mask.png' }, 4.8],
      [{ model: 'NANOBANANAPRO', resolution: '2K' }, 16.08],
      [{ model: 'NANOBANANAPROEDIT', resolution: '4K',
        image_urls: ['one.png', 'two.png', 'one.png'], image: 'two.png' }, 29.064],
    ]) {
      const snapshot = createImageAdapterTariffSnapshot({ submittedAdapter: 'gmicloud', ...payload });
      const priced = await resolveImageAdapterReceipt({ adapter: 'gmicloud', model: payload.model, costUsd: 0 },
        { imageAdapterTariffSnapshot: snapshot });
      assert.equal(calculateImageCallCredits(priced).credits, expected, payload.model);
    }
  } finally {
    globalThis.fetch = priorFetch;
  }
});

test('Sunburst 2.6 keeps the rates and markup while old 2.5 receipts retain their tariff', async () => {
  for (const model of ['GPTIMAGE2.5', 'GPTIMAGE2.5EDIT', 'GPTIMAGE1', 'GPTIMAGE1EDIT']) {
    const payload = { model, submittedAdapter: 'openai', imageBillingPolicy: 'adapter' };
    const current = createImageAdapterTariffSnapshot(payload);
    const legacyReceipt = { adapter: 'openai', model: 'gpt-image-2.5-sunburst', usage: openaiUsage };
    const legacy = createImageAdapterTariffSnapshot(payload, { receipt: legacyReceipt });
    assert.equal(current.providerModel, 'gpt-image-2.6-sunburst');
    assert.equal(current.version, 3);
    assert.equal(current.verifiedOn, '2026-11-07');
    assert.equal(legacy.version, 1);
    assert.deepEqual(current.rates, legacy.rates);
    for (const [snapshot, receipt] of [[legacy, legacyReceipt],
      [current, { ...legacyReceipt, model: current.providerModel }]]) {
      const priced = await resolveImageAdapterReceipt(receipt, { imageAdapterTariffSnapshot: snapshot });
      assert.equal(calculateImageCallCredits(priced).credits, 3.852);
    }
    assert.equal(await sealImageAdapterSubmission({ ...payload, imageAdapterTariffSnapshot: legacy }, {
      env: production,
      imageGenerationModel: { updateOne: async () => { throw new Error('must not reseal a queued request'); } },
    }), legacy);
  }
});

test('GMI Nano2 uses its verified token rates and preserves an existing charge if usage is unavailable', () => {
  const snapshot = createImageAdapterTariffSnapshot({ submittedAdapter: 'gmicloud', model: 'NANOBANANA2' });
  const costUsd = calculateImageAdapterTariffCost(snapshot, { adapter: 'gmicloud',
    model: 'NANOBANANA2', usage: googleUsage, costUsd: 0.07 });
  // GMI's card does not publish a cached-token discount, so all input uses .5/M.
  assert.equal(calculateImageCallCredits({ costUsd }).credits, 8.1888);
  assert.equal(calculateImageAdapterTariffCost(snapshot,
    { adapter: 'gmicloud', model: 'NANOBANANA2', costUsd: 0.07 }), 0.07);
  assert.throws(() => calculateImageAdapterTariffCost(snapshot,
    { adapter: 'gmicloud', model: 'NANOBANANA2' }), /input tokens/);
});

test('native per-image tariffs follow the submitted configuration across usual aspect ratios', async () => {
  for (const aspectRatio of ['1:1', '16:9', '9:16']) {
    for (const [submittedAdapter, model, expected] of [
      ['alibabaCloud', 'QWENIMAGE3PRO', 4.8], ['alibabaCloud', 'WAN2.7PRO', 9],
      ['googleCloud', 'IMAGEN3', 4.8], ['googleCloud', 'IMAGEN3FLASH', 2.4],
    ]) {
      const snapshot = createImageAdapterTariffSnapshot({ submittedAdapter, model, aspectRatio,
        resolution: '4K' }, { env: production });
      const receipt = { adapter: submittedAdapter, model: snapshot.providerModel, costUsd: 0 };
      const priced = await resolveImageAdapterReceipt(receipt, { imageAdapterTariffSnapshot: snapshot });
      assert.equal(calculateImageCallCredits(priced).credits, expected);
    }
  }
  const snapshot = createImageAdapterTariffSnapshot({ submittedAdapter: 'alibabaCloud', model: 'QWENIMAGE3PRO' },
    { env: { ALIBABA_IMAGE_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' } });
  assert.equal(calculateImageCallCredits({ imageAdapterTariffSnapshot: snapshot }).credits, 4.1256);
});

test('new hosted submissions persist one immutable tariff before dispatch, with dependency seams', async () => {
  const writes = [];
  const imageGenerationModel = { async updateOne(filter, update) {
    writes.push([filter, update]); return { matchedCount: 1 };
  } };
  const payload = { _id: 'job', model: 'GPTIMAGE1EDIT', submittedAdapter: 'openai', imageBillingPolicy: 'adapter' };
  const snapshot = await sealImageAdapterSubmission(payload, { env: production, imageGenerationModel });
  assert.deepEqual(writes[0], [{ _id: 'job' }, { $set: { imageAdapterTariffSnapshot: snapshot } }]);
  assert.equal(snapshot.providerModel, 'gpt-image-2.6-sunburst');
  assert.deepEqual(await sealImageAdapterSubmission(payload, { env: production, imageGenerationModel }), snapshot);
  assert.equal(writes.length, 1);
  const gmi = { _id: 'alias', model: 'SEEDREAM', submittedAdapter: 'genblaze', imageBillingPolicy: 'adapter' };
  const gmiSnapshot = await sealImageAdapterSubmission(gmi, { env: production, imageGenerationModel });
  assert.equal(gmiSnapshot.adapter, 'gmicloud');
  assert.equal(await sealImageAdapterSubmission(gmi, { env: production, imageGenerationModel }), gmiSnapshot);
  assert.equal(writes.length, 2);
  for (const [job, env] of [
    [{ ...payload, imageBillingPolicy: 'pipeline' }, production],
    [{ ...payload, imageBillingPolicy: undefined }, production],
    [{ ...payload, submittedAdapter: 'fal' }, production],
    [{ ...payload, submittedAdapter: 'samsar' }, { CURRENT_ENV: 'docker' }],
  ]) assert.equal(await sealImageAdapterSubmission(job, { env, imageGenerationModel }), null);
  assert.equal(writes.length, 2);
  await assert.rejects(sealImageAdapterSubmission({ ...payload, _id: 'gone', imageAdapterTariffSnapshot: undefined },
    { env: production, imageGenerationModel: { updateOne: async () => ({ matchedCount: 0 }) } }), /disappeared/);
});

test('unverified model/adapter pairs keep their existing dispatch behavior without invented prices', async () => {
  let writes = 0;
  for (const [submittedAdapter, model] of [['samsar', 'SEEDREAM'], ['openai', 'DALLE3'],
    ['googleCloud', 'GEMMA3'], ['gmicloud', 'GPTIMAGE2.5'], ['custom', 'CUSTOM_TEXT_TO_IMAGE:mine']]) {
    assert.equal(await sealImageAdapterSubmission({ _id: 'job', imageBillingPolicy: 'adapter', submittedAdapter, model },
      { env: production, imageGenerationModel: { updateOne: async () => { writes++; } } }), null);
  }
  assert.equal(writes, 0);
});

test('sealed tariff, actual model, region, unit counts and provider identity cannot conflict', async () => {
  const snapshot = createImageAdapterTariffSnapshot({ submittedAdapter: 'openai', model: 'GPTIMAGE2.5' });
  const receipt = { adapter: 'openai', model: snapshot.providerModel, usage: openaiUsage };
  for (const changed of [{ ...snapshot, version: 999 }, { ...snapshot, rates: { ...snapshot.rates, imageOutput: 0 } }]) {
    assert.throws(() => calculateImageAdapterTariffCost(changed, receipt), /invalid|unavailable/);
  }
  assert.throws(() => calculateImageAdapterTariffCost(snapshot, { ...receipt, adapter: 'gmicloud' }), /adapter conflicts/);
  assert.throws(() => calculateImageAdapterTariffCost(snapshot, { ...receipt, model: 'other' }), /model conflicts/);
  await assert.rejects(resolveImageAdapterReceipt({ ...receipt, providerRequestId: 'other' },
    { imageAdapterTariffSnapshot: snapshot, apiRequestId: 'original' }), /identity conflicts/);
  const gmi = createImageAdapterTariffSnapshot({ submittedAdapter: 'gmicloud', model: 'SEEDREAM' });
  assert.throws(() => calculateImageAdapterTariffCost(gmi, { outputImages: 2 }), /output count/);
});

test('a matching original pending job recovers static pricing without altering legacy prepaid receipts', async () => {
  const job = { submittedAdapter: 'gmicloud', imageBillingPolicy: 'adapter', model: 'SEEDREAM', apiRequestId: 'genblaze-image:provider' };
  const imageGenerationModel = { findById: () => ({ lean: async () => job }) };
  const receipt = { adapter: 'gmicloud', model: 'SEEDREAM', providerRequestId: 'provider', costUsd: 0 };
  const priced = await resolveImageAdapterReceipt(receipt, { requestId: 'row', apiRequestId: 'genblaze-image:provider' }, { imageGenerationModel });
  assert.equal(calculateImageCallCredits(priced).credits, 10.2);
  for (const changed of [{ ...job, imageBillingPolicy: undefined }, { ...job, apiRequestId: 'different' }]) {
    const unchanged = await resolveImageAdapterReceipt(receipt, { requestId: 'row' },
      { imageGenerationModel: { findById: () => ({ lean: async () => changed }) } });
    assert.equal(unchanged, receipt);
  }
});

test('F2P: ordinary image settlement carries the sealed non-Fal tariff through the billing boundary', async () => {
  const snapshot = createImageAdapterTariffSnapshot({ submittedAdapter: 'gmicloud', model: 'SEEDREAM' });
  let saved;
  const charges = [];
  const dependencies = { env: production, store: {
    async ensure(id, fields) { return saved ||= { _id: id, ...fields }; },
    async saveBilling(id, billing) { saved.billing = billing; return saved; },
    async complete(id, fields) { Object.assign(saved, fields, { status: 'COMPLETED' }); return saved; },
  }, charge: async (...args) => { charges.push(args); return { remainingCredits: 89.8 }; } };
  const payload = { _id: 'ordinary-job', userId: 'owner', imageBillingPolicy: 'adapter', submittedAdapter: 'gmicloud',
    model: 'SEEDREAM', apiRequestId: 'genblaze-image:provider', imageAdapterTariffSnapshot: snapshot };
  const result = { image: 'saved.png', imageBillingReceipt: { adapter: 'gmicloud', model: 'SEEDREAM', providerRequestId: 'provider' } };
  await billCompletedImage(payload, result, dependencies);
  await billCompletedImage(payload, result, dependencies);
  assert.deepEqual(saved.context.imageAdapterTariffSnapshot, snapshot);
  assert.equal(charges.length, 1);
  assert.equal(charges[0][1], 10.2);
  assert.equal(saved.status, 'COMPLETED');
});
