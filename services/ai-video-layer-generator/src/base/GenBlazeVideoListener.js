const GENBLAZE_REQUEST_PREFIX = 'genblaze-video:';
const DEFAULT_GENBLAZE_BASE_URL = 'http://genblaze:8080/v1';
const DEFAULT_GENBLAZE_MEDIA_TIMEOUT_MS = 120_000;

export const GENBLAZE_VIDEO_MODELS = new Set([
  'VEO3.1',
  'VEO3.1FAST',
  'VEO3.1I2V',
  'VEO3.1I2VFAST',
  'VEO3.1FLIV',
  'SEEDANCEI2V',
  'SEEDANCE2.0I2V',
  'SEEDANCE2.0T2V',
  'KLINGIMGTOVID3PRO',
  'KLINGIMGTOVIDTURBO',
  'KLINGIMGTOVIDPRO',
  'KLINGIMGTOVID2.1MASTER',
  'KLINGIMGTOVID2.1PRO',
  'KLINGIMGTOVID2.1STANDARD',
  'HAILUOPRO',
  'HAPPYHORSEI2V',
]);

const IMAGE_TO_VIDEO_MODELS = new Set([
  'VEO3.1I2V',
  'VEO3.1I2VFAST',
  'VEO3.1FLIV',
  'SEEDANCEI2V',
  'SEEDANCE2.0I2V',
  'KLINGIMGTOVID3PRO',
  'KLINGIMGTOVIDTURBO',
  'KLINGIMGTOVIDPRO',
  'KLINGIMGTOVID2.1MASTER',
  'KLINGIMGTOVID2.1PRO',
  'KLINGIMGTOVID2.1STANDARD',
  'HAPPYHORSEI2V',
]);

const FIRST_LAST_FRAME_MODELS = new Set(['VEO3.1FLIV']);
const OPTIONAL_START_IMAGE_MODELS = new Set(['HAILUOPRO']);
const END_IMAGE_MODELS = new Set([
  'VEO3.1FLIV',
  'SEEDANCEI2V',
  'SEEDANCE2.0I2V',
  'KLINGIMGTOVID3PRO',
]);

const VEO_MODELS = new Set([
  'VEO3.1',
  'VEO3.1FAST',
  'VEO3.1I2V',
  'VEO3.1I2VFAST',
  'VEO3.1FLIV',
]);
const VEO_IMAGE_MODELS = new Set(['VEO3.1I2V', 'VEO3.1I2VFAST', 'VEO3.1FLIV']);
const SEEDANCE_MODELS = new Set(['SEEDANCEI2V', 'SEEDANCE2.0I2V', 'SEEDANCE2.0T2V']);
const SEEDANCE_ASPECT_RATIOS = new Set(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']);
const HAPPY_HORSE_DURATIONS = Object.freeze([5, 10, 15]);

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeModel(value) {
  return normalizeString(value).toUpperCase();
}

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(normalizeString(value).toLowerCase());
}

function normalizeBaseUrl(value) {
  return (normalizeString(value) || DEFAULT_GENBLAZE_BASE_URL).replace(/\/+$/, '');
}

function firstString(payload, keys) {
  for (const key of keys) {
    const value = normalizeString(payload?.[key]);
    if (value) return value;
  }
  return '';
}

function normalizeDuration(value, fallback = 5) {
  const parsed = Number.parseFloat(String(value ?? '').replace(/s$/i, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeVeoDuration(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (parsed <= 4) return 4;
  if (parsed <= 6) return 6;
  return 8;
}

function normalizeVeoAspectRatio(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (['9:16', '9/16', 'portrait', 'vertical'].includes(normalized)) return '9:16';
  if (['16:9', '16/9', 'landscape', 'horizontal'].includes(normalized)) return '16:9';
  return '16:9';
}

function normalizeVeoResolution(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === '720' || normalized === '720p') return '720p';
  if (normalized === '1080' || normalized === '1080p') return '1080p';
  if (normalized === '4k') return '4k';
  return '';
}

function normalizeSeedanceDuration(value, model) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 5;
  const maximum = model === 'SEEDANCEI2V' ? 12 : 15;
  return Math.min(maximum, Math.max(4, Math.round(parsed)));
}

function normalizeSeedanceAspectRatio(value, model) {
  const normalized = normalizeString(value).toLowerCase();
  if (model !== 'SEEDANCEI2V' && (normalized === 'auto' || normalized === 'adaptive')) {
    return 'adaptive';
  }
  return SEEDANCE_ASPECT_RATIOS.has(normalized) ? normalized : '';
}

function normalizeTurboDuration(value) {
  const parsed = Number(value);
  const duration = Number.isFinite(parsed) ? Math.round(parsed) : 5;
  return String(Math.min(15, Math.max(3, duration)));
}

function normalizeHappyHorseDuration(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return HAPPY_HORSE_DURATIONS[0];
  return HAPPY_HORSE_DURATIONS.find((duration) => duration >= parsed) ||
    HAPPY_HORSE_DURATIONS[HAPPY_HORSE_DURATIONS.length - 1];
}

function addIntegerSeed(params, value, { parse = false } = {}) {
  if (value === undefined || value === null || value === '') return;
  const seed = parse ? Number.parseInt(String(value), 10) : Number(value);
  if (Number.isFinite(seed) && (parse || Number.isInteger(seed))) {
    params.seed = seed;
  }
}

function getRequestId(value) {
  const requestId = normalizeString(value);
  return requestId.startsWith(GENBLAZE_REQUEST_PREFIX)
    ? requestId.slice(GENBLAZE_REQUEST_PREFIX.length)
    : '';
}

export function isGenBlazeVideoRequest(payload = {}) {
  return Boolean(
    getRequestId(payload?.generationId) ||
    ['gmi', 'gmicloud', 'genblaze'].includes(
      normalizeString(payload?.externalProvider || payload?.dockerVideoProvider)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, ''),
    )
  );
}

