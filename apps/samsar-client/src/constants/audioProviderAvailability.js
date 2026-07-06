export const DEFAULT_AUDIO_AVAILABILITY = Object.freeze({
  providers: [],
  ttsProviders: [],
  musicProviders: [],
  soundEffectProviders: [],
  allowAllTtsSpeakers: false,
  allowAllMusicProviders: false,
});

export const DOCKER_AUDIO_PROVIDER_LABELS = Object.freeze({
  OPENAI: "OpenAI",
  ELEVENLABS: "ElevenLabs",
  GOOGLE: "Google TTS",
  PLAYAI: "PlayAI",
  CUSTOM_TEXT_TO_SPEECH: "Custom TTS",
});

export const DOCKER_MUSIC_PROVIDER_LABELS = Object.freeze({
  AUDIOCRAFT: "AudioCraft",
  CASSETTEAI: "CassetteAI",
  LYRIA2: "Lyria 2",
  LYRIA3: "Lyria 3",
  ELEVENLABS_MUSIC: "ElevenLabs Music",
  CUSTOM_TEXT_TO_MUSIC: "Custom Text to Music",
});

const IS_DOCKER_INSTALL = import.meta.env.VITE_DOCKER_INSTALL === "true";

function normalizeProvider(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function normalizeList(value) {
  return Array.isArray(value)
    ? value.map(normalizeProvider).filter(Boolean)
    : [];
}

export function normalizeAudioAvailability(value = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_AUDIO_AVAILABILITY;
  }

  return {
    providers: Array.isArray(value.providers) ? value.providers.filter(Boolean) : [],
    ttsProviders: normalizeList(value.ttsProviders),
    musicProviders: normalizeList(value.musicProviders),
    soundEffectProviders: normalizeList(value.soundEffectProviders),
    allowAllTtsSpeakers: value.allowAllTtsSpeakers === true,
    allowAllMusicProviders: value.allowAllMusicProviders === true,
    source: typeof value.source === "string" ? value.source : null,
  };
}

export function extractAudioAvailability(payload = {}) {
  return normalizeAudioAvailability(
    payload?.audio ||
    payload?.deployment?.audio ||
    payload?.available?.audio ||
    payload?.availableAudio ||
    payload?.available_audio ||
    null
  );
}

export function hasAudioAvailabilityRules(audioAvailability = DEFAULT_AUDIO_AVAILABILITY) {
  if (!IS_DOCKER_INSTALL) {
    return false;
  }

  return (
    audioAvailability.source === "docker-audio-provider-config" ||
    audioAvailability.allowAllTtsSpeakers ||
    audioAvailability.allowAllMusicProviders ||
    audioAvailability.ttsProviders.length > 0 ||
    audioAvailability.musicProviders.length > 0
  );
}

export function filterSpeakersForAudioAvailability(
  speakers = [],
  audioAvailability = DEFAULT_AUDIO_AVAILABILITY
) {
  if (!hasAudioAvailabilityRules(audioAvailability) || audioAvailability.allowAllTtsSpeakers) {
    return speakers;
  }

  const allowedProviders = new Set(audioAvailability.ttsProviders.map(normalizeProvider));
  if (allowedProviders.size === 0) {
    return [];
  }

  return speakers.filter((speaker) => allowedProviders.has(normalizeProvider(speaker.provider)));
}

export function filterTtsProviderOptionsForAudioAvailability(
  providerOptions = [],
  audioAvailability = DEFAULT_AUDIO_AVAILABILITY
) {
  if (!hasAudioAvailabilityRules(audioAvailability) || audioAvailability.allowAllTtsSpeakers) {
    return providerOptions;
  }

  const allowedProviders = new Set(audioAvailability.ttsProviders.map(normalizeProvider));
  if (allowedProviders.size === 0) {
    return [];
  }

  return providerOptions.filter((provider) => allowedProviders.has(normalizeProvider(provider.value || provider.key)));
}

export function filterSpeakerGroupsForAudioAvailability(
  speakerGroups = [],
  audioAvailability = DEFAULT_AUDIO_AVAILABILITY
) {
  if (!hasAudioAvailabilityRules(audioAvailability) || audioAvailability.allowAllTtsSpeakers) {
    return speakerGroups;
  }

  const allowedProviders = new Set(audioAvailability.ttsProviders.map(normalizeProvider));
  if (allowedProviders.size === 0) {
    return [];
  }

  return speakerGroups
    .filter((group) => allowedProviders.has(normalizeProvider(group.key)))
    .map((group) => ({
      ...group,
      speakers: filterSpeakersForAudioAvailability(group.speakers || [], audioAvailability),
    }));
}

export function filterMusicProvidersForAudioAvailability(
  musicProviders = [],
  audioAvailability = DEFAULT_AUDIO_AVAILABILITY
) {
  if (!hasAudioAvailabilityRules(audioAvailability) || audioAvailability.allowAllMusicProviders) {
    return musicProviders;
  }

  const allowedProviders = new Set(audioAvailability.musicProviders.map(normalizeProvider));
  if (allowedProviders.size === 0) {
    return [];
  }

  return musicProviders.filter((provider) => allowedProviders.has(normalizeProvider(provider.key || provider.value)));
}
