export const STANDALONE_ADAPTER_KEYS = Object.freeze([
  "openai",
  "googleCloud",
  "kimi",
  "alibabaCloud",
  "gmicloud",
  "samsar",
  "fal",
  "openrouter",
  "elevenlabs",
  "runway",
]);

const ADAPTER_PRESENTATIONS = Object.freeze({
  openai: Object.freeze({ label: "OpenAI", mark: "openai", glyph: "O" }),
  googleCloud: Object.freeze({ label: "Google Cloud", mark: "googleCloud", glyph: "G" }),
  kimi: Object.freeze({ label: "Kimi", mark: "glyph", glyph: "K" }),
  alibabaCloud: Object.freeze({ label: "Alibaba Cloud", mark: "alibabaCloud", glyph: "A" }),
  samsar: Object.freeze({ label: "Samsar-js", mark: "glyph", glyph: "S" }),
  gmicloud: Object.freeze({ label: "GMICloud via GenBlaze", mark: "genblaze", glyph: "G" }),
  fal: Object.freeze({ label: "Fal", mark: "glyph", glyph: "ƒ" }),
  openrouter: Object.freeze({ label: "OpenRouter", mark: "openrouter", glyph: "R" }),
  elevenlabs: Object.freeze({ label: "ElevenLabs", mark: "glyph", glyph: "11" }),
  runway: Object.freeze({ label: "RunwayML", mark: "glyph", glyph: "R" }),
  native: Object.freeze({ label: "Native adapter", mark: "native", glyph: "N" }),
  custom: Object.freeze({ label: "Custom adapter", mark: "custom", glyph: "C" }),
});

const ADAPTER_ALIASES = Object.freeze({
  openai: "openai",
  google: "googleCloud",
  googlecloud: "googleCloud",
  gcp: "googleCloud",
  vertex: "googleCloud",
  vertexai: "googleCloud",
  kimi: "kimi",
  kimiapi: "kimi",
  moonshot: "kimi",
  moonshotai: "kimi",
  alibaba: "alibabaCloud",
  alibabacloud: "alibabaCloud",
  aliyun: "alibabaCloud",
  dashscope: "alibabaCloud",
  qwen: "alibabaCloud",
  samsar: "samsar",
  samsarapi: "samsar",
  samsarapikey: "samsar",
  samsarkey: "samsar",
  samsarjs: "samsar",
  deployed: "samsar",
  gmi: "gmicloud",
  gmicloud: "gmicloud",
  genblaze: "gmicloud",
  fal: "fal",
  falai: "fal",
  openrouter: "openrouter",
  openrouterai: "openrouter",
  elevenlabs: "elevenlabs",
  elevenlab: "elevenlabs",
  runway: "runway",
  runwayml: "runway",
  native: "native",
  custom: "custom",
  customadapter: "custom",
});

const CUSTOM_MODEL_PREFIX = "CUSTOM_";

const LEGACY_AUDIO_PROVIDER_PRIORITY_BY_MODEL = Object.freeze({
  PLAYAI: Object.freeze(["fal", "samsar"]),
  LYRIA2: Object.freeze(["googleCloud", "samsar"]),
  CASSETTEAI: Object.freeze(["fal", "samsar"]),
  AUDIOCRAFT: Object.freeze(["replicate", "samsar"]),
  SDAUDIO: Object.freeze(["fal", "samsar"]),
});

