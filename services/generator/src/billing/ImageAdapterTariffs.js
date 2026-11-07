import { GPT_IMAGE_TWO_MODEL } from '../providers/GPTImageTwoPayload.js';

// Verified once from the provider's published standard prices. Runtime image
// billing uses this catalog and completed-call usage; it never fetches prices.
// Keep each version immutable so a saved completion retains its submitted rate.
const VERIFIED_ON = '2026-10-24';
const OPENAI_SOURCE = 'https://developers.openai.com/api/docs/pricing';
const GOOGLE_SOURCE = 'https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing';
const ALIBABA_SOURCE = 'https://www.alibabacloud.com/help/en/model-studio/model-pricing';
const GMI_SOURCE = 'https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey/models/';

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export const IMAGE_ADAPTER_TARIFFS_V1 = freeze({
  'openai:gpt-image-2.5-sunburst': { adapter: 'openai', unit: 'million_tokens',
    rates: { textInput: 5, imageInput: 8, imageOutput: 30 }, source: OPENAI_SOURCE },
  'openai:gpt-image-2.5-flare': { adapter: 'openai', unit: 'million_tokens',
    rates: { textInput: 5, imageInput: 8, imageOutput: 30 }, source: OPENAI_SOURCE },
  'googleCloud:gemini-3.1-flash-image': { adapter: 'googleCloud', unit: 'million_tokens',
    rates: { input: 0.5, cachedInput: 0.05, textOutput: 3, imageOutput: 60,
      nonGlobalMultiplier: 1.1 }, source: GOOGLE_SOURCE },
  'googleCloud:gemini-3-pro-image': { adapter: 'googleCloud', unit: 'million_tokens',
    rates: { input: 2, cachedInput: 0.2, textOutput: 12, imageOutput: 120,
      nonGlobalMultiplier: 1.1 }, source: GOOGLE_SOURCE },
  'googleCloud:imagen-3.0-generate-001': { adapter: 'googleCloud', unit: 'images',
    rates: { output: 0.04 }, source: GOOGLE_SOURCE },
  'googleCloud:imagen-3.0-fast-generate-001': { adapter: 'googleCloud', unit: 'images',
    rates: { output: 0.02 }, source: GOOGLE_SOURCE },
  'alibabaCloud:qwen-image-3.0-pro': { adapter: 'alibabaCloud', unit: 'images',
    rates: { internationalInput: 0.003, international1K: 0.04, international2K: 0.075,
      chinaInput: 0.00275, china1K: 0.03438, china2K: 0.068761 }, source: ALIBABA_SOURCE },
  'alibabaCloud:wan2.7-image-pro': { adapter: 'alibabaCloud', unit: 'images',
    rates: { internationalOutput: 0.075, chinaOutput: 0.068761 }, source: ALIBABA_SOURCE },
  'gmicloud:seedream-5.0-pro': { adapter: 'gmicloud', unit: 'images',
    rates: { output: 0.085 }, source: `${GMI_SOURCE}seedream-5.0-pro` },
  // The account model card's nominal $0.07 is an estimate. Its detailed
  // contract bills input, text output and image output tokens separately.
  'gmicloud:gemini-3.1-flash-image': { adapter: 'gmicloud', unit: 'million_tokens',
    rates: { input: 0.5, cachedInput: 0.5, textOutput: 3, imageOutput: 60,
      nonGlobalMultiplier: 1 }, source: `${GMI_SOURCE}gemini-3.1-flash-image` },
  'gmicloud:gemini-3-pro-image': { adapter: 'gmicloud', unit: 'images',
    rates: { input: 0.0011, output1K: 0.134, output2K: 0.134, output4K: 0.24 },
    source: `${GMI_SOURCE}gemini-3-pro-image` },
  'gmicloud:bria-eraser': { adapter: 'gmicloud', unit: 'images',
    rates: { output: 0.04 }, source: `${GMI_SOURCE}bria-eraser` },
  'gmicloud:bria-genfill': { adapter: 'gmicloud', unit: 'images',
    rates: { output: 0.04 }, source: `${GMI_SOURCE}bria-genfill` },
});
// V3 adds Sunburst 2.6 at the same published rates. V1/V2 receipts remain valid.
export const IMAGE_ADAPTER_TARIFFS = freeze({
  ...IMAGE_ADAPTER_TARIFFS_V1,
  'openai:gpt-image-2.6-sunburst': { adapter: 'openai', unit: 'million_tokens',
    rates: { textInput: 5, imageInput: 8, imageOutput: 30 }, source: OPENAI_SOURCE,
    verifiedOn: '2026-11-07' },
});
// V2 changes only GMI Nano2's missing-usage settlement policy. The provider's
// normal response may include money but omit token modality usage. Keep that
// previous successful path without inferring its approximate model-card cost.
// Existing v1 seals retain their original strict usage requirement.
const TARIFFS_BY_VERSION = freeze({
  1: IMAGE_ADAPTER_TARIFFS_V1, 2: IMAGE_ADAPTER_TARIFFS_V1, 3: IMAGE_ADAPTER_TARIFFS,
});
const GMI_NANO2_TARIFF_ID = 'gmicloud:gemini-3.1-flash-image';
const OPENAI_SUNBURST_26_TARIFF_ID = 'openai:gpt-image-2.6-sunburst';

