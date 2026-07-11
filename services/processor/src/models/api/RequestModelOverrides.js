import {
  DEFAULT_INFERENCE_MODEL,
  GEMINI_31_PRO_INFERENCE_MODEL,
  normalizeInferenceModel,
} from '../../consts/InferenceModels.js';
import {
  TTS_PROVIDER_ELEVENLABS,
  TTS_PROVIDER_GOOGLE,
  TTS_PROVIDER_OPENAI,
  normalizeTTSSpeakerGender,
} from '../../consts/TTSSpeakers.js';

const BACKING_TRACK_MODEL_KEYS = Object.freeze([
  'backingtrack_model',
  'backing_track_model',
  'backingTrackModel',
  'backingTrack',
  'backing_track',
  'music_provider',
  'musicProvider',
]);

const TTS_MODEL_KEYS = Object.freeze([
  'tts_model',
  'ttsModel',
  'tts_provider',
  'ttsProvider',
  'speaker_provider',
  'speakerProvider',
]);

const INFERENCE_MODEL_KEYS = Object.freeze([
  'inference_model',
  'inferenceModel',
]);

const SPEAKER_OPTIONS_KEYS = Object.freeze([
  'speakerOptions',
  'speaker_options',
]);

const BACKING_TRACK_ALIASES = Object.freeze({
  ELEVENLABSMUSIC: 'ELEVENLABS_MUSIC',
  ELEVENLABS: 'ELEVENLABS_MUSIC',
  ELEVENLAB: 'ELEVENLABS_MUSIC',
  ELEVEN: 'ELEVENLABS_MUSIC',
  LYRIA3: 'LYRIA3',
  LYRIA2: 'LYRIA3',
  LYRIA: 'LYRIA3',
  GOOGLELYRIA3: 'LYRIA3',
  GOOGLELYRIA2: 'LYRIA3',
  GOOGLELYRIA: 'LYRIA3',
  LYRIAPRO: 'LYRIA3',
  LYRIA3PRO: 'LYRIA3',
  GOOGLELYRIA3PRO: 'LYRIA3',
});

const TTS_MODEL_ALIASES = Object.freeze({
  OPENAI: TTS_PROVIDER_OPENAI,
  OPENAITTS: TTS_PROVIDER_OPENAI,
  OPENAISPEECH: TTS_PROVIDER_OPENAI,
  ELEVENLABS: TTS_PROVIDER_ELEVENLABS,
  ELEVENLAB: TTS_PROVIDER_ELEVENLABS,
  ELEVEN: TTS_PROVIDER_ELEVENLABS,
  ELEVENLABSTTS: TTS_PROVIDER_ELEVENLABS,
  ELEVENLABSSPEECH: TTS_PROVIDER_ELEVENLABS,
  GOOGLE: TTS_PROVIDER_GOOGLE,
  GOOGLETTS: TTS_PROVIDER_GOOGLE,
  GOOGLESPEECH: TTS_PROVIDER_GOOGLE,
  GOOGLECLOUDTTS: TTS_PROVIDER_GOOGLE,
});

const INFERENCE_MODEL_ALIASES = Object.freeze({
  GPT56: DEFAULT_INFERENCE_MODEL,
  GPT56SOL: DEFAULT_INFERENCE_MODEL,
  GEMINI31PRO: GEMINI_31_PRO_INFERENCE_MODEL,
  GEMINI31PROPREVIEW: GEMINI_31_PRO_INFERENCE_MODEL,
  GEMINI3PRO: GEMINI_31_PRO_INFERENCE_MODEL,
  GEMINI3PROPREVIEW: GEMINI_31_PRO_INFERENCE_MODEL,
  GOOGLEGEMINI31PRO: GEMINI_31_PRO_INFERENCE_MODEL,
  GOOGLEGEMINI3PRO: GEMINI_31_PRO_INFERENCE_MODEL,
});

const CUSTOM_ADAPTER_OPERATION_KEYS_WITHOUT_TTS = Object.freeze([
  'text_to_video',
  'image_to_video',
  'text_to_image',
  'text_to_music',
  'text_to_sound_effect',
]);

function makeValidationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function getPayloadAliasValue(payload = {}, keys = []) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { provided: false, value: undefined };
  }

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      return { provided: true, value: payload[key] };
    }
  }

  return { provided: false, value: undefined };
}

function normalizeAliasToken(value) {
  return typeof value === 'string'
    ? value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '')
    : '';
}

