import fs from 'node:fs';
import path from 'node:path';

import {
  isContainerRuntime,
  isStandaloneEdition,
} from '../../utils/EnvironmentUtils.js';

export const MODEL_ADAPTER_STAGE = Object.freeze({
  INFERENCE: 'inference',
  TEXT_TO_IMAGE: 'text_to_image',
  IMAGE_TO_VIDEO: 'image_to_video',
});

export const MODEL_ADAPTER_STAGE_DEFINITIONS = Object.freeze([
  Object.freeze({
    key: MODEL_ADAPTER_STAGE.INFERENCE,
    label: 'Inference',
    modelKeys: Object.freeze([
      'gpt-5.6-sol',
      'gemini-3.1-pro',
      'KIMIK3',
      'QWEN3.8',
    ]),
  }),
  Object.freeze({
    key: MODEL_ADAPTER_STAGE.TEXT_TO_IMAGE,
    label: 'Text to image',
    modelKeys: Object.freeze([
      'GPTIMAGE2',
      'SEEDREAM',
      'NANOBANANA2',
      'NANOBANANAPRO',
      'WAN2.7PRO',
    ]),
  }),
  Object.freeze({
    key: MODEL_ADAPTER_STAGE.IMAGE_TO_VIDEO,
    label: 'Image to video',
    modelKeys: Object.freeze([
      'RUNWAYML',
      'VEO3.1I2V',
      'VEO3.1I2VFAST',
      'COSMOS3SUPERI2V',
      'SEEDANCEI2V',
      'SEEDANCE2.0I2V',
      'SEEDANCE2.5I2V',
      'KLINGIMGTOVID3PRO',
      'KLINGIMGTOVIDTURBO',
      'HAPPYHORSEI2V',
    ]),
  }),
]);

const MODEL_LABELS = Object.freeze({
  'gpt-5.6-sol': 'GPT 5.6 Sol',
  'gemini-3.1-pro': 'Gemini 3.1 Pro',
  KIMIK3: 'Kimi K3',
  'QWEN3.8': 'Qwen 3.8 Max',
  GPTIMAGE2: 'GPT Image 2',
  SEEDREAM: 'Seedream',
  NANOBANANA2: 'Nano Banana 2',
  NANOBANANAPRO: 'Nano Banana Pro',
  'WAN2.7PRO': 'Wan 2.7 Pro',
  RUNWAYML: 'RunwayML',
  'VEO3.1I2V': 'Veo 3.1 Image to Video',
  'VEO3.1I2VFAST': 'Veo 3.1 Fast Image to Video',
  COSMOS3SUPERI2V: 'Cosmos 3 Super Image to Video',
  SEEDANCEI2V: 'Seedance Image to Video',
  'SEEDANCE2.0I2V': 'Seedance 2.0 Image to Video',
  'SEEDANCE2.5I2V': 'Seedance 2.5 Image to Video',
  KLINGIMGTOVID3PRO: 'Kling 3 Pro Image to Video',
  KLINGIMGTOVIDTURBO: 'Kling Turbo Image to Video',
  HAPPYHORSEI2V: 'Happy Horse Image to Video',
});

const PROVIDER_LABELS = Object.freeze({
  alibabaCloud: 'Alibaba Cloud',
  googleCloud: 'Google Cloud',
  kimi: 'Kimi',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  gmicloud: 'GMICloud via GenBlaze',
  fal: 'FAL',
  runway: 'RunwayML',
  samsar: 'Samsar',
});

const PROVIDER_ALIASES = Object.freeze({
  alibaba: 'alibabaCloud',
  alibabacloud: 'alibabaCloud',
  aliyun: 'alibabaCloud',
  dashscope: 'alibabaCloud',
  qwen: 'alibabaCloud',
  google: 'googleCloud',
  googlecloud: 'googleCloud',
  gcp: 'googleCloud',
  genblaze: 'gmicloud',
  gmi: 'gmicloud',
  gmicloud: 'gmicloud',
  kimi: 'kimi',
  moonshot: 'kimi',
  moonshotai: 'kimi',
  openai: 'openai',
  openrouter: 'openrouter',
  openrouterai: 'openrouter',
  fal: 'fal',
  runway: 'runway',
  runwayml: 'runway',
  samsar: 'samsar',
});

const MODEL_KEY_LOOKUP = new Map(
  MODEL_ADAPTER_STAGE_DEFINITIONS
    .flatMap((stage) => stage.modelKeys)
    .map((modelKey) => [normalizeModelToken(modelKey), modelKey]),
);