function pending(message) {
  return Object.assign(new Error(message), { code: 'IMAGE_BILLING_PENDING', imageBillingPending: true });
}

function unavailable(message, code = 'IMAGE_ADAPTER_TARIFF_UNVERIFIED') {
  return Object.assign(new Error(message), { code, nonPromptProviderFailure: true,
    preserveExpressImageLayer: true });
}

function count(value, label) {
  if (!['number', 'string'].includes(typeof value) ||
      (typeof value === 'string' && !value.trim()) || !Number.isInteger(Number(value)) || Number(value) < 0) {
    throw pending(`A valid ${label} is required for the image charge.`);
  }
  return Number(value);
}

function normalizedAdapter(adapter) {
  return adapter === 'genblaze' ? 'gmicloud' : adapter;
}

function firstString(...values) {
  return values.find(value => typeof value === 'string' && value.trim())?.trim() || '';
}

function googleProviderModel(model, env) {
  return model.startsWith('NANOBANANAPRO')
    ? firstString(env.GOOGLE_NANOBANANA_PRO_MODEL, env.GOOGLE_NANO_BANANA_PRO_MODEL, 'gemini-3-pro-image')
    : firstString(env.GOOGLE_NANOBANANA_2_MODEL, env.GOOGLE_NANO_BANANA_2_MODEL, 'gemini-3.1-flash-image');
}

function googleRegion(env) {
  return firstString(env.GOOGLE_NANOBANANA_LOCATION, env.GOOGLE_GEMINI_IMAGE_LOCATION,
    env.GOOGLE_GEMINI_LOCATION, env.GOOGLE_VERTEX_AI_LOCATION, 'global');
}

function alibabaRegion(env) {
  const endpoint = firstString(env.ALIBABA_IMAGE_GENERATION_URL, env.DASHSCOPE_IMAGE_GENERATION_URL,
    env.ALIBABA_WAN_IMAGE_GENERATION_URL, env.ALIBABA_IMAGE_BASE_URL, env.DASHSCOPE_IMAGE_BASE_URL,
    env.ALIBABA_API_HOST, env.DASHSCOPE_BASE_URL, env.ALIBABA_CLOUD_BASE_URL,
    'https://dashscope-intl.aliyuncs.com');
  const host = new URL(endpoint.includes('://') ? endpoint : `https://${endpoint}`).hostname;
  if (!host.endsWith('.aliyuncs.com')) {
    throw unavailable('The configured Alibaba image endpoint has no verified fixed tariff.');
  }
  return host.includes('-intl') ? 'international' : 'china';
}

function gmiInputImageCount(payload) {
  const references = new Set();
  const push = value => {
    const reference = firstString(typeof value === 'string' ? value : value?.url || value?.image_url || value?.imageUrl);
    if (reference) references.add(reference);
  };
  for (const key of ['image_urls', 'imageUrls', 'input_image_urls', 'inputImageUrls']) {
    if (Array.isArray(payload[key])) payload[key].forEach(push);
  }
  for (const key of ['image', 'image_url', 'imageUrl', 'imageRef', 'inputImage']) push(payload[key]);
  return Math.min(references.size, 14);
}

function tariffIdForProviderModel(adapter, providerModel) {
  if (adapter === 'openai') {
    const match = /^(gpt-image-2\.[56]-(?:sunburst|flare))(?:-|$)/.exec(providerModel || '');
    if (match) return `openai:${match[1]}`;
  }
  if (adapter === 'googleCloud') {
    if (/^gemini-3\.1-flash-image(?:-|$)/.test(providerModel || '')) return 'googleCloud:gemini-3.1-flash-image';
    if (/^gemini-3-pro-image(?:-|$)/.test(providerModel || '')) return 'googleCloud:gemini-3-pro-image';
    const imagen = { IMAGEN3: 'imagen-3.0-generate-001', IMAGEN3FLASH: 'imagen-3.0-fast-generate-001' };
    return `${adapter}:${imagen[providerModel] || providerModel}`;
  }
  return `${adapter}:${providerModel}`;
}

