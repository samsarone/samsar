import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const GMI_CLOUD_KEY_VALIDATION_URL =
  'https://api.gmi-serving.com/v1/models';
export const GMI_CLOUD_MEDIA_MODELS_URL =
  'https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey/models';
export const GMI_CLOUD_PROVIDER_VALIDATION_TTL_MS = 60 * 60 * 1000;
const DEFAULT_VALIDATION_TIMEOUT_MS = 5_000;

// Each candidate is an exact upstream version. Chat catalog matching ignores
// only owner prefixes and case; it never falls forward to a different version.
// Qwen 3.6 Plus is the explicitly curated vision equivalent for Qwen 3.7 Max.
export const GMI_CLOUD_CHAT_MODEL_SPECS = Object.freeze({
  'gpt-5.6-sol': Object.freeze({
    text: Object.freeze({ candidates: Object.freeze(['openai/gpt-5.6-sol']) }),
    vision: Object.freeze({ candidates: Object.freeze(['openai/gpt-5.6-sol']) }),
  }),
  'gemini-3.1-pro': Object.freeze({
    text: Object.freeze({ candidates: Object.freeze(['google/gemini-3.1-pro-preview']) }),
    vision: Object.freeze({ candidates: Object.freeze(['google/gemini-3.1-pro-preview']) }),
  }),
  'QWEN3.7': Object.freeze({
    text: Object.freeze({ candidates: Object.freeze(['Qwen/Qwen3.7-Max']) }),
    vision: Object.freeze({
      candidates: Object.freeze([
        'Qwen/Qwen3.7-Plus',
        'Qwen/Qwen3.6-Plus',
        'Qwen/Qwen3.6-Plus-2026-04-02',
      ]),
    }),
  }),
});

export const GMI_CLOUD_MEDIA_MODEL_SPECS = Object.freeze([
  Object.freeze({ samsarModel: 'GPTIMAGE2', modality: 'image', modelId: 'gpt-image-2-generate' }),
  Object.freeze({ samsarModel: 'GPTIMAGE2EDIT', modality: 'image', modelId: 'gpt-image-2-edit', operation: 'image.edit' }),
  Object.freeze({ samsarModel: 'SEEDREAM', modality: 'image', modelId: 'seedream-5.0-pro' }),
  Object.freeze({ samsarModel: 'NANOBANANA2', modality: 'image', modelId: 'gemini-3.1-flash-image' }),
  Object.freeze({ samsarModel: 'NANOBANANA2EDIT', modality: 'image', modelId: 'gemini-3.1-flash-image', operation: 'image.edit' }),
  Object.freeze({ samsarModel: 'NANOBANANAPRO', modality: 'image', modelId: 'gemini-3-pro-image' }),
  Object.freeze({ samsarModel: 'NANOBANANAPROEDIT', modality: 'image', modelId: 'gemini-3-pro-image', operation: 'image.edit' }),
  Object.freeze({ samsarModel: 'BRIA_ERASER', modality: 'image', modelId: 'bria-eraser', operation: 'image.edit' }),
  Object.freeze({ samsarModel: 'BRIA_GENFILL', modality: 'image', modelId: 'bria-genfill', operation: 'image.edit' }),
  Object.freeze({ samsarModel: 'VEO3.1', modality: 'video', modelId: 'veo-3.1-generate-001' }),
  Object.freeze({ samsarModel: 'VEO3.1FAST', modality: 'video', modelId: 'veo-3.1-fast-generate-001' }),
  Object.freeze({ samsarModel: 'VEO3.1I2V', modality: 'video', modelId: 'veo-3.1-generate-001' }),
  Object.freeze({ samsarModel: 'VEO3.1I2VFAST', modality: 'video', modelId: 'veo-3.1-fast-generate-001' }),
  Object.freeze({ samsarModel: 'VEO3.1FLIV', modality: 'video', modelId: 'veo-3.1-generate-001' }),
  Object.freeze({ samsarModel: 'SEEDANCEI2V', modality: 'video', modelId: 'seedance-1-5-pro-251215' }),
  Object.freeze({ samsarModel: 'SEEDANCE2.0I2V', modality: 'video', modelId: 'seedance-2-0-260128' }),
  Object.freeze({ samsarModel: 'KLINGIMGTOVID3PRO', modality: 'video', modelId: 'kling-v3-image-to-video' }),
  Object.freeze({ samsarModel: 'KLINGIMGTOVIDTURBO', modality: 'video', modelId: 'kling-3.0-turbo-i2v' }),
  Object.freeze({ samsarModel: 'KLINGIMGTOVIDPRO', modality: 'video', modelId: 'Kling-Image2Video-V1.6-Pro' }),
  Object.freeze({ samsarModel: 'KLINGIMGTOVID2.1MASTER', modality: 'video', modelId: 'Kling-Image2Video-V2.1-Master' }),
  Object.freeze({ samsarModel: 'KLINGIMGTOVID2.1PRO', modality: 'video', modelId: 'Kling-Image2Video-V2.1-Pro' }),
  Object.freeze({ samsarModel: 'KLINGIMGTOVID2.1STANDARD', modality: 'video', modelId: 'Kling-Image2Video-V2.1-Standard' }),
  Object.freeze({ samsarModel: 'HAILUOPRO', modality: 'video', modelId: 'Minimax-Hailuo-02' }),
  Object.freeze({ samsarModel: 'HAPPYHORSEI2V', modality: 'video', modelId: 'happyhorse-1.1-i2v' }),
  // Keep the exact Express speech versions in preference order. The public
  // GMICloud catalog does not currently expose OpenAI TTS and marks the two
  // ElevenLabs routes inactive, so these mappings are emitted only when the
  // configured credential's authenticated catalog actually contains them.
  Object.freeze({ samsarModel: 'OPENAI_TTS', modality: 'audio', modelId: 'gpt-4o-mini-tts' }),
  Object.freeze({ samsarModel: 'ELEVENLABS', modality: 'audio', modelId: 'elevenlabs-tts-multilingual-v2' }),
  Object.freeze({ samsarModel: 'ELEVENLABS', modality: 'audio', modelId: 'elevenlabs-tts-v3' }),
]);

