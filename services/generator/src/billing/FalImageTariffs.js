import { imageBillingError } from './ImagePricing.js';
import { getSeedreamFalEndpoint, LEGACY_SEEDREAM_FAL_ENDPOINT, SEEDREAM_FAL_ENDPOINT } from '../consts/SeedreamModel.js';

// Account rates checked against Fal's read-only Models Pricing API on 2026-10-23:
// https://fal.ai/docs/platform-apis/v1/models/pricing
// This catalog describes the exact endpoints submitted by the image worker.
// A missing entry is intentional: never submit a hosted adapter-billed call
// whose base tariff or billing unit has not been verified.
function freezeTariffs(rows) {
  for (const row of Object.values(rows)) Object.freeze(row);
  return Object.freeze(rows);
}

// Keep v1 immutable when account rates change. Add a v2 catalog and make
// submission use v2; saved v1 completions must settle at their sealed rate.
export const FAL_IMAGE_TARIFFS_V1 = freezeTariffs({
  FLUX1DEV: ['fal-ai/flux/dev', 0.025, 'megapixels'],
  FLUX1PRO: ['fal-ai/flux-pro/new', 0.05, 'megapixels'],
  'FLUX1.1PRO': ['fal-ai/flux-pro/v1.1', 0.04, 'megapixels'],
  'FLUX1.1ULTRA': ['fal-ai/flux-pro/v1.1-ultra', 0.06, 'images'],
  RECRAFTV3: ['fal-ai/recraft-v3', 0.04, 'images'],
  RECRAFT20B: ['fal-ai/recraft-20b', 0.0219, 'images'],
  'SDV3.5': ['fal-ai/stable-diffusion-v35-large', 0.065, 'megapixels'],
  SANA: ['fal-ai/sana', 0.001, 'megapixels'],
  'SANA4.5B': ['fal-ai/sana/v1.5/4.8b', 0.01, 'megapixels'],
  SANASPRINT: ['fal-ai/sana/sprint', 0.0025, 'megapixels'],
  PHOTON: ['fal-ai/luma-photon', 0.019, 'megapixels'],
  PHOTONFLASH: ['fal-ai/luma-photon/flash', 0.005, 'megapixels'],
  LUMINAV2: ['fal-ai/lumina-image/v2', 0.075, 'megapixels'],
  REVE: ['fal-ai/lumina-image/v2', 0.075, 'megapixels'],
  IDEOGRAMV3: ['fal-ai/ideogram/v3', 0.03, 'images'],
  HIDREAMI1: ['fal-ai/hidream-i1-full', 0.05, 'megapixels'],
  HUNYUAN: ['fal-ai/hunyuan-image/v3/text-to-image', 0.1, 'megapixels'],
  'WAN2.7PRO': ['fal-ai/wan/v2.7/pro/text-to-image', 0.075, 'images'],
  NANOBANANA2: ['fal-ai/nano-banana-2', 0.08, 'images'],
  NANOBANANAPRO: ['fal-ai/nano-banana-2', 0.08, 'images'],
  NANOBANANA2EDIT: ['fal-ai/nano-banana-2/edit', 0.08, 'images'],
  NANOBANANAPROEDIT: ['fal-ai/nano-banana-2/edit', 0.08, 'images'],
  NANOBANANAEDIT: ['fal-ai/nano-banana-2/edit', 0.08, 'images'],
  FLUX1PROFILL: ['fal-ai/flux-pro/v1/fill', 0.05, 'megapixels'],
  'FLUX1.1PROREDUX': ['fal-ai/flux-pro/v1.1/redux', 0.05, 'megapixels'],
  'FLUX1.1PROULTRAREDUX': ['fal-ai/flux-pro/v1.1-ultra/redux', 0.05, 'megapixels'],
  BRIA_ERASER: ['fal-ai/bria/eraser', 0.04, 'generations'],
  BRIA_GENFILL: ['fal-ai/bria/genfill', 0.04, 'generations'],
  BRIA_BACKGROUNDREMOVE: ['fal-ai/bria/background/remove', 0.018, 'generations'],
});
// One-time account verification on 2026-10-24. Seedream's submitter fixes
// num_images=1 and uses 1024²/1792x1024/1024x1792, all below the model
// card's 1536² high-resolution threshold. Never fetch prices on submission.
export const FAL_IMAGE_TARIFFS_V2 = freezeTariffs({
  ...FAL_IMAGE_TARIFFS_V1,
  SEEDREAM: ['bytedance/seedream/v5/pro/text-to-image', 0.0675, 'images'],
});
// Seedream 5.5 model card verified 2026-11-16:
// https://fal.ai/models/bytedance/seedream/v5.5/text-to-image
// The submitter fixes one PNG at <= 1,835,008 pixels; the documented custom
// size rate is $0.03 through 2,610,000 pixels. Keep v2 for accepted 5.0 jobs.
export const FAL_IMAGE_TARIFFS_V3 = freezeTariffs({
  ...FAL_IMAGE_TARIFFS_V2,
  SEEDREAM: [SEEDREAM_FAL_ENDPOINT, 0.03, 'images'],
});
export const FAL_IMAGE_TARIFFS = FAL_IMAGE_TARIFFS_V3;
const TARIFFS_BY_VERSION = Object.freeze({ 1: FAL_IMAGE_TARIFFS_V1, 2: FAL_IMAGE_TARIFFS_V2, 3: FAL_IMAGE_TARIFFS_V3 });