/** Only server dispatch settings are accepted here, never a caller's prices.
 * receipt is used solely to recover a trusted, saved pre-catalog completion. */
export function createImageAdapterTariffSnapshot(payload = {}, { env = process.env, receipt } = {}) {
  const adapter = normalizedAdapter(payload.submittedAdapter || payload.adapterProvider || payload.externalProvider);
  const model = String(payload.model || '').trim().toUpperCase();
  let providerModel;
  let config = {};
  if (adapter === 'openai') {
    if (['GPTIMAGE2.5', 'GPTIMAGE2.5EDIT', 'GPTIMAGE1', 'GPTIMAGE1EDIT'].includes(model)) {
      providerModel = receipt?.model || GPT_IMAGE_TWO_MODEL;
    }
  } else if (adapter === 'googleCloud') {
    if (['NANOBANANA2', 'NANOBANANAPRO', 'NANOBANANA2EDIT', 'NANOBANANAPROEDIT', 'NANOBANANAEDIT'].includes(model)) {
      providerModel = receipt?.calls?.[0]?.model || receipt?.model || googleProviderModel(model, env);
      config.region = receipt?.calls?.[0]?.region || receipt?.region || googleRegion(env);
    } else if (model === 'IMAGEN3' || model === 'IMAGEN3FLASH') {
      providerModel = model === 'IMAGEN3' ? 'imagen-3.0-generate-001' : 'imagen-3.0-fast-generate-001';
      config = { outputImages: 1 };
    }
  } else if (adapter === 'alibabaCloud') {
    if (model === 'QWENIMAGE3PRO' || model === 'WAN2.7PRO') {
      providerModel = model === 'QWENIMAGE3PRO' ? 'qwen-image-3.0-pro' : 'wan2.7-image-pro';
      // Both native submitters send one 1K-class output and no input image.
      // They ignore the job's resolution setting, including enhancement UI values.
      config = { region: receipt?.region || alibabaRegion(env), resolution: '1K', outputImages: 1, inputImages: 0 };
    }
  } else if (adapter === 'gmicloud') {
    const models = { SEEDREAM: 'seedream-5.0-pro', NANOBANANA2: 'gemini-3.1-flash-image',
      NANOBANANA2EDIT: 'gemini-3.1-flash-image', NANOBANANAPRO: 'gemini-3-pro-image',
      NANOBANANAPROEDIT: 'gemini-3-pro-image', BRIA_ERASER: 'bria-eraser', BRIA_GENFILL: 'bria-genfill' };
    providerModel = models[model];
    if (providerModel) {
      if (String(payload.case_type).toLowerCase() === 'image_list_to_image_set') {
        throw unavailable('GMICloud image-set editing does not have a supported multi-output contract.');
      }
      const edit = model.endsWith('EDIT') || model.startsWith('BRIA_');
      const requested = firstString(payload.resolution, edit ? payload.image_size : payload.imageResolution,
        edit ? payload.imageSize : '', '1K').toUpperCase();
      const resolution = { '0.5K': '512', AUTO_1K: '1K', AUTO_2K: '2K' }[requested] || requested;
      if (model.startsWith('NANOBANANA') &&
          !(model.startsWith('NANOBANANAPRO') ? ['1K', '2K', '4K'] : ['512', '1K', '2K', '4K']).includes(resolution)) {
        throw unavailable('The GMICloud image output resolution has no verified fixed tariff.');
      }
      config = { outputImages: 1, inputImages: edit ? gmiInputImageCount(payload) : 0,
        ...(model.startsWith('NANOBANANA') ? { resolution } : {}) };
    }
  }
  const tariffId = tariffIdForProviderModel(adapter, providerModel);
  const tariff = IMAGE_ADAPTER_TARIFFS[tariffId];
  if (!tariff || tariff.adapter !== adapter) {
    throw unavailable(`Image adapter ${adapter || '(missing)'} model ${model || '(missing)'} has no verified fixed tariff.`);
  }
  const version = tariffId === GMI_NANO2_TARIFF_ID ? 2 : tariffId === OPENAI_SUNBURST_26_TARIFF_ID ? 3 : 1;
  return { version, adapter, model, providerModel, tariffId, unit: tariff.unit,
    rates: { ...tariff.rates }, config, verifiedOn: tariff.verifiedOn || VERIFIED_ON, source: tariff.source };
}

