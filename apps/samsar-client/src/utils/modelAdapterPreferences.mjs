export const MODEL_ADAPTERS_ACCOUNT_PANEL_KEY = "model-adapters";

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const result = [];

  for (const value of Array.isArray(values) ? values : []) {
    const normalizedValue = normalizeString(value);
    if (!normalizedValue || seen.has(normalizedValue)) {
      continue;
    }
    seen.add(normalizedValue);
    result.push(normalizedValue);
  }

  return result;
}

export function canManageModelAdapters({
  isStandaloneDeployment = false,
  isAdminUser = false,
} = {}) {
  return isStandaloneDeployment === true && isAdminUser === true;
}

export function isModelAdaptersAccountPath(pathname) {
  const segments = normalizeString(pathname).split("/").filter(Boolean);
  return (
    segments[0] === "account" &&
    segments[1] === MODEL_ADAPTERS_ACCOUNT_PANEL_KEY &&
    segments.length === 2
  );
}

export function isLegacyModelAdaptersSettingsPath(pathname) {
  const segments = normalizeString(pathname).split("/").filter(Boolean);
  return (
    segments[0] === "account" &&
    segments[1] === "settings" &&
    segments[2] === MODEL_ADAPTERS_ACCOUNT_PANEL_KEY &&
    segments.length === 3
  );
}

export function normalizeAvailableAdapters(adapters = []) {
  const seen = new Set();
  const result = [];

  for (const adapter of Array.isArray(adapters) ? adapters : []) {
    const source =
      typeof adapter === "string"
        ? { key: adapter, label: adapter }
        : adapter && typeof adapter === "object"
          ? adapter
          : {};
    const key = normalizeString(source.key);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({
      key,
      label: normalizeString(source.label) || key,
    });
  }

  return result;
}

export function normalizeAdapterPreference(
  preference,
  availableAdapters,
  fallbackPreference = [],
) {
  const availableKeys = normalizeAvailableAdapters(availableAdapters).map(
    (adapter) => adapter.key,
  );
  const availableKeySet = new Set(availableKeys);
  const result = [];
  const seen = new Set();

  const appendAvailableKeys = (values) => {
    for (const key of uniqueStrings(values)) {
      if (!availableKeySet.has(key) || seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(key);
    }
  };

  appendAvailableKeys(preference);
  appendAvailableKeys(fallbackPreference);
  appendAvailableKeys(availableKeys);

  return result;
}

function normalizeModel(model) {
  const source = model && typeof model === "object" ? model : {};
  const modelKey = normalizeString(source.modelKey);
  if (!modelKey) {
    return null;
  }

  const availableAdapters = normalizeAvailableAdapters(source.availableAdapters);
  const defaultPreference = normalizeAdapterPreference(
    source.defaultPreference,
    availableAdapters,
  );
  const preference = normalizeAdapterPreference(
    source.preference,
    availableAdapters,
    defaultPreference,
  );

  return {
    modelKey,
    label: normalizeString(source.label) || modelKey,
    availableAdapters,
    preference,
    defaultPreference,
  };
}

function normalizeStage(stage, stageIndex) {
  const source = stage && typeof stage === "object" ? stage : {};
  const key = normalizeString(source.key) || `stage_${stageIndex + 1}`;
  const seenModels = new Set();
  const models = [];

  for (const model of Array.isArray(source.models) ? source.models : []) {
    const normalizedModel = normalizeModel(model);
    if (!normalizedModel || seenModels.has(normalizedModel.modelKey)) {
      continue;
    }
    seenModels.add(normalizedModel.modelKey);
    models.push(normalizedModel);
  }

  return {
    key,
    label: normalizeString(source.label) || key,
    models,
  };
}

export function normalizeModelAdapterResponse(payload = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  const stages = (Array.isArray(source.stages) ? source.stages : []).map(
    normalizeStage,
  );

  return {
    stages,
    updatedAt: normalizeString(source.updatedAt) || null,
  };
}

export function reorderAdapterPreference(
  preference,
  sourceIndex,
  destinationIndex,
) {
  const result = uniqueStrings(preference);
  if (
    !Number.isInteger(sourceIndex) ||
    !Number.isInteger(destinationIndex) ||
    sourceIndex < 0 ||
    destinationIndex < 0 ||
    sourceIndex >= result.length ||
    destinationIndex >= result.length ||
    sourceIndex === destinationIndex
  ) {
    return result;
  }

  const [movedAdapter] = result.splice(sourceIndex, 1);
  result.splice(destinationIndex, 0, movedAdapter);
  return result;
}

export function updateModelAdapterPreference(
  stages,
  modelKey,
  preference,
) {
  const normalizedModelKey = normalizeString(modelKey);
  if (!normalizedModelKey) {
    return Array.isArray(stages) ? stages : [];
  }

  return (Array.isArray(stages) ? stages : []).map((stage) => ({
    ...stage,
    models: (Array.isArray(stage.models) ? stage.models : []).map((model) => (
      model.modelKey === normalizedModelKey
        ? {
            ...model,
            preference: normalizeAdapterPreference(
              preference,
              model.availableAdapters,
              model.defaultPreference,
            ),
          }
        : model
    )),
  }));
}

export function resetModelAdapterPreferences(stages) {
  return (Array.isArray(stages) ? stages : []).map((stage) => ({
    ...stage,
    models: (Array.isArray(stage.models) ? stage.models : []).map((model) => ({
      ...model,
      preference: normalizeAdapterPreference(
        model.defaultPreference,
        model.availableAdapters,
      ),
    })),
  }));
}

export function buildModelProviderPriority(stages) {
  const result = {};

  for (const stage of Array.isArray(stages) ? stages : []) {
    for (const model of Array.isArray(stage.models) ? stage.models : []) {
      const modelKey = normalizeString(model.modelKey);
      if (!modelKey) {
        continue;
      }
      result[modelKey] = normalizeAdapterPreference(
        model.preference,
        model.availableAdapters,
        model.defaultPreference,
      );
    }
  }

  return result;
}

export function areModelAdapterPreferencesEqual(leftStages, rightStages) {
  const left = buildModelProviderPriority(leftStages);
  const right = buildModelProviderPriority(rightStages);
  const modelKeys = [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .sort();

  return modelKeys.every((modelKey) => {
    const leftPreference = left[modelKey] || [];
    const rightPreference = right[modelKey] || [];
    return (
      leftPreference.length === rightPreference.length &&
      leftPreference.every(
        (adapterKey, index) => adapterKey === rightPreference[index],
      )
    );
  });
}

export function countModelAdapterModels(stages) {
  return (Array.isArray(stages) ? stages : []).reduce(
    (total, stage) => total + (
      Array.isArray(stage.models) ? stage.models.length : 0
    ),
    0,
  );
}
