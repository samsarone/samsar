import fs from 'fs';
import path from 'path';
import {
  isContainerRuntime,
  isStandaloneEdition,
} from '../../utils/EnvironmentUtils.js';
import {
  applyModelAdapterPreferencesToPriorityMap,
  normalizeModelAdapterModelKey,
  normalizeModelAdapterProviderKey,
  readModelAdapterPreferences,
} from './ModelAdapterPreferences.js';

function getDefaultAvailableModelsPath() {
  const configuredPath = process.env.SAMSAR_AVAILABLE_MODELS_FILE ||
    process.env.SAMSAR_AVAILABLE_MODELS_PATH;
  if (configuredPath) return configuredPath;
  if (isContainerRuntime()) {
    return '/persistent/config/available-models.json';
  }
  return path.join(process.cwd(), 'runtime', 'config', 'available-models.json');
}

function normalizeStringList(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : [];
}

function normalizeStringMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, item]) => (
        typeof key === 'string' && key.trim() && typeof item === 'string' && item.trim()
      ))
      .map(([key, item]) => [key.trim(), item.trim()]),
  );
}

function normalizeStringListMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => typeof key === 'string' && key.trim())
      .map(([key, item]) => [key.trim(), normalizeStringList(item)]),
  );
}

function hasEnvCredential(...keys) {
  return keys.some((key) => typeof process.env[key] === 'string' && process.env[key].trim());
}

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function readRuntimeGenBlazeModelMappings(env = process.env) {
  if (!isTruthyEnv(env.SAMSAR_GENBLAZE_ENABLED)) {
    return {};
  }
  const catalogPath = String(env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH || '').trim();
  if (!catalogPath || !fs.existsSync(catalogPath)) {
    return {};
  }
  try {
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    return catalog?.provider === 'gmicloud' &&
      catalog?.models &&
      typeof catalog.models === 'object' &&
      !Array.isArray(catalog.models)
      ? catalog.models
      : {};
  } catch {
    return {};
  }
}

function hasRuntimeGenBlazeRoute(modelMappings, model, modality, operation = 'chat.completions') {
  const modelKey = Object.keys(modelMappings || {}).find(
    (candidate) => normalizeDeploymentModel(candidate) === normalizeDeploymentModel(model),
  );
  const route = modelKey ? modelMappings[modelKey]?.[modality] : null;
  return Boolean(
    route &&
    typeof route.modelId === 'string' &&
    route.modelId.trim() &&
    (!route.operation || route.operation === operation),
  );
}

function hasRuntimeGenBlazeInferenceModel(modelMappings, model) {
  return hasRuntimeGenBlazeRoute(modelMappings, model, 'text') &&
    hasRuntimeGenBlazeRoute(modelMappings, model, 'vision');
}

function hasRuntimeGenBlazeSeedance25Model(modelMappings) {
  const modelKey = Object.keys(modelMappings || {}).find(
    (candidate) => normalizeDeploymentModel(candidate) === 'SEEDANCE2.5I2V',
  );
  const route = modelKey ? modelMappings[modelKey]?.video : null;
  return route?.modelId === 'seedance-2-5-260628' &&
    route?.operation === 'video.generate';
}

function hasRuntimeGenBlazeModel(modelMappings, model, env = process.env) {
  const normalizedModel = normalizeDeploymentModel(model);
  if (['GPT-5.6-SOL', 'GEMINI-3.1-PRO', 'QWEN3.8'].includes(normalizedModel)) {
    return hasRuntimeGenBlazeInferenceModel(modelMappings, normalizedModel);
  }

  const modelKey = Object.keys(modelMappings || {}).find(
    (candidate) => normalizeDeploymentModel(candidate) === normalizedModel,
  );
  const routes = modelKey ? modelMappings[modelKey] : null;
  return Boolean(
    routes &&
    typeof routes === 'object' &&
    Object.values(routes).some((route) => (
      route &&
      typeof route === 'object' &&
      typeof route.modelId === 'string' &&
      route.modelId.trim()
    )),
  );
}

export function hasRuntimeGenBlazeCatalogRoute(
  model,
  modality,
  operation,
  env = process.env,
) {
  return hasRuntimeGenBlazeRoute(
    readRuntimeGenBlazeModelMappings(env),
    model,
    modality,
    operation,
  );
}