const ACTIVE_CATALOG_STATUSES = new Set(['active', 'available', 'enabled', 'online', 'ready']);
const ALLOWED_ROUTE_MODALITIES = Object.freeze({
  ...Object.fromEntries(Object.keys(GMI_CLOUD_CHAT_MODEL_SPECS).map((modelKey) => [
    modelKey,
    Object.freeze(['text', 'vision']),
  ])),
  ...Object.fromEntries(GMI_CLOUD_MEDIA_MODEL_SPECS.map((spec) => [
    spec.samsarModel,
    Object.freeze([spec.modality]),
  ])),
});

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function buildGmiCloudCredentialFingerprint(apiKey) {
  return createHash('sha256').update(normalizeString(apiKey)).digest('hex');
}

function catalogModelId(model) {
  return normalizeString(
    typeof model === 'string'
      ? model
      : model?.id || model?.model || (model?.object === 'model' ? '' : model?.object),
  );
}

function catalogModelIsActive(model) {
  if (!model || typeof model === 'string') {
    return true;
  }

  for (const field of ['active', 'enabled', 'available']) {
    if (!Object.hasOwn(model, field)) continue;
    const value = model[field];
    if (value === true || ['true', ...ACTIVE_CATALOG_STATUSES].includes(normalizeString(value).toLowerCase())) {
      continue;
    }
    return false;
  }
  for (const field of ['status', 'state', 'lifecycleStatus', 'lifecycle_status']) {
    if (!Object.hasOwn(model, field)) continue;
    const status = normalizeString(model[field]).toLowerCase();
    if (!ACTIVE_CATALOG_STATUSES.has(status)) {
      return false;
    }
  }
  return true;
}

function extractCatalogModels(body) {
  const models = Array.isArray(body?.data)
    ? body.data
    : Array.isArray(body?.models)
      ? body.models
      : Array.isArray(body?.model_ids)
        ? body.model_ids
        : Array.isArray(body?.data?.models)
          ? body.data.models
          : Array.isArray(body?.data?.model_ids)
            ? body.data.model_ids
            : null;
  if (!models) {
    return null;
  }
  return models
    .map((model) => ({ id: catalogModelId(model), active: catalogModelIsActive(model) }))
    .filter((model) => Boolean(model.id));
}

function modelLeaf(value) {
  return normalizeString(value).split('/').filter(Boolean).at(-1)?.toLowerCase() || '';
}

export function chatCatalogModelMatches(actualModelId, expectedModelId) {
  return Boolean(modelLeaf(actualModelId) && modelLeaf(actualModelId) === modelLeaf(expectedModelId));
}

function findPreferredCatalogModel(catalogModels, candidates) {
  for (const candidate of candidates) {
    const matching = catalogModels.find((model) => (
      model.active && chatCatalogModelMatches(model.id, candidate)
    ));
    if (matching) {
      return matching.id;
    }
  }
  return '';
}

function routeOperation(modality) {
  if (modality === 'text' || modality === 'vision') return 'chat.completions';
  if (modality === 'image') return 'image.generate';
  if (modality === 'video') return 'video.generate';
  return 'audio.generate';
}