// These exact model cards also verify the rounding rule. Other Fal cards
// identify a per-MP rate without defining billable-unit rounding; they must
// not inherit FLUX's formula by assumption.
const V1_ROUNDED_MEGAPIXEL_MODELS = new Set([
  'FLUX1DEV', 'FLUX1PRO', 'FLUX1.1PRO', 'FLUX1.1PROREDUX',
]);

function unverified(message) {
  return Object.assign(new Error(message), { code: 'FAL_IMAGE_TARIFF_UNVERIFIED' });
}

function nanoEditConfig(payload) {
  const caseType = String(payload.case_type || 'image_edit').trim().toLowerCase();
  const enhance = ['enhance_image', 'image_enhance', 'upscale', 'upscale_image'].includes(caseType);
  const imageSet = caseType === 'image_list_to_image_set';
  if (!enhance && !imageSet && !['image_edit', 'logo_remove'].includes(caseType)) {
    throw unverified(`Fal image edit case ${caseType} has no verified tariff.`);
  }
  const requestedResolution = String(payload.resolution || '1K').trim().toUpperCase();
  const resolution = enhance && ['0.5K', '1K', '2K', '4K'].includes(requestedResolution)
    ? requestedResolution : '1K';
  const outputCount = imageSet ? Number(payload.num_images ?? payload.numImages) : 1;
  if (!Number.isInteger(outputCount) || outputCount < 1 || outputCount > 4) {
    throw unverified('Fal image edit output count is unverified.');
  }
  return { caseType, resolution, outputCount };
}

/** A server-side snapshot persisted before the provider POST. Never build from
 * client-supplied price fields. The provider payloads fix all other cost
 * switches (web search and thinking off, one output except image-set edits). */