function isDockerDeploymentRuntime() {
  return isStandaloneEdition();
}

function normalizeDeploymentProvider(value) {
  const normalized = typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
    : '';

  if (['alibaba', 'alibabacloud', 'dashscope', 'qwen'].includes(normalized)) {
    return 'alibabaCloud';
  }

  if (['openrouter', 'openrouterai'].includes(normalized)) {
    return 'openrouter';
  }

  if (['gmi', 'gmicloud', 'genblaze'].includes(normalized)) {
    return 'gmicloud';
  }

  if (['kimi', 'kimik3', 'moonshot', 'moonshotai'].includes(normalized)) {
    return 'kimi';
  }

  return normalized;
}

function normalizeDeploymentModel(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (['QWEN3.8', 'QWEN3.8-MAX'].includes(normalized)) {
    return 'QWEN3.8';
  }
  if (['KIMIK3', 'KIMI-K3', 'KIMI K3'].includes(normalized)) {
    return 'KIMIK3';
  }
  return normalized;
}

function findModelProvider(modelProviders = {}, modelKey = '') {
  const normalizedModelKey = normalizeDeploymentModel(modelKey);
  const entry = Object.entries(modelProviders).find(
    ([key]) => normalizeDeploymentModel(key) === normalizedModelKey,
  );
  return entry?.[1] || '';
}

function isSavedQwenSelectionAuthorized({ providers, models, modelProviders }) {
  if (!isDockerDeploymentRuntime()) {
    return false;
  }

  const hasQwenModel = models.some((model) => normalizeDeploymentModel(model) === 'QWEN3.8');
  const qwenProviders = new Set(['alibabaCloud', 'samsar', 'gmicloud', 'openrouter']);
  const availableProviders = new Set(providers.map(normalizeDeploymentProvider));
  const selectedProvider = normalizeDeploymentProvider(
    findModelProvider(modelProviders, 'QWEN3.8'),
  );

  return hasQwenModel && availableProviders.has(selectedProvider) && qwenProviders.has(selectedProvider);
}

function filterWan27WithoutConfiguredProvider(models = []) {
  if (!isDockerDeploymentRuntime() || hasEnvCredential(
    'ALIBABA_API_KEY',
    'DASHSCOPE_API_KEY',
    'ALIBABA_CLOUD_API_KEY',
    'QWEN_API_KEY',
    'FAL_API_KEY',
    'SAMSAR_API_KEY',
  )) {
    return models;
  }
  return models.filter(
    (model) => String(model?.value || model?.key || '').toUpperCase() !== 'WAN2.7PRO',
  );
}

function appendUnique(target, values) {
  const seen = new Set(target);
  values.forEach((value) => {
    if (!seen.has(value)) {
      seen.add(value);
      target.push(value);
    }
  });
}

function hasGoogleInferenceCredential() {
  if (hasEnvCredential(
    'GOOGLE_APPLICATION_CREDENTIALS_JSON_B64',
    'GOOGLE_APPLICATION_CREDENTIALS_JSON',
    'GOOGLE_APPLICATION_CREDENTIALS',
  )) {
    return true;
  }
  return hasEnvCredential(
    'GOOGLE_CLOUD_PROJECT',
    'GOOGLE_PROJECT_ID',
    'GCP_PROJECT',
    'GCLOUD_PROJECT',
    'PROJECT_ID',
  ) && hasEnvCredential('K_SERVICE', 'GAE_SERVICE', 'FUNCTION_TARGET', 'GCE_METADATA_HOST');
}