function operationForRoute(modelKey, modality, modelId) {
  if (GMI_CLOUD_CHAT_MODEL_SPECS[modelKey]?.[modality]) {
    return routeOperation(modality);
  }
  const mediaSpec = GMI_CLOUD_MEDIA_MODEL_SPECS.find((spec) => (
    spec.samsarModel === modelKey &&
    spec.modality === modality &&
    spec.modelId.toLowerCase() === normalizeString(modelId).toLowerCase()
  ));
  return mediaSpec?.operation || routeOperation(modality);
}

function buildChatModelMappings(catalogModels) {
  return Object.fromEntries(Object.entries(GMI_CLOUD_CHAT_MODEL_SPECS)
    .map(([modelKey, modalities]) => {
      const matchedModalities = Object.fromEntries(Object.entries(modalities)
        .map(([modality, spec]) => {
          const modelId = findPreferredCatalogModel(catalogModels, spec.candidates);
          return modelId
            ? [modality, { modelId, operation: routeOperation(modality) }]
            : null;
        })
        .filter(Boolean));
      return Object.keys(matchedModalities).length ? [modelKey, matchedModalities] : null;
    })
    .filter(Boolean));
}

function isAllowedRouteModelId(modelKey, modality, modelId) {
  const chatSpec = GMI_CLOUD_CHAT_MODEL_SPECS[modelKey]?.[modality];
  if (chatSpec) {
    return chatSpec.candidates.some((candidate) => chatCatalogModelMatches(modelId, candidate));
  }
  return GMI_CLOUD_MEDIA_MODEL_SPECS.some((spec) => (
    spec.samsarModel === modelKey &&
    spec.modality === modality &&
    spec.modelId.toLowerCase() === normalizeString(modelId).toLowerCase()
  ));
}

export function normalizeGmiCloudModelMappings(modelMappings = {}) {
  if (!modelMappings || typeof modelMappings !== 'object' || Array.isArray(modelMappings)) {
    return {};
  }
  return Object.fromEntries(Object.entries(modelMappings)
    .map(([modelKey, routes]) => {
      const allowedModalities = ALLOWED_ROUTE_MODALITIES[modelKey];
      if (!allowedModalities || !routes || typeof routes !== 'object' || Array.isArray(routes)) {
        return null;
      }
      const normalizedRoutes = Object.fromEntries(allowedModalities
        .map((modality) => {
          const modelId = normalizeString(routes[modality]?.modelId);
          return modelId && isAllowedRouteModelId(modelKey, modality, modelId)
            ? [modality, { modelId, operation: operationForRoute(modelKey, modality, modelId) }]
            : null;
        })
        .filter(Boolean));
      if (GMI_CLOUD_CHAT_MODEL_SPECS[modelKey] && !normalizedRoutes.text) {
        return null;
      }
      return Object.keys(normalizedRoutes).length ? [modelKey, normalizedRoutes] : null;
    })
    .filter(Boolean));
}

export function buildGmiCloudRuntimeCatalog({
  apiKey = '',
  enabled = false,
  modelMappings = {},
} = {}) {
  const runtimeEnabled = enabled === true && Boolean(normalizeString(apiKey));
  return {
    version: 1,
    provider: 'gmicloud',
    credentialFingerprint: runtimeEnabled
      ? buildGmiCloudCredentialFingerprint(apiKey)
      : '',
    models: runtimeEnabled ? normalizeGmiCloudModelMappings(modelMappings) : {},
  };
}

