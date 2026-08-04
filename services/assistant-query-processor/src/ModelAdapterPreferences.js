import fs from 'node:fs';

import { isStandaloneEdition } from './DeploymentEnvironment.js';

const DEFAULT_MODEL_ADAPTER_PREFERENCES_PATH =
  '/persistent/config/model-adapter-preferences.json';

const MODEL_KEY_BY_TOKEN = Object.freeze({
  GEMINI31PRO: 'gemini-3.1-pro',
  GPT56SOL: 'gpt-5.6-sol',
  KIMI3: 'KIMIK3',
  KIMIK3: 'KIMIK3',
  MOONSHOTK3: 'KIMIK3',
  MOONSHOTKIMIK3: 'KIMIK3',
  QWEN38: 'QWEN3.8',
  QWEN38MAX: 'QWEN3.8',
});

const PROVIDER_BY_TOKEN = Object.freeze({
  alibaba: 'alibabaCloud',
  alibabacloud: 'alibabaCloud',
  aliyun: 'alibabaCloud',
  dashscope: 'alibabaCloud',
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
  qwen: 'alibabaCloud',
  samsar: 'samsar',
});

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeToken(value) {
  return normalizeString(value).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

export function normalizeModelAdapterModelKey(value) {
  const normalized = normalizeString(value);
  return MODEL_KEY_BY_TOKEN[normalizeToken(normalized)] || normalized;
}

export function normalizeModelAdapterProviderKey(value) {
  const token = normalizeString(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  return PROVIDER_BY_TOKEN[token] || '';
}

function uniqueProviders(value) {
  return [...new Set(
    (Array.isArray(value) ? value : [])
      .map(normalizeModelAdapterProviderKey)
      .filter(Boolean),
  )];
}

function normalizePriorityMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([modelKey, priority]) => [
        normalizeModelAdapterModelKey(modelKey),
        uniqueProviders(priority),
      ])
      .filter(([modelKey, priority]) => Boolean(modelKey) && priority.length > 0),
  );
}

export function getModelAdapterPreferencesPath(env = process.env) {
  return normalizeString(env?.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH) ||
    DEFAULT_MODEL_ADAPTER_PREFERENCES_PATH;
}

export function readModelAdapterPreferences({
  env = process.env,
  filePath = getModelAdapterPreferencesPath(env),
} = {}) {
  if (!isStandaloneEdition(env) || !fs.existsSync(filePath)) {
    return { modelProviderPriority: {}, filePath };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      modelProviderPriority: normalizePriorityMap(
        parsed?.modelProviderPriority || parsed?.model_provider_priority,
      ),
      filePath,
    };
  } catch {
    return { modelProviderPriority: {}, filePath };
  }
}

export function applyModelAdapterPreferenceOrder(
  defaultPriority = [],
  savedPriority = [],
) {
  const normalizedDefault = uniqueProviders(defaultPriority);
  const allowedProviders = new Set(normalizedDefault);
  const preferredProviders = uniqueProviders(savedPriority)
    .filter((provider) => allowedProviders.has(provider));

  return [
    ...preferredProviders,
    ...normalizedDefault.filter((provider) => !preferredProviders.includes(provider)),
  ];
}