function mergeRuntimeInferenceProviderSelections(availability) {
  const hasOpenRouter = hasEnvCredential('OPENROUTER_API_KEY');
  const hasSamsar = hasEnvCredential('SAMSAR_API_KEY');
  const gmiCloudModelMappings = readRuntimeGenBlazeModelMappings();
  const priorities = {
    'gpt-5.6-sol': ['openai', 'gmicloud', 'samsar', 'openrouter'],
    'gemini-3.1-pro': ['googleCloud', 'gmicloud', 'samsar', 'openrouter'],
    'QWEN3.8': ['alibabaCloud', 'gmicloud', 'samsar', 'openrouter'],
    KIMIK3: ['kimi', 'samsar'],
  };
  const configured = {
    openai: hasEnvCredential('OPENAI_API_KEY'),
    googleCloud: hasGoogleInferenceCredential(),
    alibabaCloud: hasEnvCredential(
      'ALIBABA_API_KEY',
      'DASHSCOPE_API_KEY',
      'ALIBABA_CLOUD_API_KEY',
      'QWEN_API_KEY',
    ),
    openrouter: hasOpenRouter,
    kimi: hasEnvCredential('KIMI_K3_API_KEY'),
    samsar: hasSamsar,
  };

  for (const [model, providerPriority] of Object.entries(priorities)) {
    const configuredPriority = normalizeStringList(
      availability.modelProviderPriority?.[model],
    );
    const configuredDefaultPriority = normalizeStringList(
      availability.defaultModelProviderPriority?.[model],
    );
    // Persisted availability may contain the previous Samsar-before-GMICloud
    // default. Rebase GMICloud-capable inference models onto the current
    // hierarchy; the separate user preference file is applied afterwards and
    // can still override it intentionally.
    const useCanonicalPriority = providerPriority.includes('gmicloud');
    const effectivePriority = useCanonicalPriority
      ? [
        ...providerPriority,
        ...configuredPriority.filter((provider) => !providerPriority.includes(provider)),
      ]
      : [
        ...configuredPriority,
        ...providerPriority.filter((provider) => !configuredPriority.includes(provider)),
      ];
    const defaultPriority = useCanonicalPriority
      ? [
        ...providerPriority,
        ...configuredDefaultPriority.filter((provider) => !providerPriority.includes(provider)),
      ]
      : [
        ...configuredDefaultPriority,
        ...providerPriority.filter((provider) => !configuredDefaultPriority.includes(provider)),
      ];
    availability.defaultModelProviderPriority[model] = defaultPriority;
    const provider = effectivePriority.find((candidate) => (
      candidate === 'gmicloud'
        ? hasRuntimeGenBlazeInferenceModel(gmiCloudModelMappings, model)
        : configured[candidate]
    ));
    if (!provider) continue;
    availability.modelProviders[model] = provider;
    availability.modelProviderPriority[model] = effectivePriority;
  }
}

function mergeRuntimeSeedance25ProviderSelection(availability, modelMappings) {
  const model = 'SEEDANCE2.5I2V';
  const configured = {
    gmicloud: hasRuntimeGenBlazeSeedance25Model(modelMappings),
    samsar: hasEnvCredential('SAMSAR_API_KEY'),
    fal: hasEnvCredential('FAL_API_KEY'),
  };
  const canonicalPriority = ['gmicloud', 'samsar', 'fal'];
  const availablePriority = canonicalPriority.filter((provider) => configured[provider]);
  if (availablePriority.length === 0) return;

  appendUnique(availability.providers, availablePriority);
  appendUnique(availability.models, [model]);
  appendUnique(availability.actions, ['video']);
  availability.defaultModelProviderPriority[model] = [...canonicalPriority];
  availability.modelProviderPriority[model] = [...canonicalPriority];
  availability.modelProviders[model] = availablePriority[0];
}

function applyStandaloneModelAdapterPreferences(availability = {}) {
  if (!isStandaloneEdition()) {
    return availability;
  }

  const preferences = readModelAdapterPreferences();
  const defaultPriorityMap = availability.defaultModelProviderPriority ||
    availability.modelProviderPriority ||
    {};
  const reorderedDefaultPriorityMap = applyModelAdapterPreferencesToPriorityMap(
    defaultPriorityMap,
    preferences.modelProviderPriority,
  );
  const effectivePriorityMap = applyModelAdapterPreferencesToPriorityMap(
    availability.modelProviderPriority || {},
    {},
  );
  const configuredProviders = new Set(
    normalizeStringList(availability.providers)
      .map(normalizeModelAdapterProviderKey)
      .filter(Boolean),
  );
  const modelProviders = {
    ...(availability.modelProviders || {}),
  };
  const preferenceModelKeys = new Set(
    Object.keys(preferences.modelProviderPriority || {})
      .map(normalizeModelAdapterModelKey),
  );

  for (const rawPreferenceModelKey of preferenceModelKeys) {
    const matchingDefaultKey = Object.keys(reorderedDefaultPriorityMap).find(
      (candidate) => normalizeModelAdapterModelKey(candidate) === rawPreferenceModelKey,
    );
    if (!matchingDefaultKey) {
      continue;
    }
    const matchingEffectiveKey = Object.keys(effectivePriorityMap).find(
      (candidate) => normalizeModelAdapterModelKey(candidate) === rawPreferenceModelKey,
    ) || matchingDefaultKey;
    effectivePriorityMap[matchingEffectiveKey] =
      reorderedDefaultPriorityMap[matchingDefaultKey];
  }

  for (const [rawModelKey, priority] of Object.entries(effectivePriorityMap)) {
    const modelKey = normalizeModelAdapterModelKey(rawModelKey);
    if (!preferenceModelKeys.has(modelKey)) {
      continue;
    }
    const provider = priority.find((candidate) => configuredProviders.has(candidate));
    if (provider) {
      const matchingModelKey = Object.keys(modelProviders).find(
        (candidate) => normalizeModelAdapterModelKey(candidate) === modelKey,
      ) || rawModelKey;
      modelProviders[matchingModelKey] = provider;
    }
  }

  return {
    ...availability,
    modelProviders,
    modelProviderPriority: effectivePriorityMap,
    defaultModelProviderPriority: normalizeStringListMap(defaultPriorityMap),
    modelAdapterPreferencesUpdatedAt: preferences.updatedAt,
  };
}

