import { OPENAI_SPEAKER_TYPES } from "../Types.ts";
import { ELEVENLABS_TTS } from "../ElevenLabs.jsx";

const OPENAI_PROVIDER = "OPENAI";
const ELEVENLABS_PROVIDER = "ELEVENLABS";
const GOOGLE_PROVIDER = "GOOGLE";

function normalizeSpeakerGender(rawGender = "") {
  if (typeof rawGender !== "string") {
    return { code: null, label: "Unspecified" };
  }

  const normalized = rawGender.trim().toLowerCase();
  if (!normalized) {
    return { code: null, label: "Unspecified" };
  }

  if (normalized === "m" || normalized === "male" || normalized === "man") {
    return { code: "M", label: "Male" };
  }

  if (normalized === "f" || normalized === "female" || normalized === "woman") {
    return { code: "F", label: "Female" };
  }

  return {
    code: null,
    label: normalized.replace(/\b\w/g, (char) => char.toUpperCase()),
  };
}

function normalizeSpeakerRecord(speaker = {}, provider) {
  const gender = normalizeSpeakerGender(speaker.Gender || speaker.gender);

  return {
    ...speaker,
    provider,
    value: typeof speaker.value === "string" ? speaker.value.trim() : speaker.value,
    label: typeof speaker.label === "string" ? speaker.label.trim() : speaker.label,
    previewURL: typeof speaker.previewURL === "string" ? speaker.previewURL.trim() : speaker.previewURL,
    genderCode: gender.code,
    genderLabel: gender.label,
  };
}

const OPENAI_AGENT_SPEAKERS = OPENAI_SPEAKER_TYPES.map((speaker) =>
  normalizeSpeakerRecord(speaker, OPENAI_PROVIDER)
);

const ELEVENLABS_AGENT_SPEAKERS = ELEVENLABS_TTS.map((speaker) =>
  normalizeSpeakerRecord(speaker, ELEVENLABS_PROVIDER)
);

export const AGENT_SPEAKER_GROUPS = [
  {
    key: OPENAI_PROVIDER,
    label: "OpenAI TTS",
    allowKey: "allowOpenAI",
    selectionKey: "openAISpeakers",
    speakers: OPENAI_AGENT_SPEAKERS,
  },
  {
    key: ELEVENLABS_PROVIDER,
    label: "ElevenLabs TTS",
    allowKey: "allowElevenLabs",
    selectionKey: "elevenLabsSpeakers",
    speakers: ELEVENLABS_AGENT_SPEAKERS,
  },
  {
    key: GOOGLE_PROVIDER,
    label: "Google TTS",
    allowKey: "allowGoogle",
    selectionKey: "googleSpeakers",
    speakers: [],
  },
];

const EMPTY_SPEAKER_OPTIONS = {
  allowOpenAI: false,
  allowElevenLabs: false,
  allowGoogle: false,
  openAISpeakers: [],
  elevenLabsSpeakers: [],
  googleSpeakers: [],
  googleSpeakerDetails: [],
};

function normalizeSelectionList(speakers = [], allowedValues = []) {
  if (!Array.isArray(speakers) || speakers.length === 0) {
    return [];
  }

  const shouldFilterAllowedValues = allowedValues.length > 0;
  const allowed = new Set(allowedValues);
  const seen = new Set();
  const normalized = [];

  speakers.forEach((speakerValue) => {
    if (typeof speakerValue !== "string") {
      return;
    }

    const trimmed = speakerValue.trim();
    if (!trimmed || seen.has(trimmed) || (shouldFilterAllowedValues && !allowed.has(trimmed))) {
      return;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  });

  return normalized;
}

function normalizeSpeakerDetails(speakerDetails = []) {
  if (!Array.isArray(speakerDetails)) {
    return [];
  }

  return speakerDetails
    .filter((speaker) => speaker && typeof speaker === "object")
    .map((speaker) => ({
      ...speaker,
      provider: GOOGLE_PROVIDER,
      value: typeof speaker.value === "string" ? speaker.value.trim() : speaker.value,
      voiceId:
        typeof speaker.voiceId === "string" && speaker.voiceId.trim()
          ? speaker.voiceId.trim()
          : typeof speaker.value === "string"
            ? speaker.value.trim()
            : speaker.voiceId,
      languageCode:
        typeof speaker.languageCode === "string" ? speaker.languageCode.trim() : speaker.languageCode,
      languageCodes: Array.isArray(speaker.languageCodes) ? speaker.languageCodes : [],
    }))
    .filter((speaker) => typeof speaker.value === "string" && speaker.value);
}

function buildGoogleSpeakerDetails(speakerOptions = {}, speakerGroups = AGENT_SPEAKER_GROUPS) {
  const googleGroup = speakerGroups.find((group) => group.key === GOOGLE_PROVIDER);
  const googleSpeakers = Array.isArray(googleGroup?.speakers) ? googleGroup.speakers : [];
  const speakerByValue = new Map(googleSpeakers.map((speaker) => [speaker.value, speaker]));
  const selectedValues = Array.isArray(speakerOptions.googleSpeakers)
    ? speakerOptions.googleSpeakers
    : [];

  return selectedValues.map((speakerValue) => {
    const speaker = speakerByValue.get(speakerValue);
    if (!speaker) {
      return normalizeSpeakerDetails(speakerOptions.googleSpeakerDetails)
        .find((detail) => detail.value === speakerValue) || null;
    }

    return {
      provider: GOOGLE_PROVIDER,
      value: speaker.value,
      voiceId: speaker.voiceId || speaker.value,
      name: speaker.name || speaker.label || speaker.value,
      label: speaker.label || speaker.name || speaker.value,
      languageCode: speaker.languageCode,
      languageCodes: Array.isArray(speaker.languageCodes) ? speaker.languageCodes : [],
      Gender: speaker.Gender || speaker.genderCode || null,
      previewURL: speaker.previewURL,
      previewRequiresAuth: speaker.previewRequiresAuth,
    };
  }).filter(Boolean);
}

export function normalizeSpeakerOptionsState(speakerOptions = null, speakerGroups = AGENT_SPEAKER_GROUPS) {
  const normalized = {
    ...EMPTY_SPEAKER_OPTIONS,
    googleSpeakerDetails: normalizeSpeakerDetails(speakerOptions?.googleSpeakerDetails),
  };

  speakerGroups.forEach((group) => {
    const allowedValues = Array.isArray(group.speakers)
      ? group.speakers.map((speaker) => speaker.value)
      : [];
    normalized[group.allowKey] = speakerOptions?.[group.allowKey] === true;
    normalized[group.selectionKey] = normalizeSelectionList(
      speakerOptions?.[group.selectionKey],
      allowedValues
    );
  });

  return normalized;
}

export function buildSpeakerOptionsPayload(speakerOptions = null, speakerGroups = AGENT_SPEAKER_GROUPS) {
  const normalized = normalizeSpeakerOptionsState(speakerOptions, speakerGroups);
  normalized.googleSpeakerDetails = buildGoogleSpeakerDetails(normalized, speakerGroups);
  const hasSelections = speakerGroups.some((group) => (
    normalized[group.allowKey] ||
    (Array.isArray(normalized[group.selectionKey]) && normalized[group.selectionKey].length > 0)
  ));

  return hasSelections ? normalized : null;
}