const KIMI_MODEL_TOKENS = new Set([
  'KIMIK3',
  'KIMI3',
  'MOONSHOTK3',
  'MOONSHOTKIMIK3',
]);

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeModelToken(value) {
  return normalizeString(value).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

export function normalizeModelAdapterModelKey(value) {
  const token = normalizeModelToken(value);
  if (KIMI_MODEL_TOKENS.has(token)) {
    return 'KIMIK3';
  }
  return MODEL_KEY_LOOKUP.get(token) || normalizeString(value);
}

export function normalizeModelAdapterProviderKey(value) {
  const normalized = normalizeString(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  return PROVIDER_ALIASES[normalized] || '';
}

function uniqueNormalizedProviders(value) {
  const source = Array.isArray(value) ? value : [];
  return [...new Set(source.map(normalizeModelAdapterProviderKey).filter(Boolean))];
}

function normalizePriorityMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([modelKey, providers]) => [
        normalizeModelAdapterModelKey(modelKey),
        uniqueNormalizedProviders(providers),
      ])
      .filter(([modelKey, providers]) => Boolean(modelKey) && providers.length > 0),
  );
}

export function getModelAdapterPreferencesPath(env = process.env) {
  const configuredPath = normalizeString(env?.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH);
  if (configuredPath) {
    return configuredPath;
  }
  if (isContainerRuntime(env)) {
    return '/persistent/config/model-adapter-preferences.json';
  }
  return path.join(process.cwd(), 'runtime', 'config', 'model-adapter-preferences.json');
}

export function readModelAdapterPreferences({
  env = process.env,
  filePath = getModelAdapterPreferencesPath(env),
} = {}) {
  if (!isStandaloneEdition(env) || !fs.existsSync(filePath)) {
    return {
      modelProviderPriority: {},
      updatedAt: null,
      filePath,
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      modelProviderPriority: normalizePriorityMap(
        parsed?.modelProviderPriority || parsed?.model_provider_priority,
      ),
      updatedAt: normalizeString(parsed?.updatedAt) || null,
      filePath,
    };
  } catch (error) {
    console.error('[model_adapter_preferences] failed to read preference file', {
      filePath,
      message: error?.message || error,
    });
    return {
      modelProviderPriority: {},
      updatedAt: null,
      filePath,
    };
  }
}

export function applyModelAdapterPreferenceOrder(
  defaultPriority = [],
  savedPriority = [],
) {
  const normalizedDefault = uniqueNormalizedProviders(defaultPriority);
  const allowedProviders = new Set(normalizedDefault);
  const preferredProviders = uniqueNormalizedProviders(savedPriority)
    .filter((provider) => allowedProviders.has(provider));

  return [
    ...preferredProviders,
    ...normalizedDefault.filter((provider) => !preferredProviders.includes(provider)),
  ];
}

export function applyModelAdapterPreferencesToPriorityMap(
  defaultPriorityMap = {},
  preferenceMap = {},
) {
  const normalizedDefaults = normalizePriorityMap(defaultPriorityMap);
  const normalizedPreferences = normalizePriorityMap(preferenceMap);

  return Object.fromEntries(
    Object.entries(normalizedDefaults).map(([modelKey, defaultPriority]) => [
      modelKey,
      applyModelAdapterPreferenceOrder(
        defaultPriority,
        normalizedPreferences[normalizeModelAdapterModelKey(modelKey)] || [],
      ),
    ]),
  );
}

function getConfiguredProviderOrder(availability = {}, priority = []) {
  const configuredProviders = new Set(
    uniqueNormalizedProviders(availability?.providers),
  );
  return uniqueNormalizedProviders(priority)
    .filter((provider) => configuredProviders.has(provider));
}