export function mergeRuntimeInferenceDeploymentAvailability(value = {}) {
  const gmiCloudModelMappings = readRuntimeGenBlazeModelMappings();
  const configuredProviders = normalizeStringList(value?.providers);
  const configuredModels = [...new Set(
    normalizeStringList(value?.models).map((model) => (
      normalizeDeploymentModel(model) === 'QWEN3.8' ? 'QWEN3.8' : model
    )),
  )];
  const modelProviders = Object.fromEntries(
    Object.entries(normalizeStringMap(value?.modelProviders)).map(([model, provider]) => [
      normalizeDeploymentModel(model) === 'QWEN3.8' ? 'QWEN3.8' : model,
      provider,
    ]),
  );
  const modelProviderPriority = Object.fromEntries(
    Object.entries(normalizeStringListMap(value?.modelProviderPriority)).map(([model, providers]) => [
      normalizeDeploymentModel(model) === 'QWEN3.8' ? 'QWEN3.8' : model,
      providers,
    ]),
  );
  const defaultModelProviderPriority = Object.fromEntries(
    Object.entries(normalizeStringListMap(
      value?.defaultModelProviderPriority || value?.modelProviderPriority,
    )).map(([model, providers]) => [
      normalizeDeploymentModel(model) === 'QWEN3.8' ? 'QWEN3.8' : model,
      providers,
    ]),
  );
  const providerKeyTypes = normalizeStringMap(value?.providerKeyTypes);
  const providerEndpointTypes = normalizeStringMap(value?.providerEndpointTypes);
  const qwenAuthorized = isSavedQwenSelectionAuthorized({
    providers: configuredProviders,
    models: configuredModels,
    modelProviders,
  });
  const configuredProviderSet = new Set(
    configuredProviders.map(normalizeDeploymentProvider).filter(Boolean),
  );
  const findSavedModelPriority = (model) => {
    const normalizedModel = normalizeDeploymentModel(model);
    const entry = Object.entries(modelProviderPriority).find(
      ([candidate]) => normalizeDeploymentModel(candidate) === normalizedModel,
    );
    return entry || null;
  };
  const hasAuthorizedSavedModel = (model) => {
    const normalizedModel = normalizeDeploymentModel(model);
    const selectedProvider = normalizeDeploymentProvider(
      findModelProvider(modelProviders, normalizedModel),
    );
    if (selectedProvider !== 'gmicloud') return true;
    if (hasRuntimeGenBlazeModel(gmiCloudModelMappings, normalizedModel)) {
      return true;
    }

    // A stale or credential-scoped GMICloud catalog must not remove a model
    // supplied by another enabled adapter. Continue through the configured
    // per-model priority and promote the first compatible fallback instead.
    const priorityEntry = findSavedModelPriority(normalizedModel);
    const fallbackProvider = normalizeStringList(priorityEntry?.[1])
      .map(normalizeDeploymentProvider)
      .find((provider) => provider !== 'gmicloud' && configuredProviderSet.has(provider));
    if (!fallbackProvider) {
      return false;
    }

    const modelProviderKey = Object.keys(modelProviders).find(
      (candidate) => normalizeDeploymentModel(candidate) === normalizedModel,
    ) || model;
    modelProviders[modelProviderKey] = fallbackProvider;
    if (priorityEntry) {
      modelProviderPriority[priorityEntry[0]] = priorityEntry[1].filter(
        (provider) => normalizeDeploymentProvider(provider) !== 'gmicloud',
      );
    }
    const defaultPriorityEntry = Object.entries(defaultModelProviderPriority).find(
      ([candidate]) => normalizeDeploymentModel(candidate) === normalizedModel,
    );
    if (defaultPriorityEntry) {
      defaultModelProviderPriority[defaultPriorityEntry[0]] =
        defaultPriorityEntry[1].filter(
          (provider) => normalizeDeploymentProvider(provider) !== 'gmicloud',
        );
    }
    return true;
  };
  const merged = {
    providers: configuredProviders,
    models: configuredModels.filter(
      (model) => (
        (normalizeDeploymentModel(model) !== 'QWEN3.8' || qwenAuthorized) &&
        hasAuthorizedSavedModel(model)
      ),
    ),
    actions: normalizeStringList(value?.actions),
    modelProviders,
    modelProviderPriority,
    defaultModelProviderPriority,
    providerKeyTypes,
    providerEndpointTypes,
    audio: value?.audio || null,
  };

  if (hasEnvCredential('ALIBABA_API_KEY', 'DASHSCOPE_API_KEY', 'ALIBABA_CLOUD_API_KEY', 'QWEN_API_KEY')) {
    appendUnique(merged.providers, ['alibabaCloud']);
    appendUnique(merged.models, ['QWEN3.8', 'HAPPYHORSEI2V', 'WAN2.7PRO']);
    appendUnique(merged.actions, ['chat', 'assistant', 'image', 'video']);
    const keyType = String(process.env.ALIBABA_API_KEY_TYPE || '').trim();
    const endpointType = String(process.env.ALIBABA_API_ENDPOINT_TYPE || '').trim();
    if (keyType) merged.providerKeyTypes.alibabaCloud = keyType;
    if (endpointType) merged.providerEndpointTypes.alibabaCloud = endpointType;
  }

  if (hasEnvCredential('OPENAI_API_KEY')) {
    appendUnique(merged.providers, ['openai']);
    appendUnique(merged.models, ['gpt-5.6-sol']);
    appendUnique(merged.actions, ['chat', 'assistant']);
  }

  if (hasGoogleInferenceCredential()) {
    appendUnique(merged.providers, ['googleCloud']);
    appendUnique(merged.models, ['gemini-3.1-pro']);
    appendUnique(merged.actions, ['chat', 'assistant']);
  }

  if (hasEnvCredential('KIMI_K3_API_KEY')) {
    appendUnique(merged.providers, ['kimi']);
    appendUnique(merged.models, ['KIMIK3']);
    appendUnique(merged.actions, ['chat', 'assistant']);
  }

  if (hasEnvCredential('FAL_API_KEY')) {
    appendUnique(merged.providers, ['fal']);
    appendUnique(merged.models, ['WAN2.7PRO', 'HAPPYHORSEI2V', 'SEEDANCE2.0I2V', 'SEEDANCE2.5I2V']);
    appendUnique(merged.actions, ['image', 'video']);
  }

  if (hasEnvCredential('SAMSAR_API_KEY')) {
    appendUnique(merged.providers, ['samsar']);
    appendUnique(merged.models, ['gpt-5.6-sol', 'gemini-3.1-pro', 'QWEN3.8', 'KIMIK3', 'HAPPYHORSEI2V', 'WAN2.7PRO']);
    appendUnique(merged.actions, ['chat', 'assistant', 'image', 'video']);
  }

  const runtimeGenBlazeInferenceModels = [
    'gpt-5.6-sol',
    'gemini-3.1-pro',
    'QWEN3.8',
  ].filter((model) => hasRuntimeGenBlazeInferenceModel(gmiCloudModelMappings, model));
  if (runtimeGenBlazeInferenceModels.length > 0) {
    appendUnique(merged.providers, ['gmicloud']);
    appendUnique(merged.models, runtimeGenBlazeInferenceModels);
    appendUnique(merged.actions, ['chat', 'assistant']);
  }

  if (hasEnvCredential('OPENROUTER_API_KEY')) {
    appendUnique(merged.providers, ['openrouter']);
    appendUnique(merged.models, ['gpt-5.6-sol', 'gemini-3.1-pro', 'QWEN3.8']);
    appendUnique(merged.actions, ['chat', 'assistant']);
  }

  mergeRuntimeSeedance25ProviderSelection(merged, gmiCloudModelMappings);

  for (const [model, provider] of Object.entries(merged.modelProviders)) {
    if (normalizeDeploymentProvider(provider) !== 'gmicloud') {
      continue;
    }
    const normalizedModel = normalizeDeploymentModel(model);
    const hasAuthorizedGmiCloudRoute = hasRuntimeGenBlazeModel(
      gmiCloudModelMappings,
      normalizedModel,
    );
    if (!hasAuthorizedGmiCloudRoute) {
      delete merged.modelProviders[model];
    }
  }
  const inferenceModels = new Set([
    normalizeDeploymentModel('gpt-5.6-sol'),
    normalizeDeploymentModel('gemini-3.1-pro'),
    normalizeDeploymentModel('QWEN3.8'),
    normalizeDeploymentModel('KIMIK3'),
  ]);
  if (!merged.models.some((model) => inferenceModels.has(normalizeDeploymentModel(model)))) {
    merged.actions = merged.actions.filter(
      (action) => action !== 'chat' && action !== 'assistant',
    );
  }

  mergeRuntimeInferenceProviderSelections(merged);

  return applyStandaloneModelAdapterPreferences(merged);
}

