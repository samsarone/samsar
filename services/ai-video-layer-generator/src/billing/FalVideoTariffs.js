import { isKlingV4Model, validateKlingV4Duration } from '../utils/KlingModel.js';
import { buildSeedanceInputPayload } from '../base/SeeDanceListener.js';
import { videoBillingError, videoBillingMode } from './VideoPricing.js';
import { falLipSyncTariff } from './FalLipSyncTariffs.js';
import { falSoundEffectTariff } from './FalSoundEffectTariffs.js';

// Prices are provider base USD. VideoPricing applies the 1.2 adapter markup.
// Keep the selected rate in each submitted receipt so a later deploy cannot
// reprice a completed request. These URLs are the Fal model cards checked on
// 2026-10-23; unsupported configurations must fail before queue.submit.
export const FAL_VIDEO_TARIFF_VERSION = '2026-11-07';
const SNAPSHOT_2026_10_23 = '2026-10-23';
const card = endpoint => `https://fal.ai/models/${endpoint}`;
const entry = (endpoint, unit, rateUsd, verifiedOn = SNAPSHOT_2026_10_23) => Object.freeze({
  endpoint, unit, rateUsd, source: card(endpoint), verifiedOn,
});

// Never change a dated snapshot after jobs have been submitted with it. Add a
// new version and retain this one when provider endpoints or rates change.
const FAL_VIDEO_TARIFFS_2026_10_23 = Object.freeze({
  SDVIDEO: entry('fal-ai/stable-video', 'video', 0.075),
  SKYREELSI2V: entry('fal-ai/skyreels-i2v', 'video', 0.30),
  VIDUI2V: entry('fal-ai/vidu/image-to-video', 'video', 0.20),
  WANI2V5B: entry('fal-ai/wan/v2.2-5b/image-to-video', 'video', 0.15),
  WANI2V: entry('fal-ai/wan/v2.2-a14b/image-to-video', 'frameSecond', 0.08),
  COSMOS3SUPERI2V: entry('nvidia/cosmos-3-super/image-to-video', 'roundedSecond', 0.05),
  KLINGTXTTOVIDSTANDARD: entry('fal-ai/kling-video/v1.6/standard/text-to-video', 'second', 0.056),
  KLINGTXTTOVIDPRO: entry('fal-ai/kling-video/v1.6/pro/text-to-video', 'second', 0.098),
  KLINGIMGTOVIDSTANDARD: entry('fal-ai/kling-video/v1.6/standard/image-to-video', 'second', 0.056),
  // The existing adapter routes this model name to the standard endpoint.
  KLINGIMGTOVIDPRO: entry('fal-ai/kling-video/v1.6/standard/image-to-video', 'second', 0.056),
  KLINGIMGTOVIDPROMASTER: entry('fal-ai/kling-video/v2/master/image-to-video', 'second', 0.28),
  'KLINGIMGTOVID2.1STANDARD': entry('fal-ai/kling-video/v2.1/standard/image-to-video', 'second', 0.056),
  'KLINGIMGTOVID2.1PRO': entry('fal-ai/kling-video/v2.1/pro/image-to-video', 'second', 0.098),
  'KLINGIMGTOVID2.1MASTER': entry('fal-ai/kling-video/v2.1/master/image-to-video', 'second', 0.28),
  KLINGTXTTOVIDTURBO: entry('fal-ai/kling-video/v3/pro/text-to-video', 'second', null),
  KLINGTXTTOVID3PRO: entry('fal-ai/kling-video/v3/pro/text-to-video', 'second', null),
  KLINGIMGTOVIDTURBO: entry('fal-ai/kling-video/v3/pro/image-to-video', 'second', null),
  KLINGIMGTOVID3PRO: entry('fal-ai/kling-video/v3/pro/image-to-video', 'second', null),
  VEO: entry('fal-ai/veo2', 'second', 0.50),
  VEOI2V: entry('fal-ai/veo2/image-to-video', 'second', 0.50),
  'VEO3.1': entry('fal-ai/veo3.1', 'second', null),
  'VEO3.1FAST': entry('fal-ai/veo3.1/fast', 'second', null),
  'VEO3.1I2V': entry('fal-ai/veo3.1/image-to-video', 'second', null),
  'VEO3.1I2VFAST': entry('fal-ai/veo3.1/fast/image-to-video', 'second', null),
  'VEO3.1FLIV': entry('fal-ai/veo3.1/first-last-frame-to-video', 'second', null),
  HAPPYHORSEI2V: entry('alibaba/happy-horse/v1.1/image-to-video', 'second', 0.14),
  HAILUOPRO: entry('fal-ai/minimax/hailuo-02/pro/image-to-video', 'second', 0.08),
  PIXVERSEI2V: entry('fal-ai/pixverse/v4.5/image-to-video', 'video', 0.20),
  PIXVERSEI2VFAST: entry('fal-ai/pixverse/v4.5/image-to-video/fast', 'video', 0.40),
  'PIKA2.2I2V': entry('fal-ai/pika/v2.2/image-to-video', 'video', 0.20),
  SEEDANCEI2V: entry('fal-ai/bytedance/seedance/v1.5/pro/image-to-video', 'millionVideoTokens', null),
  'SEEDANCE2.0I2V': entry('bytedance/seedance-2.0/image-to-video', 'thousandVideoTokens', 0.014),
  'SEEDANCE2.5I2V': entry('bytedance/seedance-2.5/image-to-video', 'thousandVideoTokens', 0.0214),
});