function normalizeOptionalModelAlias(value, aliases, fieldName) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw makeValidationError(`${fieldName} must be a string when provided.`);
  }

  const token = normalizeAliasToken(value);
  if (!token) {
    return null;
  }

  const normalizedModel = aliases[token];
  if (!normalizedModel) {
    throw makeValidationError(
      `${fieldName} must be one of: ELEVENLABS_MUSIC, LYRIA3.`
    );
  }

  return normalizedModel;
}

export function normalizeBackingTrackModelFromPayload(payload = {}) {
  const { provided, value } = getPayloadAliasValue(payload, BACKING_TRACK_MODEL_KEYS);
  if (!provided) {
    return null;
  }

  return normalizeOptionalModelAlias(value, BACKING_TRACK_ALIASES, 'backingtrack_model');
}

export function normalizeTTSModelFromPayload(payload = {}) {
  const { provided, value } = getPayloadAliasValue(payload, TTS_MODEL_KEYS);
  if (!provided) {
    return null;
  }

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw makeValidationError('tts_model must be a string when provided.');
  }

  const token = normalizeAliasToken(value);
  if (!token) {
    return null;
  }

  const normalizedModel = TTS_MODEL_ALIASES[token];
  if (!normalizedModel) {
    throw makeValidationError('tts_model must be one of: OPENAI, ELEVENLABS, GOOGLE.');
  }

  return normalizedModel;
}

export function normalizeInferenceModelFromPayload(payload = {}) {
  const { provided, value } = getPayloadAliasValue(payload, INFERENCE_MODEL_KEYS);
  if (!provided) {
    return null;
  }

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw makeValidationError('inference_model must be a string when provided.');
  }

  const token = normalizeAliasToken(value);
  if (!token) {
    return null;
  }

  const normalizedModel = INFERENCE_MODEL_ALIASES[token];
  if (!normalizedModel) {
    throw makeValidationError('inference_model must be one of: gpt-5.6-sol, gemini-3.1-pro.');
  }

  return normalizedModel;
}

export function resolveEffectiveInferenceModel(payload = {}, userSelectedInferenceModel = null) {
  const requestedInferenceModel = normalizeInferenceModelFromPayload(payload);
  return requestedInferenceModel || normalizeInferenceModel(userSelectedInferenceModel);
}

export function getSpeakerOptionsFromPayload(payload = {}) {
  const { provided, value } = getPayloadAliasValue(payload, SPEAKER_OPTIONS_KEYS);
  return provided ? value : null;
}