function normalizeDeploymentAudioAvailability(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      providers: [],
      ttsProviders: [],
      musicProviders: [],
      soundEffectProviders: [],
      allowAllTtsSpeakers: false,
      allowAllMusicProviders: false,
      source: null,
    };
  }

  return {
    providers: normalizeStringList(value.providers),
    ttsProviders: normalizeStringList(value.ttsProviders),
    musicProviders: normalizeStringList(value.musicProviders),
    soundEffectProviders: normalizeStringList(value.soundEffectProviders),
    allowAllTtsSpeakers: value.allowAllTtsSpeakers === true,
    allowAllMusicProviders: value.allowAllMusicProviders === true,
    source: typeof value.source === 'string' && value.source.trim() ? value.source.trim() : null,
  };
}

export function readDeploymentAvailableModels() {
  const filePath = process.env.SAMSAR_AVAILABLE_MODELS_PATH || getDefaultAvailableModelsPath();
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const models = normalizeStringList(parsed?.models);
    const actions = normalizeStringList(parsed?.actions);
    const providers = normalizeStringList(parsed?.providers);
    const modelProviders = normalizeStringMap(parsed?.modelProviders);
    const modelProviderPriority = normalizeStringListMap(parsed?.modelProviderPriority);
    const providerKeyTypes = normalizeStringMap(parsed?.providerKeyTypes);
    const providerEndpointTypes = normalizeStringMap(parsed?.providerEndpointTypes);
    const audio = normalizeDeploymentAudioAvailability(parsed?.audio);

    return applyStandaloneModelAdapterPreferences({
      providers,
      models,
      actions,
      modelProviders,
      modelProviderPriority,
      defaultModelProviderPriority: modelProviderPriority,
      providerKeyTypes,
      providerEndpointTypes,
      audio,
      filePath,
    });
  } catch (error) {
    console.error('[deployment_model_config] failed to read available models file', {
      filePath,
      message: error?.message || error,
    });
    return null;
  }
}

export function filterModelsForDeploymentAvailability(models = [], availableModelConfig = readDeploymentAvailableModels()) {
  if (!availableModelConfig || !Array.isArray(availableModelConfig.models)) {
    return filterWan27WithoutConfiguredProvider(models);
  }

  const runtimeAvailability = mergeRuntimeInferenceDeploymentAvailability(availableModelConfig);
  if (runtimeAvailability.models.length === 0) {
    return filterWan27WithoutConfiguredProvider(models);
  }
  const available = new Set(runtimeAvailability.models.map(normalizeDeploymentModel));
  return filterWan27WithoutConfiguredProvider(
    models.filter(
      (model) => available.has(normalizeDeploymentModel(model?.value || model?.key)),
    ),
  );
}
