import {
  inferGPT56SolEffortFromModelValue,
  normalizeDeploymentInferenceModelValue,
} from './deploymentInferencePolicy.mjs';

const MODEL_KEYS = [
  'expressGenerationInferenceModel',
  'inferenceModel',
  'inference_model',
  'selectedInferenceModel',
];
const EFFORT_KEYS = [
  'expressGenerationInferenceEffort',
  'inferenceEffort',
  'inference_effort',
  'effort',
  'reasoning_effort',
  'reasoningEffort',
  'selectedInferenceEffort',
];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function settingRecords(session, seen = new Set()) {
  if (!isRecord(session) || seen.has(session)) return [];
  seen.add(session);
  return [
    ...settingRecords(session.session, seen),
    session,
    session.expressStepGeneration,
    session.expressGenerationBuilder,
    session.metadata,
    session.input,
  ].filter(isRecord);
}

function firstModel(records) {
  return records.flatMap(record => MODEL_KEYS.map(key => record[key]))
    .find(value => typeof value === 'string' && value.trim())?.trim() || '';
}

function firstEffort(records) {
  return records.flatMap(record => [
    ...EFFORT_KEYS.map(key => record[key]),
    record.reasoning?.effort,
  ]).find(value => value === 'high' || value === 'xhigh') || '';
}

// Post-processing continues the saved session's inference settings. Account
// settings are a compatibility fallback only when old sessions omit them.
export function resolveSessionInferenceSettings(session, fallback = {}) {
  const records = settingRecords(session);
  const fallbackRecords = settingRecords(fallback);
  const sourceModel = firstModel(records);
  const rawModel = sourceModel || firstModel(fallbackRecords);
  const inferenceModel = normalizeDeploymentInferenceModelValue(rawModel) || rawModel;
  const inferenceEffort = firstEffort(records)
    || inferGPT56SolEffortFromModelValue(sourceModel)
    || (sourceModel ? 'high' : firstEffort(fallbackRecords))
    || inferGPT56SolEffortFromModelValue(rawModel)
    || 'high';
  return { inferenceModel, inferenceEffort };
}