export function shouldUseGenBlazeVideoProvider(payload = {}) {
  // A sealed GenBlaze id must remain on GenBlaze while polling, even if the
  // current setup has since changed its provider selection or model settings.
  if (getRequestId(payload.generationId)) return true;
  if (!isTruthyEnv(process.env.SAMSAR_GENBLAZE_ENABLED)) return false;
  if (!GENBLAZE_VIDEO_MODELS.has(normalizeModel(payload.model))) return false;
  const selectedProvider = normalizeString(
    payload.dockerVideoProviderOverride || payload.dockerVideoProvider || payload.externalProvider,
  ).toLowerCase().replace(/[^a-z0-9]/g, '');
  return ['gmi', 'gmicloud', 'genblaze'].includes(selectedProvider);
}

export function buildGenBlazeVideoRequest(payload = {}) {
  const model = normalizeModel(payload.model);
  if (!GENBLAZE_VIDEO_MODELS.has(model)) {
    const error = new Error(`Model ${model || '<missing>'} is not supported by the GenBlaze video adapter.`);
    error.code = 'GENBLAZE_MODEL_UNSUPPORTED';
    throw error;
  }

  const startImage = firstString(payload, [
    'startImage', 'startImageUrl', 'start_image', 'start_image_url',
    'image', 'imageUrl', 'imageURL', 'image_url',
  ]);
  const endImage = firstString(payload, [
    'endImage', 'endImageUrl', 'end_image', 'end_image_url',
    'lastFrame', 'lastFrameUrl', 'last_frame', 'last_frame_url',
  ]);
  if (IMAGE_TO_VIDEO_MODELS.has(model) && !startImage) {
    throw new Error(`${model} requires a provider-readable start image.`);
  }
  if (FIRST_LAST_FRAME_MODELS.has(model) && !endImage) {
    throw new Error(`${model} requires a provider-readable end image.`);
  }
  const inputUrls = [];
  if (IMAGE_TO_VIDEO_MODELS.has(model) || OPTIONAL_START_IMAGE_MODELS.has(model)) {
    if (startImage) inputUrls.push(['start image', startImage]);
    if (endImage && END_IMAGE_MODELS.has(model)) inputUrls.push(['end image', endImage]);
  }
  for (const [label, value] of inputUrls) {
    if (value && !/^https?:\/\//i.test(value)) {
      const error = new Error(`GMICloud ${label} must be a provider-readable HTTP URL.`);
      error.code = 'SAMSAR_MEDIA_TUNNEL_UNREACHABLE';
      throw error;
    }
  }

  const generateAudio = payload.generateAudio === true ||
    payload.generate_audio === true ||
    payload.isAudioVideoGeneration === true;
  let params;

  if (VEO_MODELS.has(model)) {
    params = {
      duration: normalizeVeoDuration(payload.duration),
      aspect_ratio: normalizeVeoAspectRatio(payload.aspectRatio || payload.aspect_ratio),
      generate_audio: generateAudio,
    };
    const resolution = normalizeVeoResolution(payload.resolution);
    if (resolution) {
      params.resolution = resolution;
    } else if (VEO_IMAGE_MODELS.has(model)) {
      params.resolution = '720p';
    }
    const negativePrompt = firstString(payload, ['negativePrompt', 'negative_prompt']);
    if (negativePrompt) params.negative_prompt = negativePrompt;
    const personGeneration = firstString(payload, ['personGeneration', 'person_generation']);
    if (personGeneration) params.person_generation = personGeneration;
    addIntegerSeed(params, payload.seed, { parse: true });
  } else if (SEEDANCE_MODELS.has(model)) {
    params = {
      duration: normalizeSeedanceDuration(payload.duration, model),
      generate_audio: generateAudio,
    };
    const aspectRatio = normalizeSeedanceAspectRatio(
      payload.aspectRatio || payload.aspect_ratio,
      model,
    );
    if (aspectRatio) params.aspect_ratio = aspectRatio;
    addIntegerSeed(params, payload.seed);
  } else if (model === 'KLINGIMGTOVIDTURBO') {
    // GMICloud's dedicated Kling 3.0 Turbo endpoint accepts one first frame,
    // a 3-15 second string duration, and a fixed 720p resolution only.
    params = {
      duration: normalizeTurboDuration(payload.duration),
      resolution: '720p',
    };
  } else if (model === 'HAILUOPRO') {
    params = {
      duration: 6,
      resolution: '1080P',
      prompt_optimizer: payload.usePromptOptimizer === true || payload.prompt_optimizer === true,
    };
  } else if (model === 'HAPPYHORSEI2V') {
    params = {
      duration: normalizeHappyHorseDuration(payload.duration),
      resolution: '720P',
    };
    addIntegerSeed(params, payload.seed);
  } else {
    // Keep the established legacy Kling and Kling v3 Pro adapter contract.
    params = {
      duration: normalizeDuration(payload.duration, 5),
      aspect_ratio: normalizeString(payload.aspectRatio || payload.aspect_ratio) || '16:9',
      generate_audio: generateAudio,
    };
    if (model === 'KLINGIMGTOVID3PRO') params.mode = 'pro';
    addIntegerSeed(params, payload.seed);
  }

  return {
    model,
    modality: 'video',
    prompt: normalizeString(payload.prompt),
    input_urls: inputUrls.map(([, value]) => value),
    params,
  };
}