export function assertImageAdapterTariffSnapshot(snapshot) {
  const tariff = TARIFFS_BY_VERSION[snapshot?.version]?.[snapshot?.tariffId];
  if (!tariff || snapshot.version === 2 && snapshot.tariffId !== GMI_NANO2_TARIFF_ID ||
      snapshot.version === 3 && snapshot.tariffId !== OPENAI_SUNBURST_26_TARIFF_ID ||
      snapshot.adapter !== tariff.adapter || snapshot.unit !== tariff.unit ||
      tariffIdForProviderModel(snapshot.adapter, snapshot.providerModel) !== snapshot.tariffId ||
      Object.keys(snapshot.rates || {}).length !== Object.keys(tariff.rates).length ||
      Object.entries(tariff.rates).some(([key, value]) => snapshot.rates[key] !== value)) {
    throw pending('The saved image adapter tariff snapshot is invalid or unavailable.');
  }
  if (!snapshot.config || typeof snapshot.config !== 'object' || Array.isArray(snapshot.config)) {
    throw pending('The saved image adapter tariff configuration is invalid.');
  }
  if (snapshot.adapter === 'googleCloud' && tariff.unit === 'million_tokens' &&
      !/^(global|[a-z]+(?:-[a-z]+)+\d)$/.test(snapshot.config.region || '')) {
    throw pending('The saved image adapter tariff region is invalid.');
  }
  if (snapshot.adapter === 'alibabaCloud' && (snapshot.config.outputImages !== 1 ||
      snapshot.config.inputImages !== 0 || snapshot.config.resolution !== '1K' ||
      !['international', 'china', 'global'].includes(snapshot.config.region))) {
    throw pending('The saved Alibaba image tariff configuration is invalid.');
  }
  return tariff;
}

function nativeOpenAICharge(receipt, tariff) {
  const { usage } = receipt;
  const text = count(usage?.input_tokens_details?.text_tokens, 'text input tokens');
  const images = count(usage?.input_tokens_details?.image_tokens, 'image input tokens');
  const total = count(usage?.input_tokens, 'input tokens');
  const output = count(usage?.output_tokens, 'image output tokens');
  if (text + images !== total) throw pending('Incomplete image input token usage.');
  // Direct Images API and edits do not support Responses-only cache discounts.
  return (text * tariff.rates.textInput + images * tariff.rates.imageInput + output * tariff.rates.imageOutput) / 1_000_000;
}

function nativeGoogleCharge({ usage, region = 'global' }, tariff) {
  const input = count(usage?.promptTokenCount, 'input tokens');
  const cached = count(usage?.cachedContentTokenCount ?? 0, 'cached input tokens');
  const candidates = count(usage?.candidatesTokenCount, 'output tokens');
  const thoughts = count(usage?.thoughtsTokenCount ?? 0, 'reasoning tokens');
  if (!Array.isArray(usage?.candidatesTokensDetails)) {
    throw pending('Image output token details are required for the charge.');
  }
  let imageOutput = 0;
  let textOutput = 0;
  for (const detail of usage.candidatesTokensDetails) {
    const tokens = count(detail?.tokenCount, 'output modality tokens');
    if (String(detail.modality).toUpperCase() === 'IMAGE') imageOutput += tokens;
    else if (String(detail.modality).toUpperCase() === 'TEXT') textOutput += tokens;
    else throw pending('Unknown image output token modality.');
  }
  if (cached > input || imageOutput + textOutput !== candidates) throw pending('Inconsistent image token usage.');
  const regional = region && region !== 'global' ? tariff.rates.nonGlobalMultiplier : 1;
  return ((input - cached) * tariff.rates.input + cached * tariff.rates.cachedInput +
    imageOutput * tariff.rates.imageOutput + (textOutput + thoughts) * tariff.rates.textOutput) * regional / 1_000_000;
}

function nativeAlibabaCharge({ outputImages, inputImages = 0, resolution, region = 'international' }, tariff) {
  const outputs = count(outputImages, 'output image count');
  const inputs = count(inputImages, 'input image count');
  if (!['international', 'china', 'global'].includes(region)) {
    throw pending('The image region needs a complete adapter charge.');
  }
  const prefix = region === 'international' ? 'international' : 'china';
  if (tariff.rates[`${prefix}Output`] !== undefined) return outputs * tariff.rates[`${prefix}Output`];
  const size = String(resolution).toUpperCase();
  if (!['1K', '2K'].includes(size)) throw pending('The output resolution needs an adapter charge.');
  return inputs * tariff.rates[`${prefix}Input`] + outputs * tariff.rates[`${prefix}${size}`];
}

