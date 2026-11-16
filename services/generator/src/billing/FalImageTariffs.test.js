import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateImageCallCredits } from './ImagePricing.js';
import { resolveImageAdapterReceipt } from './ImageAdapterReceipt.js';
import { sealFalImageSubmission } from './FalImageSubmission.js';
import { calculateFalImageTariffCost, createFalImageTariffSnapshot, FAL_IMAGE_TARIFFS_V1, FAL_IMAGE_TARIFFS_V2 } from './FalImageTariffs.js';

test('SEEDREAM seals its exact current low-area endpoint once and applies 20% markup', async () => {
  const writes = [];
  const imageGenerationModel = { async updateOne(filter, update) {
    writes.push([filter, update]); return { matchedCount: 1 };
  } };
  const payload = { _id: 'seedream', model: 'SEEDREAM', submittedAdapter: 'fal',
    imageBillingPolicy: 'adapter', aspectRatio: '9:16' };
  const dependencies = { env: { SAMSAR_DEPLOYMENT_EDITION: 'production' }, imageGenerationModel };
  const snapshot = await sealFalImageSubmission(payload, dependencies);
  assert.equal(snapshot.version, 3);
  assert.equal(snapshot.endpoint, 'bytedance/seedream/v5.5/text-to-image');
  const receipt = await resolveImageAdapterReceipt({ adapter: 'fal', model: 'SEEDREAM', costUsd: 999 },
    { falImageBillingSnapshot: snapshot });
  assert.equal(receipt.costUsd, .03);
  assert.equal(receipt.costSource, 'static_tariff');
  assert.equal(calculateImageCallCredits(receipt).credits, 3.6);
  assert.equal(await sealFalImageSubmission(payload, dependencies), snapshot);
  assert.equal(writes.length, 1);
  assert.equal(FAL_IMAGE_TARIFFS_V1.SEEDREAM, undefined);
});

test('accepted Seedream 5.0 jobs retain their immutable endpoint and rate after the 5.5 upgrade', async () => {
  const legacy = { version: 2, model: 'SEEDREAM', endpoint: 'bytedance/seedream/v5/pro/text-to-image',
    baseUsdPerUnit: .0675, unit: 'images', billableUnits: 1 };
  const payload = { model: 'SEEDREAM', submittedAdapter: 'fal', imageBillingPolicy: 'adapter', falImageBillingSnapshot: legacy };
  assert.equal(await sealFalImageSubmission(payload, {
    env: { SAMSAR_DEPLOYMENT_EDITION: 'production' },
    imageGenerationModel: { updateOne() { throw new Error('must not reseal'); } },
  }), legacy);
  assert.equal(calculateFalImageTariffCost(legacy), .0675);
  assert.equal(FAL_IMAGE_TARIFFS_V2.SEEDREAM[0], legacy.endpoint);
  assert.equal(FAL_IMAGE_TARIFFS_V2.SEEDREAM[1], .0675);
  const recovered = createFalImageTariffSnapshot({ model: 'SEEDREAM', apiGenerationStatus: 'PENDING', apiRequestId: 'accepted-before-upgrade' });
  assert.equal(recovered.version, 2);
  assert.equal(recovered.endpoint, legacy.endpoint);
  assert.equal(calculateFalImageTariffCost(recovered), .0675);
});

test('old sealed Fal rates survive retry and a new catalog version', async () => {
  const snapshot = { version: 1, model: 'WAN2.7PRO', endpoint: 'fal-ai/wan/v2.7/pro/text-to-image',
    baseUsdPerUnit: .075, unit: 'images', billableUnits: 1 };
  const payload = { model: 'WAN2.7PRO', submittedAdapter: 'fal', imageBillingPolicy: 'adapter',
    falImageBillingSnapshot: snapshot };
  assert.equal(await sealFalImageSubmission(payload, {
    env: { SAMSAR_DEPLOYMENT_EDITION: 'production' },
    imageGenerationModel: { updateOne() { throw new Error('must not reseal'); } },
  }), snapshot);
  assert.equal(calculateFalImageTariffCost(snapshot), .075);
});

test('Fal per-image tariffs include verified style, speed, resolution, and output-count tiers', async () => {
  const cases = [
    [{ model: 'RECRAFTV3', imageStyle: 'vector_illustration/line_art' }, 0.08],
    [{ model: 'RECRAFT20B', imageStyle: 'vector_illustration' }, 0.0438],
    [{ model: 'IDEOGRAMV3' }, 0.06],
    [{ model: 'WAN2.7PRO' }, 0.075],
    [{ model: 'NANOBANANA2', resolution: '4K' }, 0.08], // Generation omits resolution.
    [{ model: 'NANOBANANA2EDIT', case_type: 'enhance_image', resolution: '2K' }, 0.12],
    [{ model: 'NANOBANANAPROEDIT', case_type: 'image_list_to_image_set', numImages: 3 }, 0.24],
  ];
  for (const [payload, expected] of cases) {
    const snapshot = createFalImageTariffSnapshot(payload);
    assert.equal(await calculateFalImageTariffCost(snapshot, { image: 'done.png' }), expected, payload.model);
  }
});

