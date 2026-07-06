import {
  OPENAI_SPEAKER_TYPES as RAW_OPENAI_SPEAKER_TYPES,
  ELEVENLABS_SPEAKER_TYPES as RAW_ELEVENLABS_SPEAKER_TYPES,
} from './SpeechList.js';

export const TTS_PROVIDER_OPENAI = 'OPENAI';
export const TTS_PROVIDER_ELEVENLABS = 'ELEVENLABS';
export const TTS_PROVIDER_GOOGLE = 'GOOGLE';
export const TTS_PROVIDER_CUSTOM_TEXT_TO_SPEECH = 'CUSTOM_TEXT_TO_SPEECH';

export const SUPPORTED_TTS_PROVIDERS = [
  TTS_PROVIDER_OPENAI,
  TTS_PROVIDER_ELEVENLABS,
  TTS_PROVIDER_GOOGLE,
  TTS_PROVIDER_CUSTOM_TEXT_TO_SPEECH,
];

function extractRawGenderValue(rawGender) {
  if (rawGender === null || rawGender === undefined) {
    return null;
  }

  if (typeof rawGender === 'string' || typeof rawGender === 'number') {
    return rawGender;
  }

  if (typeof rawGender !== 'object' || Array.isArray(rawGender)) {
    return null;
  }

  const candidateKeys = [
    'Gender',
    'gender',
    'genderCode',
    'ssmlGender',
    'ssml_gender',
    'value',
    'code',
    'name',
    'label',
    'enum',
    'type',
  ];

  for (const key of candidateKeys) {
    const normalized = normalizeTTSSpeakerGender(rawGender[key]);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

export function normalizeTTSSpeakerGender(rawGender = '') {
  const rawValue = extractRawGenderValue(rawGender);
  if (rawValue === null || rawValue === undefined) {
    return null;
  }

  const normalized = String(rawValue).trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized === '1') {
    return 'M';
  }

  if (normalized === '2') {
    return 'F';
  }

  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  const compact = normalized.replace(/[^a-z0-9]+/g, '');

  if (
    normalized === 'm' ||
    normalized === 'male' ||
    normalized === 'man' ||
    normalized === 'masculine' ||
    tokens.includes('male') ||
    tokens.includes('man') ||
    tokens.includes('masculine') ||
    compact === 'gendermale' ||
    compact === 'ssmlvoicegendermale'
  ) {
    return 'M';
  }

  if (
    normalized === 'f' ||
    normalized === 'female' ||
    normalized === 'woman' ||
    normalized === 'feminine' ||
    tokens.includes('female') ||
    tokens.includes('woman') ||
    tokens.includes('feminine') ||
    compact === 'genderfemale' ||
    compact === 'ssmlvoicegenderfemale'
  ) {
    return 'F';
  }

  return null;
}

function normalizeSpeakerRecord(rawSpeaker = {}, providerOverride = null) {
  const provider = providerOverride || rawSpeaker.provider || null;
  const gender = normalizeTTSSpeakerGender(rawSpeaker.Gender || rawSpeaker.gender);

  return {
    ...rawSpeaker,
    provider,
    value: typeof rawSpeaker.value === 'string' ? rawSpeaker.value.trim() : rawSpeaker.value,
    label: typeof rawSpeaker.label === 'string' ? rawSpeaker.label.trim() : rawSpeaker.label,
    name:
      typeof rawSpeaker.name === 'string' && rawSpeaker.name.trim()
        ? rawSpeaker.name.trim()
        : (typeof rawSpeaker.label === 'string' ? rawSpeaker.label.trim() : rawSpeaker.label),
    previewURL: typeof rawSpeaker.previewURL === 'string' ? rawSpeaker.previewURL.trim() : rawSpeaker.previewURL,
    Gender: gender,
  };
}

export const OPENAI_TTS_SPEAKERS = RAW_OPENAI_SPEAKER_TYPES.map((speaker) =>
  normalizeSpeakerRecord(speaker, TTS_PROVIDER_OPENAI)
);

export const ELEVENLABS_TTS_SPEAKERS = RAW_ELEVENLABS_SPEAKER_TYPES.map((speaker) =>
  normalizeSpeakerRecord(speaker, TTS_PROVIDER_ELEVENLABS)
);

export const TTS_SPEAKERS_BY_PROVIDER = {
  [TTS_PROVIDER_OPENAI]: OPENAI_TTS_SPEAKERS,
  [TTS_PROVIDER_ELEVENLABS]: ELEVENLABS_TTS_SPEAKERS,
  [TTS_PROVIDER_GOOGLE]: [],
};

export const ALL_TTS_SPEAKERS = [
  ...OPENAI_TTS_SPEAKERS,
  ...ELEVENLABS_TTS_SPEAKERS,
];

export function getTTSSpeakersForProvider(provider = '') {
  const normalizedProvider = typeof provider === 'string' ? provider.trim().toUpperCase() : '';
  return TTS_SPEAKERS_BY_PROVIDER[normalizedProvider] || [];
}

export function findTTSSpeaker(provider = '', speakerValue = '') {
  const normalizedValue = typeof speakerValue === 'string' ? speakerValue.trim() : '';
  if (!normalizedValue) {
    return null;
  }

  return getTTSSpeakersForProvider(provider).find((speaker) => speaker.value === normalizedValue) || null;
}

export function isKnownTTSSpeaker(provider = '', speakerValue = '') {
  return Boolean(findTTSSpeaker(provider, speakerValue));
}