export function buildModelAdapterSettings(
  availability = {},
  preferences = readModelAdapterPreferences(),
) {
  const availableModels = new Set(
    (Array.isArray(availability?.models) ? availability.models : [])
      .map(normalizeModelAdapterModelKey)
      .filter(Boolean),
  );
  const defaultPriorityMap = normalizePriorityMap(
    availability?.defaultModelProviderPriority ||
      availability?.modelProviderPriority,
  );
  const preferenceMap = normalizePriorityMap(preferences?.modelProviderPriority);
  const effectivePriorityMap = applyModelAdapterPreferencesToPriorityMap(
    defaultPriorityMap,
    preferenceMap,
  );

  const stages = MODEL_ADAPTER_STAGE_DEFINITIONS.map((stage) => {
    const models = stage.modelKeys
      .filter((modelKey) => availableModels.has(modelKey))
      .map((modelKey) => {
        const defaultPreference = getConfiguredProviderOrder(
          availability,
          defaultPriorityMap[modelKey] || [],
        );
        const preference = getConfiguredProviderOrder(
          availability,
          effectivePriorityMap[modelKey] || defaultPriorityMap[modelKey] || [],
        );
        return {
          modelKey,
          label: MODEL_LABELS[modelKey] || modelKey,
          availableAdapters: preference.map((provider) => ({
            key: provider,
            label: PROVIDER_LABELS[provider] || provider,
          })),
          preference,
          defaultPreference,
        };
      })
      .filter((model) => model.availableAdapters.length > 0);

    return {
      key: stage.key,
      label: stage.label,
      models,
    };
  });

  return {
    stages,
    updatedAt: preferences?.updatedAt || null,
  };
}

function arraysEqual(left = [], right = []) {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

export function validateModelAdapterPreferenceUpdate(
  requestedPriorityMap,
  availability,
  preferences = readModelAdapterPreferences(),
) {
  if (
    !requestedPriorityMap ||
    typeof requestedPriorityMap !== 'object' ||
    Array.isArray(requestedPriorityMap)
  ) {
    const error = new Error('modelProviderPriority must be an object.');
    error.status = 400;
    throw error;
  }

  const settings = buildModelAdapterSettings(availability, preferences);
  const modelLookup = new Map(
    settings.stages
      .flatMap((stage) => stage.models)
      .map((model) => [model.modelKey, model]),
  );
  const validated = {};

  for (const [rawModelKey, rawPriority] of Object.entries(requestedPriorityMap)) {
    const modelKey = normalizeModelAdapterModelKey(rawModelKey);
    const model = modelLookup.get(modelKey);
    if (!model) {
      const error = new Error(`Model ${rawModelKey} is not configurable for this installation.`);
      error.status = 400;
      throw error;
    }

    const requestedPriority = uniqueNormalizedProviders(rawPriority);
    const availableProviderKeys = model.availableAdapters.map((adapter) => adapter.key);
    if (
      requestedPriority.length !== availableProviderKeys.length ||
      requestedPriority.some((provider) => !availableProviderKeys.includes(provider))
    ) {
      const error = new Error(
        `Adapter preference for ${modelKey} must contain every available adapter exactly once.`,
      );
      error.status = 400;
      throw error;
    }
    validated[modelKey] = requestedPriority;
  }

  return {
    validated,
    settings,
  };
}

export function writeModelAdapterPreferences(
  requestedPriorityMap,
  availability,
  {
    env = process.env,
    filePath = getModelAdapterPreferencesPath(env),
    now = new Date(),
  } = {},
) {
  if (!isStandaloneEdition(env)) {
    const error = new Error('Model adapter preferences are available only in standalone installations.');
    error.status = 404;
    throw error;
  }

  const current = readModelAdapterPreferences({ env, filePath });
  const { validated, settings } = validateModelAdapterPreferenceUpdate(
    requestedPriorityMap,
    availability,
    current,
  );
  const modelLookup = new Map(
    settings.stages
      .flatMap((stage) => stage.models)
      .map((model) => [model.modelKey, model]),
  );
  const nextPriorityMap = Object.fromEntries(
    Object.entries(current.modelProviderPriority || {})
      .filter(([modelKey]) => modelLookup.has(modelKey)),
  );

  for (const [modelKey, priority] of Object.entries(validated)) {
    const model = modelLookup.get(modelKey);
    if (arraysEqual(priority, model?.defaultPreference || [])) {
      delete nextPriorityMap[modelKey];
    } else {
      nextPriorityMap[modelKey] = priority;
    }
  }

  const updatedAt = now.toISOString();
  const payload = {
    version: 1,
    updatedAt,
    modelProviderPriority: nextPriorityMap,
  };

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, {
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) {
      fs.unlinkSync(temporaryPath);
    }
  }

  const savedPreferences = {
    modelProviderPriority: nextPriorityMap,
    updatedAt,
    filePath,
  };
  return {
    preferences: savedPreferences,
    settings: buildModelAdapterSettings(availability, savedPreferences),
  };
}