export const FAL_VIDEO_TARIFF_VERSIONS = Object.freeze({
  '2026-10-23': FAL_VIDEO_TARIFFS_2026_10_23,
  '2026-11-07': Object.freeze({ ...FAL_VIDEO_TARIFFS_2026_10_23,
    MAGIDISTILLED: entry('fal-ai/magi-distilled/image-to-video', 'video', 0.32, '2026-10-24'),
    KLINGIMGTOVID4: entry('kling/v4/image-to-video', 'second', 0.157, '2026-11-07'),
    KLINGTXTTOVID4: entry('kling/v4/text-to-video', 'second', 0.157, '2026-11-07'),
  }),
  '2026-10-24': Object.freeze({ ...FAL_VIDEO_TARIFFS_2026_10_23,
    // The current listener does not send num_frames, resolution, or steps.
    // Fal's documented defaults are 96 frames, 720p, and 16 steps ($0.32).
    MAGIDISTILLED: entry('fal-ai/magi-distilled/image-to-video', 'video', 0.32, '2026-10-24'),
  }),
});
export const FAL_VIDEO_TARIFFS = FAL_VIDEO_TARIFF_VERSIONS[FAL_VIDEO_TARIFF_VERSION];

export function falVideoTariff(model) {
  return FAL_VIDEO_TARIFFS[model] || null;
}

export function falVideoTariffForReceipt(receipt = {}, versions = FAL_VIDEO_TARIFF_VERSIONS) {
  return versions[receipt.falVideoTariffVersion]?.[receipt.model] || null;
}

export function requiresFalVideoSubmissionTariff(payload, adapter, env = process.env) {
  return adapter === 'fal' && videoBillingMode(payload, env) === 'adapter' &&
    !falLipSyncTariff(payload.model) && !falSoundEffectTariff(payload.model);
}

export async function sealFalVideoSubmissionReceipt(payload, adapter, persist, env = process.env) {
  if (!requiresFalVideoSubmissionTariff(payload, adapter, env)) return null;
  const receipt = buildFalVideoSubmissionReceipt(payload);
  const saved = await persist(payload._id, receipt);
  if (!saved) throw Object.assign(new Error('Fal video receipt could not be persisted before submission.'),
    { code: 'FAL_VIDEO_RECEIPT_NOT_PERSISTED' });
  payload.videoBillingNativeReceipt = receipt;
  return receipt;
}

function unavailable(model, detail = 'no verified tariff') {
  return Object.assign(new Error(`Fal video ${model || '<missing>'} has ${detail}; request was not submitted.`),
    { code: 'FAL_VIDEO_TARIFF_UNAVAILABLE' });
}

function positive(value, model, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw unavailable(model, `an invalid ${name}`);
  return number;
}

function whole(value, model, name) {
  const number = positive(value, model, name);
  if (!Number.isInteger(number)) throw unavailable(model, `an unsupported ${name}`);
  return number;
}