async function fetchGmiCloudMediaCatalog({
  apiKey,
  fetchImpl,
  endpoint,
  timeoutMs,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();

  try {
    const response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        models: [],
        verified: false,
        warning: `GMICloud media model catalog was unavailable (status ${response.status}); only verified inference models were enabled.`,
      };
    }

    const responseBody = typeof response.json === 'function'
      ? await response.json().catch(() => null)
      : null;
    const models = extractCatalogModels(responseBody);
    if (!Array.isArray(models)) {
      return {
        models: [],
        verified: false,
        warning: 'GMICloud media model catalog was unreadable; only verified inference models were enabled.',
      };
    }
    return { models, verified: true, warning: '' };
  } catch (error) {
    const reason = error?.name === 'AbortError'
      ? 'request timed out'
      : error?.message || String(error);
    return {
      models: [],
      verified: false,
      warning: `GMICloud media model catalog could not be reached (${reason}); only verified inference models were enabled.`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function addCatalogMediaMappings(modelMappings, mediaCatalogModels) {
  for (const spec of GMI_CLOUD_MEDIA_MODEL_SPECS) {
    const catalogModel = mediaCatalogModels.find((model) => (
      model.active && normalizeString(model.id).toLowerCase() === spec.modelId.toLowerCase()
    ));
    if (!catalogModel) continue;
    // Multiple exact upstream versions can implement one Samsar contract.
    // Specs are ordered by preference, so never replace an earlier match.
    if (modelMappings[spec.samsarModel]?.[spec.modality]) continue;
    modelMappings[spec.samsarModel] = {
      ...(modelMappings[spec.samsarModel] || {}),
      [spec.modality]: {
        modelId: catalogModel.id,
        operation: spec.operation || routeOperation(spec.modality),
      },
    };
  }
  return modelMappings;
}

export function createGmiCloudValidationRegistry({
  ttlMs = GMI_CLOUD_PROVIDER_VALIDATION_TTL_MS,
  now = () => Date.now(),
  tokenFactory = () => randomBytes(32).toString('hex'),
} = {}) {
  const validations = new Map();

  function pruneExpired(currentTime = now()) {
    for (const [token, validation] of validations.entries()) {
      if (validation.expiresAt <= currentTime) {
        validations.delete(token);
      }
    }
  }

  return {
    register(apiKey, metadata = {}) {
      pruneExpired();
      const token = normalizeString(tokenFactory());
      if (!token) {
        throw new Error('Unable to create a GMICloud validation token.');
      }
      validations.set(token, {
        fingerprint: buildGmiCloudCredentialFingerprint(apiKey),
        modelMappings: normalizeGmiCloudModelMappings(metadata.modelMappings),
        expiresAt: now() + ttlMs,
      });
      return token;
    },

    consume(token, apiKey) {
      pruneExpired();
      const normalizedToken = normalizeString(token);
      const validation = validations.get(normalizedToken);
      if (!validation) {
        return null;
      }

      validations.delete(normalizedToken);
      const expectedFingerprint = Buffer.from(validation.fingerprint, 'hex');
      const actualFingerprint = Buffer.from(buildGmiCloudCredentialFingerprint(apiKey), 'hex');
      if (
        expectedFingerprint.length !== actualFingerprint.length ||
        !timingSafeEqual(expectedFingerprint, actualFingerprint)
      ) {
        return null;
      }
      return {
        credentialFingerprint: validation.fingerprint,
        modelMappings: normalizeGmiCloudModelMappings(validation.modelMappings),
      };
    },
  };
}

export async function validateGmiCloudProviderCredential(
  credentials = {},
  {
    fetchImpl = globalThis.fetch,
    endpoint = GMI_CLOUD_KEY_VALIDATION_URL,
    mediaEndpoint = GMI_CLOUD_MEDIA_MODELS_URL,
    timeoutMs = DEFAULT_VALIDATION_TIMEOUT_MS,
    mediaCatalogTimeoutMs = timeoutMs,
  } = {},
) {
  const apiKey = normalizeString(
    credentials.gmiCloudApiKey ||
    credentials.gmicloudApiKey ||
    credentials.gmi_api_key ||
    credentials.apiKey,
  );
  if (!apiKey) {
    return { providers: {} };
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('GMICloud credential validation is unavailable in this runtime.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();

  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });
  } catch (error) {
    const reason = error?.name === 'AbortError'
      ? 'request timed out'
      : error?.message || error;
    throw new Error(`Unable to reach GMICloud for credential validation: ${reason}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const authenticationFailure = response.status === 401 || response.status === 403;
    throw new Error(
      authenticationFailure
        ? 'GMICloud rejected the API key.'
        : `GMICloud credential validation failed with status ${response.status}.`,
    );
  }

  let responseBody = null;
  if (typeof response.json === 'function') {
    responseBody = await response.json().catch(() => null);
  }
  const catalogModels = extractCatalogModels(responseBody);
  if (!Array.isArray(catalogModels)) {
    throw new Error('GMICloud accepted the API key but did not return a readable model catalog.');
  }

  const mediaCatalog = await fetchGmiCloudMediaCatalog({
    apiKey,
    fetchImpl,
    endpoint: mediaEndpoint,
    timeoutMs: mediaCatalogTimeoutMs,
  });
  const modelMappings = normalizeGmiCloudModelMappings(addCatalogMediaMappings(
    buildChatModelMappings(catalogModels),
    mediaCatalog.models,
  ));

  return {
    providers: {
      gmicloud: {
        provider: 'gmicloud',
        status: 'valid',
        ok: true,
        validationMode: 'remote_key',
        catalogParsed: true,
        catalogModelCount: catalogModels.length,
        catalogActiveModelCount: catalogModels.filter((model) => model.active).length,
        catalogVerified: true,
        availableModelKeys: Object.keys(modelMappings).sort(),
        modelMappings,
        mediaCatalogVerified: mediaCatalog.verified,
        mediaCatalogWarning: mediaCatalog.warning || null,
        mediaCatalogModelCount: mediaCatalog.models.length,
        mediaCatalogActiveModelCount: mediaCatalog.models.filter((model) => model.active).length,
      },
    },
  };
}