/** Legacy unsealed native receipts use the same constant unit rates. */
export function calculateNativeImageCost(receipt = {}) {
  const tariff = IMAGE_ADAPTER_TARIFFS[tariffIdForProviderModel(receipt.adapter, receipt.model)];
  if (!tariff || tariff.unit === 'images' && receipt.adapter !== 'alibabaCloud') {
    throw pending('The image model needs a complete adapter charge.');
  }
  if (receipt.adapter === 'openai') return nativeOpenAICharge(receipt, tariff);
  if (receipt.adapter === 'googleCloud') return nativeGoogleCharge(receipt, tariff);
  if (receipt.adapter === 'alibabaCloud') return nativeAlibabaCharge(receipt, tariff);
  throw pending('A complete image adapter charge is required.');
}

export function calculateImageAdapterTariffBilling(snapshot, receipt = {}) {
  const tariff = assertImageAdapterTariffSnapshot(snapshot);
  let costSource = 'static_tariff';
  let pricingException;
  if (receipt.adapter && normalizedAdapter(receipt.adapter) !== snapshot.adapter) {
    throw pending('The saved image adapter conflicts with its sealed tariff.');
  }
  const checkCall = call => {
    if (call.adapter && normalizedAdapter(call.adapter) !== snapshot.adapter ||
        call.model && call.model !== snapshot.model && call.model !== snapshot.providerModel) {
      throw pending('The saved image model conflicts with its sealed tariff.');
    }
    if (snapshot.config.region && call.region && call.region !== snapshot.config.region) {
      throw pending('The saved image region conflicts with its sealed tariff.');
    }
    if (snapshot.adapter === 'openai') return nativeOpenAICharge(call, tariff);
    if (snapshot.adapter === 'googleCloud' && tariff.unit === 'million_tokens') {
      return nativeGoogleCharge({ ...call, region: snapshot.config.region }, tariff);
    }
    if (snapshot.adapter === 'alibabaCloud') {
      for (const key of ['resolution', 'outputImages', 'inputImages']) {
        if (call[key] !== undefined && call[key] !== snapshot.config[key]) {
          throw pending('The saved image usage conflicts with its sealed tariff.');
        }
      }
      return nativeAlibabaCharge(snapshot.config, tariff);
    }
    if (snapshot.adapter === 'googleCloud' && tariff.unit === 'images') {
      if (snapshot.config.outputImages !== 1) throw pending('Invalid image output count in the sealed tariff.');
      return tariff.rates.output;
    }
    if (snapshot.adapter === 'gmicloud') {
      if (tariff.unit === 'million_tokens') {
        try {
          return nativeGoogleCharge(call, tariff);
        } catch (error) {
          // This value is captured from the trusted ordinary generation/status
          // response, never a client price or an additional pricing/result GET.
          const value = call.costUsd;
          const validReportedAmount = ['number', 'string'].includes(typeof value) &&
            (typeof value !== 'string' || value.trim()) && Number.isFinite(Number(value)) && Number(value) >= 0;
          if (snapshot.version !== 2 || snapshot.tariffId !== GMI_NANO2_TARIFF_ID ||
              !error.imageBillingPending || !validReportedAmount) throw error;
          costSource = 'adapter_reported_unverified_usage';
          pricingException = 'GMI_NANO2_TOKEN_USAGE_UNAVAILABLE';
          return Number(value);
        }
      }
      const outputs = count(snapshot.config.outputImages, 'output image count');
      const inputs = count(snapshot.config.inputImages, 'input image count');
      if (outputs !== 1 || inputs > 14) throw pending('The saved GMICloud image unit counts are invalid.');
      if (call.outputImages !== undefined && call.outputImages !== outputs) {
        throw pending('The completed GMICloud output count conflicts with its sealed tariff.');
      }
      if (tariff.rates.output !== undefined) return outputs * tariff.rates.output;
      const output = tariff.rates[`output${snapshot.config.resolution}`];
      if (output === undefined) throw pending('The saved GMICloud output resolution is invalid.');
      return inputs * tariff.rates.input + outputs * output;
    }
    throw pending('The image adapter has no available fixed tariff calculation.');
  };
  const costUsd = Array.isArray(receipt.calls) && receipt.calls.length
    ? receipt.calls.reduce((sum, call) => sum + checkCall(call), 0) : checkCall(receipt);
  return { costUsd, costSource, ...(pricingException ? { pricingException } : {}) };
}

export function calculateImageAdapterTariffCost(snapshot, receipt = {}) {
  return calculateImageAdapterTariffBilling(snapshot, receipt).costUsd;
}