test('verified FLUX submit sizes seal one billable megapixel before dispatch', async () => {
  const snapshot = createFalImageTariffSnapshot({ model: 'FLUX1.1PRO', aspectRatio: '16:9' });
  assert.equal(snapshot.billableUnits, 1);
  assert.equal(await calculateFalImageTariffCost(snapshot), 0.04);
  const priced = await resolveImageAdapterReceipt({ adapter: 'fal', model: 'FLUX1.1PRO' },
    { falImageBillingSnapshot: snapshot });
  assert.equal(calculateImageCallCredits(priced).credits, 4.8);
});

test('unpriced endpoints and unverified megapixel rules fail before provider submission', async () => {
  for (const model of ['IMAGEN4', 'FLITE', 'UNKNOWN', 'GPTIMAGE2.5',
    'SANA', 'PHOTON', 'HUNYUAN', 'SDV3.5', 'FLUX1PROFILL', 'FLUX1.1PROULTRAREDUX']) {
    assert.throws(() => createFalImageTariffSnapshot({ model }),
      { code: 'FAL_IMAGE_TARIFF_UNVERIFIED' }, model);
  }
  assert.throws(() => createFalImageTariffSnapshot({ model: 'NANOBANANA2EDIT',
    case_type: 'image_list_to_image_set', numImages: 0 }), /output count/);
  let writes = 0;
  const imageGenerationModel = { async updateOne() { writes++; return { matchedCount: 1 }; } };
  await assert.rejects(sealFalImageSubmission({ _id: 'new', model: 'UNKNOWN',
    submittedAdapter: 'fal', imageBillingPolicy: 'adapter' },
  { env: { SAMSAR_DEPLOYMENT_EDITION: 'production' }, imageGenerationModel }), /unverified|no verified/);
  assert.equal(writes, 0);
});

test('hosted adapter submissions seal a tariff; agent and standalone calls bypass it', async () => {
  const writes = [];
  const imageGenerationModel = { async updateOne(filter, update) {
    writes.push([filter, update]);
    return { matchedCount: 1 };
  } };
  const payload = { _id: 'new', model: 'WAN2.7PRO', submittedAdapter: 'fal',
    imageBillingPolicy: 'adapter' };
  const snapshot = await sealFalImageSubmission(payload,
    { env: { SAMSAR_DEPLOYMENT_EDITION: 'production' }, imageGenerationModel });
  assert.equal(snapshot.endpoint, 'fal-ai/wan/v2.7/pro/text-to-image');
  assert.deepEqual(writes[0][1].$set.falImageBillingSnapshot, payload.falImageBillingSnapshot);
  assert.equal(await sealFalImageSubmission({ ...payload, model: 'SEEDREAM', imageBillingPolicy: 'pipeline' },
    { env: { SAMSAR_DEPLOYMENT_EDITION: 'production' }, imageGenerationModel }), null);
  assert.equal(await sealFalImageSubmission({ ...payload, model: 'SEEDREAM' },
    { env: { CURRENT_ENV: 'docker' }, imageGenerationModel }), null);
  assert.equal(writes.length, 1);
});

test('legacy saved Fal completion recovers only from its matching original request', async () => {
  const job = { model: 'RECRAFTV3', imageStyle: 'vector_illustration', submittedAdapter: 'fal',
    apiRequestId: 'provider-id' };
  const imageGenerationModel = { findById: () => ({ lean: async () => job }) };
  const receipt = { adapter: 'fal', providerRequestId: 'provider-id', model: 'RECRAFTV3' };
  const recovered = await resolveImageAdapterReceipt(receipt,
    { requestId: 'original-row', apiRequestId: 'provider-id', result: { image: 'done.png' } },
    { imageGenerationModel });
  assert.equal(recovered.costUsd, 0.08);
  await assert.rejects(resolveImageAdapterReceipt({ ...receipt, providerRequestId: 'different' },
    { requestId: 'original-row', result: { image: 'done.png' } }, { imageGenerationModel }),
  /could not be verified/);
  const expiredJob = { findById: () => ({ lean: async () => null }) };
  await assert.rejects(resolveImageAdapterReceipt({ adapter: 'fal', model: 'WAN2.7PRO',
    providerRequestId: 'saved-wan-request' }, { requestId: 'expired-row' },
  { imageGenerationModel: expiredJob }), /could not be verified/);
});
