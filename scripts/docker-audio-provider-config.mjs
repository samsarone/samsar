export const DOCKER_AUDIO_PROVIDER_CAPABILITIES = Object.freeze({
  samsar: {
    ttsProviders: ['OPENAI', 'ELEVENLABS', 'GOOGLE'],
    musicProviders: ['ELEVENLABS_MUSIC', 'LYRIA3', 'LYRIA2', 'CASSETTEAI', 'AUDIOCRAFT'],
    soundEffectProviders: ['SDAUDIO'],
    allowAllTtsSpeakers: true,
    allowAllMusicProviders: true,
  },
  openai: {
    ttsProviders: ['OPENAI'],
    musicProviders: [],
    soundEffectProviders: [],
  },
  googleCloud: {
    ttsProviders: ['GOOGLE'],
    musicProviders: ['LYRIA3'],
    soundEffectProviders: [],
  },
  fal: {
    ttsProviders: ['ELEVENLABS', 'PLAYAI'],
    musicProviders: ['ELEVENLABS_MUSIC', 'CASSETTEAI', 'AUDIOCRAFT'],
    soundEffectProviders: ['SDAUDIO'],
  },
  elevenlabs: {
    ttsProviders: ['ELEVENLABS'],
    musicProviders: ['ELEVENLABS_MUSIC'],
    soundEffectProviders: [],
  },
});

export const DOCKER_AUDIO_PROVIDER_ORDER = Object.freeze([
  'openai',
  'googleCloud',
  'fal',
  'elevenlabs',
  'samsar',
  'gmicloud',
]);

function isProviderEnabled(providerConfig = {}) {
  return Boolean(providerConfig.enabled);
}

function uniqueSorted(values = []) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()))].sort();
}

function hasGmiCloudAudioRoute(modelMappings, modelKey) {
  const route = modelMappings?.[modelKey]?.audio;
  return Boolean(route && typeof route.modelId === 'string' && route.modelId.trim());
}

function getProviderCapabilities(provider, options = {}) {
  if (provider !== 'gmicloud') {
    return DOCKER_AUDIO_PROVIDER_CAPABILITIES[provider];
  }

  const modelMappings = options.gmiCloudModelMappings || {};
  return {
    ttsProviders: [
      ...(hasGmiCloudAudioRoute(modelMappings, 'OPENAI_TTS') ? ['OPENAI'] : []),
      ...(hasGmiCloudAudioRoute(modelMappings, 'ELEVENLABS') ? ['ELEVENLABS'] : []),
    ],
    musicProviders: [],
    soundEffectProviders: [],
  };
}

export function buildDockerAudioAvailability(providers = {}, options = {}) {
  const enabledProviders = Object.entries(providers)
    .filter(([, providerConfig]) => isProviderEnabled(providerConfig))
    .map(([provider]) => provider);
  const hasSamsar = enabledProviders.includes('samsar');
  const ttsProviders = [];
  const musicProviders = [];
  const soundEffectProviders = [];

  for (const provider of enabledProviders) {
    const capabilities = getProviderCapabilities(provider, options);
    if (!capabilities) {
      continue;
    }
    ttsProviders.push(...capabilities.ttsProviders);
    musicProviders.push(...capabilities.musicProviders);
    soundEffectProviders.push(...capabilities.soundEffectProviders);
  }

  return {
    providers: enabledProviders,
    ttsProviders: uniqueSorted(ttsProviders),
    musicProviders: uniqueSorted(musicProviders),
    soundEffectProviders: uniqueSorted(soundEffectProviders),
    allowAllTtsSpeakers: hasSamsar,
    allowAllMusicProviders: hasSamsar,
    source: 'docker-audio-provider-config',
  };
}