export function createFalImageTariffSnapshot(payload = {}) {
  const model = String(payload.model || '').trim().toUpperCase();
  const version = model === 'SEEDREAM' && getSeedreamFalEndpoint(payload) === LEGACY_SEEDREAM_FAL_ENDPOINT ? 2 : 3;
  const tariff = TARIFFS_BY_VERSION[version][model];
  if (!tariff) throw unverified(`Fal image model ${model || '(missing)'} has no verified fixed tariff.`);
  const [endpoint, baseUsdPerUnit, unit] = tariff;
  if (unit === 'megapixels' && !V1_ROUNDED_MEGAPIXEL_MODELS.has(model)) {
    throw unverified(`Fal image model ${model} has no verified megapixel billing rule.`);
  }
  const nanoEdit = model.includes('NANOBANANA') && model.endsWith('EDIT')
    ? nanoEditConfig(payload) : null;
  const nanoResolution = nanoEdit?.resolution || '1K';
  const nanoMultiplier = { '0.5K': 0.75, '1K': 1, '2K': 1.5, '4K': 2 }[nanoResolution];
  const recraftStyle = ['RECRAFTV3', 'RECRAFT20B'].includes(model)
    ? String(payload.imageStyle || 'digital_illustration').trim().toLowerCase() : null;
  const styleMultiplier = recraftStyle?.startsWith('vector_illustration') ? 2 : 1;
  // Ideogram's adapter payload omits rendering_speed; Fal defaults to
  // BALANCED ($0.06), while the Pricing API lists the TURBO base ($0.03).
  const speedMultiplier = model === 'IDEOGRAMV3' ? 2 : 1;
  const outputCount = nanoEdit?.outputCount || 1;
  return {
    version, model, endpoint, unit, baseUsdPerUnit,
    config: { aspectRatio: payload.aspectRatio || '1:1',
      ...(nanoEdit ? nanoEdit : {}),
      ...(recraftStyle ? { imageStyle: recraftStyle } : {}),
      ...(model === 'IDEOGRAMV3' ? { renderingSpeed: 'BALANCED' } : {}) },
    // The FLUX submitters only send square, 16:9 landscape/portrait, or the
    // Fal default square_hd. Each is at most 1024² pixels and bills 1 MP on
    // the exact FLUX model cards. Seal that unit before the provider call so
    // billing can recover even after the local output file expires.
    billableUnits: unit === 'megapixels' ? 1 : outputCount,
    // Fal Nano Banana 2 charges by output resolution. Generation does not
    // submit a resolution field and therefore uses its 1K default.
    ...(['RECRAFTV3', 'RECRAFT20B'].includes(model) ? { styleMultiplier } : {}),
    ...(model === 'IDEOGRAMV3' ? { speedMultiplier } : {}),
    ...(model.includes('NANOBANANA') ? { resolutionMultiplier: nanoMultiplier } : {}),
    verifiedOn: model === 'SEEDREAM' ? (version === 3 ? '2026-11-16' : '2026-10-24') : '2026-10-23',
    source: model === 'SEEDREAM' && version === 3 ? 'fal-model-card' : 'fal-models-pricing-api',
  };
}

export function calculateFalImageTariffCost(snapshot) {
  const catalog = TARIFFS_BY_VERSION[snapshot?.version];
  if (!catalog?.[snapshot.model]) {
    throw imageBillingError('The Fal image tariff snapshot is unavailable.');
  }
  const [endpoint, rate, unit] = catalog[snapshot.model];
  if (snapshot.endpoint !== endpoint || snapshot.unit !== unit ||
      snapshot.baseUsdPerUnit !== rate) {
    throw imageBillingError('The Fal image tariff snapshot is invalid.');
  }
  if (unit === 'megapixels' && !V1_ROUNDED_MEGAPIXEL_MODELS.has(snapshot.model)) {
    throw imageBillingError('The Fal image megapixel billing rule is unverified.');
  }
  const units = snapshot.billableUnits;
  if (!Number.isInteger(units) || units < 1 || units > 100) {
    throw imageBillingError('The Fal image billing unit count is invalid.');
  }
  const resolutionMultiplier = snapshot.resolutionMultiplier ?? 1;
  if (![0.75, 1, 1.5, 2].includes(resolutionMultiplier)) {
    throw imageBillingError('The Fal image resolution tariff is invalid.');
  }
  const styleMultiplier = snapshot.styleMultiplier ?? 1;
  if (![1, 2].includes(styleMultiplier)) {
    throw imageBillingError('The Fal image style tariff is invalid.');
  }
  const speedMultiplier = snapshot.speedMultiplier ?? 1;
  if (![1, 2, 3].includes(speedMultiplier)) {
    throw imageBillingError('The Fal image speed tariff is invalid.');
  }
  return Math.round(snapshot.baseUsdPerUnit * units * resolutionMultiplier * styleMultiplier * speedMultiplier * 1e8) / 1e8;
}