async function readJson(response) {
  const body = await response.text();
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('GenBlaze returned an invalid JSON response.');
  }
}

function getErrorMessage(body, fallback) {
  return normalizeString(body?.error?.message) ||
    normalizeString(body?.message) ||
    normalizeString(body?.error) ||
    fallback;
}

function getResponseHeaders(headers) {
  if (!headers) return {};
  if (typeof headers.entries === 'function') {
    return Object.fromEntries(
      Array.from(headers.entries(), ([key, value]) => [String(key).toLowerCase(), value]),
    );
  }
  if (typeof headers.forEach === 'function') {
    const entries = {};
    headers.forEach((value, key) => {
      entries[String(key).toLowerCase()] = value;
    });
    return entries;
  }
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), value]),
  );
}

export async function requestGenBlazeVideo(pathname, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('This runtime cannot call GenBlaze because fetch is unavailable.');
  }
  if (!isTruthyEnv(env.SAMSAR_GENBLAZE_ENABLED)) {
    throw new Error('SAMSAR_GENBLAZE_ENABLED is required for GMICloud video generation.');
  }

  const controller = new AbortController();
  const timeoutMs = Math.max(
    1_000,
    Number(env.SAMSAR_GENBLAZE_MEDIA_TIMEOUT_MS) || DEFAULT_GENBLAZE_MEDIA_TIMEOUT_MS,
  );
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(
      `${normalizeBaseUrl(env.SAMSAR_GENBLAZE_BASE_URL)}${pathname}`,
      {
        method: options.method || 'GET',
        headers: {
          Accept: 'application/json',
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        signal: controller.signal,
      },
    );
    const responseBody = await readJson(response);
    if (!response.ok) {
      const responseHeaders = getResponseHeaders(response.headers);
      const error = new Error(getErrorMessage(
        responseBody,
        `GenBlaze video request failed with status ${response.status}.`,
      ));
      error.status = response.status;
      error.code = responseBody?.error?.code;
      error.headers = responseHeaders;
      error.response = {
        status: response.status,
        data: responseBody,
        headers: responseHeaders,
      };
      throw error;
    }
    return responseBody;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('GenBlaze video request timed out.');
      timeoutError.status = 408;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateGenBlazeVideoLayer(payload = {}, dependencies = {}) {
  const request = dependencies.request || requestGenBlazeVideo;
  const response = await request('/media/requests', {
    method: 'POST',
    body: buildGenBlazeVideoRequest(payload),
  });
  const requestId = normalizeString(response?.request_id);
  if (!requestId) {
    throw new Error('GenBlaze video submit returned no request id.');
  }
  return `${GENBLAZE_REQUEST_PREFIX}${requestId}`;
}

export async function listenToPendingGenBlazeVideoRequest(payload = {}, dependencies = {}) {
  const requestId = getRequestId(payload.generationId);
  if (!requestId) {
    throw new Error('Missing GenBlaze video request id.');
  }
  const request = dependencies.request || requestGenBlazeVideo;
  const response = await request(`/media/requests/${encodeURIComponent(requestId)}`);
  const status = normalizeString(response?.status).toLowerCase();
  if (status === 'pending' || status === 'queued' || status === 'running') {
    return { responseStatus: 'PENDING' };
  }
  if (status === 'succeeded') {
    const remoteUrl = normalizeString(response?.assets?.[0]?.url);
    if (!remoteUrl) {
      return {
        responseStatus: 'FAILED',
        providerFailureMessage: 'GMICloud video result returned no video URL.',
        providerStatus: response,
      };
    }
    return { responseStatus: 'COMPLETED', remoteUrl };
  }
  return {
    responseStatus: 'FAILED',
    providerFailureMessage: getErrorMessage(
      response,
      `GMICloud video request ${status || 'failed'}.`,
    ),
    providerStatus: response,
  };
}