const AUDIO_TTS_MODEL_KEY_BY_PROVIDER = Object.freeze({
  OPENAI: "OPENAI_TTS",
  GOOGLE: "GOOGLE_TTS",
  ELEVENLABS: "ELEVENLABS",
  PLAYAI: "PLAYAI",
});

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeAdapterToken(value) {
  return normalizeString(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function formatUnknownAdapterLabel(value) {
  return normalizeString(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Unknown adapter";
}

function getFallbackGlyph(value) {
  return normalizeString(value).match(/[a-z0-9]/i)?.[0]?.toUpperCase() || "?";
}

export function normalizeAdapterKey(value) {
  const normalizedValue = normalizeString(value);
  if (!normalizedValue) return "";
  return ADAPTER_ALIASES[normalizeAdapterToken(normalizedValue)] || normalizedValue;
}

export function getAdapterPresentation(value, { label } = {}) {
  const key = normalizeAdapterKey(value);
  if (!key) return null;

  const presentation = ADAPTER_PRESENTATIONS[key];
  const fallbackLabel = presentation?.label || formatUnknownAdapterLabel(key);
  const resolvedLabel = normalizeString(label) || fallbackLabel;

  return {
    key,
    label: resolvedLabel,
    mark: presentation?.mark || "glyph",
    glyph: presentation?.glyph || getFallbackGlyph(resolvedLabel),
  };
}

export function normalizeAdapterModelLookupKey(value) {
  return normalizeString(value).replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function getFirstObject(candidates = []) {
  const objects = candidates.filter(
    (candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate),
  );
  return objects.find((candidate) => Object.keys(candidate).length > 0) || objects[0] || {};
}

function getProviderMap(payload = {}) {
  return getFirstObject([
    payload?.deployment?.modelProviders,
    payload?.deployment?.model_providers,
    payload?.available?.modelProviders,
    payload?.available?.model_providers,
    payload?.modelProviders,
    payload?.model_providers,
  ]);
}

function getProviderPriorityMap(payload = {}) {
  return getFirstObject([
    payload?.deployment?.modelProviderPriority,
    payload?.deployment?.model_provider_priority,
    payload?.available?.modelProviderPriority,
    payload?.available?.model_provider_priority,
    payload?.modelProviderPriority,
    payload?.model_provider_priority,
  ]);
}

function getConfiguredProviders(payload = {}) {
  const candidates = [
    payload?.deployment?.providers,
    payload?.available?.providers,
    payload?.availableProviders,
    payload?.available_providers,
    payload?.providers,
  ];
  const providerLists = candidates.filter(Array.isArray);
  const providers = providerLists.find((candidate) => candidate.length > 0) || providerLists[0] || [];
  return new Set(providers.map(normalizeAdapterKey).filter(Boolean));
}

function getAudioAvailability(payload = {}) {
  return getFirstObject([
    payload?.deployment?.audio,
    payload?.available?.audio,
    payload?.audio,
    payload?.availableAudio,
    payload?.available_audio,
  ]);
}

function getLegacyAudioAdapterByModel(payload = {}) {
  const audioAvailability = getAudioAvailability(payload);
  const configuredProviders = new Set(
    (Array.isArray(audioAvailability.providers) ? audioAvailability.providers : [])
      .map(normalizeAdapterKey)
      .filter(Boolean),
  );
  if (configuredProviders.size === 0) return {};

  const availableModelKeys = new Set([
    ...(Array.isArray(audioAvailability.ttsProviders)
      ? audioAvailability.ttsProviders.map((provider) => (
        AUDIO_TTS_MODEL_KEY_BY_PROVIDER[normalizeAdapterModelLookupKey(provider)] || provider
      ))
      : []),
    ...(Array.isArray(audioAvailability.musicProviders) ? audioAvailability.musicProviders : []),
    ...(Array.isArray(audioAvailability.soundEffectProviders)
      ? audioAvailability.soundEffectProviders
      : []),
  ].map(normalizeAdapterModelLookupKey).filter(Boolean));

  return Object.fromEntries(
    Object.entries(LEGACY_AUDIO_PROVIDER_PRIORITY_BY_MODEL)
      .filter(([modelKey]) => availableModelKeys.has(normalizeAdapterModelLookupKey(modelKey)))
      .map(([modelKey, priority]) => [
        normalizeAdapterModelLookupKey(modelKey),
        priority.map(normalizeAdapterKey).find((provider) => configuredProviders.has(provider)),
      ])
      .filter(([, provider]) => Boolean(provider)),
  );
}

export function extractPrimaryAdapterByModel(payload = {}) {
  const result = {};

  for (const [modelKey, adapterKey] of Object.entries(getProviderMap(payload))) {
    const lookupKey = normalizeAdapterModelLookupKey(modelKey);
    const normalizedAdapterKey = normalizeAdapterKey(adapterKey);
    if (lookupKey && normalizedAdapterKey) {
      result[lookupKey] = normalizedAdapterKey;
    }
  }

  const configuredProviders = getConfiguredProviders(payload);
  for (const [modelKey, priority] of Object.entries(getProviderPriorityMap(payload))) {
    const lookupKey = normalizeAdapterModelLookupKey(modelKey);
    if (!lookupKey || result[lookupKey] || !Array.isArray(priority)) continue;

    const configuredAdapter = priority
      .map(normalizeAdapterKey)
      .find((adapterKey) => adapterKey && configuredProviders.has(adapterKey));
    if (configuredAdapter) {
      result[lookupKey] = configuredAdapter;
    }
  }

  for (const [modelKey, adapterKey] of Object.entries(getLegacyAudioAdapterByModel(payload))) {
    if (!result[modelKey]) {
      result[modelKey] = adapterKey;
    }
  }

  return result;
}

export function getPrimaryAdapterKeyForModel(modelKey, primaryAdapterByModel = {}) {
  const normalizedModelKey = normalizeString(modelKey);
  if (!normalizedModelKey) return "";
  if (normalizedModelKey.toUpperCase().startsWith(CUSTOM_MODEL_PREFIX)) {
    return "custom";
  }

  const lookupKey = normalizeAdapterModelLookupKey(normalizedModelKey);
  if (primaryAdapterByModel?.[lookupKey]) {
    return normalizeAdapterKey(primaryAdapterByModel[lookupKey]);
  }

  const matchingEntry = Object.entries(primaryAdapterByModel || {}).find(
    ([candidate]) => normalizeAdapterModelLookupKey(candidate) === lookupKey,
  );
  return normalizeAdapterKey(matchingEntry?.[1]);
}