/** Construct from the exact options the model listener submits, before paid POST. */
export function buildFalVideoSubmissionReceipt(payload = {}) {
  const { model } = payload;
  const tariff = falVideoTariff(model);
  if (!tariff) throw unavailable(model);
  let rateUsd = tariff.rateUsd;
  let quantity = 1;
  let unit = tariff.unit;
  const config = {};

  if (isKlingV4Model(model)) {
    quantity = validateKlingV4Duration(payload.duration ?? 5);
    config.duration = quantity;
    config.resolution = '720p';
  } else if (model.startsWith('KLING')) {
    quantity = positive(payload.duration ?? 5, model, 'duration');
    config.duration = quantity;
    if (/KLING(?:TXT|IMG)TOVID(?:TURBO|3PRO)/.test(model)) {
      config.generateAudio = payload.generateAudio === true || payload.generate_audio === true;
      rateUsd = config.generateAudio ? 0.168 : 0.112;
    }
  } else if (model.startsWith('VEO3.1')) {
    const supplied = Number(payload.duration ?? 8);
    // The first/last-frame listener substitutes 8s for unsupported values.
    quantity = model === 'VEO3.1FLIV'
      ? ([4, 6, 8].includes(Math.round(supplied)) ? Math.round(supplied) : 8)
      : positive(supplied, model, 'duration');
    config.duration = quantity;
    config.resolution = '720p';
    config.generateAudio = model === 'VEO3.1FLIV'
      ? payload.generateAudio === true || payload.generate_audio === true
      : model.includes('I2V')
        ? Boolean(payload.generateAudio || payload.isAudioVideoGeneration)
        : Boolean(payload.generateAudio || payload.generate_audio);
    rateUsd = model.includes('FAST') ? (config.generateAudio ? 0.15 : 0.10)
      : (config.generateAudio ? 0.40 : 0.20);
  } else if (model === 'VEO' || model === 'VEOI2V') {
    quantity = positive(payload.duration ?? 8, model, 'duration');
    config.duration = quantity;
  } else if (model === 'HAPPYHORSEI2V') {
    const requested = Number(payload.duration ?? 5);
    quantity = [5, 10, 15].find(value => value >= requested) || 15;
    if (!Number.isFinite(requested)) quantity = 5;
    config.duration = quantity;
    config.resolution = '720p';
  } else if (model === 'HAILUOPRO') {
    quantity = positive(payload.duration ?? 6, model, 'duration');
    config.duration = quantity;
  } else if (model === 'WANI2V' || model === 'WANI2V5B') {
    const frames = payload.duration === 7 ? 121 : 81;
    if (model === 'WANI2V5B' && frames !== 81) throw unavailable(model, 'no verified 121-frame tariff');
    config.numFrames = frames;
    config.framesPerSecond = model === 'WANI2V' ? 16 : 24;
    config.resolution = '720p';
    quantity = model === 'WANI2V' ? frames / 16 : 1;
  } else if (model === 'COSMOS3SUPERI2V') {
    const parsedFps = Number(payload.framesPerSecond);
    const normalizedFps = Number.isFinite(parsedFps) && parsedFps > 0 ? parsedFps : 24;
    const fps = Math.min(60, Math.max(4, Math.round(normalizedFps)));
    const parsedDuration = Number(payload.duration);
    const duration = Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : 5;
    const frames = Math.min(189, Math.max(5, Math.round(duration * fps)));
    config.numFrames = frames;
    config.framesPerSecond = fps;
    config.agenticGeneration = false;
    quantity = Math.ceil(frames / fps);
  } else if (model.startsWith('PIXVERSE')) {
    const duration = whole(payload.duration ?? 8, model, 'duration');
    if (![5, 8].includes(duration)) throw unavailable(model, `no verified ${duration}s tariff`);
    config.duration = duration;
    config.resolution = '720p';
    quantity = duration === 8 ? 2 : 1;
  } else if (model === 'PIKA2.2I2V') {
    const duration = whole(payload.duration ?? 5, model, 'duration');
    if (duration !== 5) throw unavailable(model, `no verified ${duration}s tariff`);
    config.duration = duration;
    config.resolution = '720p';
  } else if (model === 'MAGIDISTILLED') {
    config.numFrames = 96;
    config.resolution = '720p';
    config.numInferenceSteps = 16;
    config.duration = 4;
    config.pricingDefaultsSource = 'provider_schema';
  } else if (model.startsWith('SEEDANCE')) {
    const input = buildSeedanceInputPayload(payload);
    config.duration = input.duration ?? 5;
    config.resolution = input.resolution || '720p';
    config.aspectRatio = input.aspect_ratio || 'auto';
    config.generateAudio = input.generate_audio;
    if (model === 'SEEDANCEI2V') rateUsd = config.generateAudio ? 2.4 : 1.2;
    // Fal charges actual output frame area and duration. Seal the token rate
    // here and measure the completed asset; never ask a pricing API at runtime.
    quantity = null;
  }

  if (!Number.isFinite(rateUsd) || rateUsd < 0) throw unavailable(model);
  return { adapter: 'fal', model, endpoint: tariff.endpoint,
    falVideoTariffVersion: FAL_VIDEO_TARIFF_VERSION, tariffRateUsd: rateUsd,
    tariffUnit: unit, submittedQuantity: quantity, submittedConfig: config,
    tariffSource: tariff.source, tariffVerifiedOn: tariff.verifiedOn };
}

export function calculateFalVideoUsd(receipt, versions = FAL_VIDEO_TARIFF_VERSIONS) {
  const tariff = falVideoTariffForReceipt(receipt, versions);
  if (receipt.adapter !== 'fal' || !tariff || receipt.endpoint !== tariff.endpoint ||
      !receipt.falVideoTariffVersion || receipt.tariffUnit !== tariff.unit ||
      !Number.isFinite(receipt.tariffRateUsd) || receipt.tariffRateUsd < 0) {
    throw videoBillingError('The sealed Fal video tariff is missing or invalid.');
  }
  const quantity = Number(receipt.billableQuantity ?? receipt.submittedQuantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw videoBillingError('The Fal video billing quantity is missing or invalid.');
  }
  return quantity * receipt.tariffRateUsd;
}