function normalizeStringList(values = []) {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set();
  const normalized = [];
  values.forEach((value) => {
    if (typeof value !== 'string') {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  });
  return normalized;
}

function isSpeakerOptionsObject(speakerOptions) {
  return Boolean(
    speakerOptions &&
    typeof speakerOptions === 'object' &&
    !Array.isArray(speakerOptions)
  );
}

function resolveSpeakerOptionsSource(requestSpeakerOptions = null, fallbackSpeakerOptions = null) {
  return isSpeakerOptionsObject(requestSpeakerOptions)
    ? requestSpeakerOptions
    : fallbackSpeakerOptions;
}

function getGoogleLanguageCodeFromSpeakerValue(speakerValue = '') {
  if (typeof speakerValue !== 'string') {
    return '';
  }

  const languageMatch = speakerValue.trim().match(/^[a-z]{2,3}(?:-[A-Z0-9]{2,4})?/);
  return languageMatch?.[0] || '';
}

function normalizeGoogleSpeakerDetails(speakerOptions = {}) {
  const selectedGoogleSpeakers = normalizeStringList(speakerOptions?.googleSpeakers);
  const selectedSet = new Set(selectedGoogleSpeakers);
  const seen = new Set();
  const details = [];

  const rawDetails = Array.isArray(speakerOptions?.googleSpeakerDetails)
    ? speakerOptions.googleSpeakerDetails
    : [];
  rawDetails.forEach((speaker) => {
    if (!speaker || typeof speaker !== 'object' || Array.isArray(speaker)) {
      return;
    }
    const value =
      (typeof speaker.value === 'string' && speaker.value.trim()) ||
      (typeof speaker.voiceId === 'string' && speaker.voiceId.trim()) ||
      (typeof speaker.name === 'string' && speaker.name.trim()) ||
      '';
    if (!value || seen.has(value) || (selectedSet.size > 0 && !selectedSet.has(value))) {
      return;
    }

    const voiceId =
      typeof speaker.voiceId === 'string' && speaker.voiceId.trim()
        ? speaker.voiceId.trim()
        : value;
    const languageCodes = Array.isArray(speaker.languageCodes)
      ? speaker.languageCodes.filter((languageCode) => (
        typeof languageCode === 'string' && languageCode.trim()
      ))
      : [];
    const languageCode =
      typeof speaker.languageCode === 'string' && speaker.languageCode.trim()
        ? speaker.languageCode.trim()
        : languageCodes[0] || getGoogleLanguageCodeFromSpeakerValue(value);

    seen.add(value);
    details.push({
      ...speaker,
      provider: TTS_PROVIDER_GOOGLE,
      value,
      voiceId,
      label:
        typeof speaker.label === 'string' && speaker.label.trim()
          ? speaker.label.trim()
          : voiceId,
      shortLabel:
        typeof speaker.shortLabel === 'string' && speaker.shortLabel.trim()
          ? speaker.shortLabel.trim()
          : '',
      name:
        typeof speaker.name === 'string' && speaker.name.trim()
          ? speaker.name.trim()
          : voiceId,
      languageCode,
      languageCodes: languageCodes.length > 0
        ? languageCodes
        : languageCode
          ? [languageCode]
          : [],
      Gender: normalizeTTSSpeakerGender(
        speaker.Gender || speaker.genderCode || speaker.gender || speaker.ssmlGender
      ),
    });
  });

  selectedGoogleSpeakers.forEach((speakerValue) => {
    if (seen.has(speakerValue)) {
      return;
    }

    const languageCode = getGoogleLanguageCodeFromSpeakerValue(speakerValue);
    seen.add(speakerValue);
    details.push({
      provider: TTS_PROVIDER_GOOGLE,
      value: speakerValue,
      voiceId: speakerValue,
      name: speakerValue,
      label: speakerValue,
      shortLabel: speakerValue,
      languageCode,
      languageCodes: languageCode ? [languageCode] : [],
      Gender: null,
      gender: '',
      genderLabel: '',
      naturalSampleRateHertz: null,
      voiceType: '',
      previewRequiresAuth: true,
    });
  });

  return {
    googleSpeakers: selectedGoogleSpeakers.length > 0
      ? selectedGoogleSpeakers
      : details.map((speaker) => speaker.value),
    googleSpeakerDetails: details,
  };
}

export function buildSpeakerOptionsForTTSModel(
  ttsModel,
  requestSpeakerOptions = null,
  fallbackSpeakerOptions = null,
) {
  if (!ttsModel) {
    return null;
  }

  const speakerOptions = resolveSpeakerOptionsSource(
    requestSpeakerOptions,
    fallbackSpeakerOptions,
  );

  if (ttsModel === TTS_PROVIDER_OPENAI) {
    return {
      allowOpenAI: true,
      allowElevenLabs: false,
      allowGoogle: false,
      openAISpeakers: normalizeStringList(speakerOptions?.openAISpeakers),
      elevenLabsSpeakers: [],
      googleSpeakers: [],
      googleSpeakerDetails: [],
    };
  }

  if (ttsModel === TTS_PROVIDER_ELEVENLABS) {
    return {
      allowOpenAI: false,
      allowElevenLabs: true,
      allowGoogle: false,
      openAISpeakers: [],
      elevenLabsSpeakers: normalizeStringList(speakerOptions?.elevenLabsSpeakers),
      googleSpeakers: [],
      googleSpeakerDetails: [],
    };
  }

  if (ttsModel === TTS_PROVIDER_GOOGLE) {
    const googleOptions = normalizeGoogleSpeakerDetails(speakerOptions);
    if (googleOptions.googleSpeakerDetails.length === 0) {
      throw makeValidationError(
        'tts_model GOOGLE requires configured Google TTS speaker details in the request payload or user settings.'
      );
    }

    return {
      allowOpenAI: false,
      allowElevenLabs: false,
      allowGoogle: true,
      openAISpeakers: [],
      elevenLabsSpeakers: [],
      ...googleOptions,
    };
  }

  throw makeValidationError('tts_model must be one of: OPENAI, ELEVENLABS, GOOGLE.');
}

function hasRemainingCustomOperation(customAdapters = {}) {
  return CUSTOM_ADAPTER_OPERATION_KEYS_WITHOUT_TTS.some((key) => (
    typeof customAdapters[key] === 'string' && customAdapters[key].trim()
  ));
}

export function omitCustomTextToSpeechAdapterForTTSModel(customAdapters, ttsModel) {
  if (!ttsModel || !customAdapters || typeof customAdapters !== 'object' || Array.isArray(customAdapters)) {
    return customAdapters;
  }

  if (!Object.prototype.hasOwnProperty.call(customAdapters, 'text_to_speech')) {
    return customAdapters;
  }

  const { text_to_speech, ...remainingAdapters } = customAdapters;
  return hasRemainingCustomOperation(remainingAdapters) ? remainingAdapters : null;
}
