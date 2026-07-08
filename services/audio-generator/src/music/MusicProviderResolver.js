import {
  DOCKER_AUDIO_PROVIDER,
  resolveDockerMusicProvider,
} from '../consts/DockerProviderPriority.js';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function isSamsarExternalAudioMusicRequest(payload = {}) {
  const generationMeta = payload.generationMeta && typeof payload.generationMeta === 'object'
    ? payload.generationMeta
    : {};

  return payload.externalAudioApiRequest === true ||
    generationMeta.externalAudioApiRequest === true ||
    normalizeString(generationMeta.externalAudioRoute).toLowerCase() === 'text_to_music';
}

export function resolveMusicProvider(payload = {}, {
  shouldUseNativeElevenLabsMusic = () => false,
  shouldUseLyriaNative = () => false,
} = {}) {
  const model = normalizeString(payload.model);
  if (model === 'CUSTOM_TEXT_TO_MUSIC') {
    return '';
  }

  if (model === 'ELEVENLABS_MUSIC' && isSamsarExternalAudioMusicRequest(payload)) {
    return DOCKER_AUDIO_PROVIDER.FAL;
  }

  const dockerProvider = resolveDockerMusicProvider(model, payload);
  if (dockerProvider) {
    return dockerProvider;
  }

  if (model === 'ELEVENLABS_MUSIC') {
    return shouldUseNativeElevenLabsMusic(payload)
      ? DOCKER_AUDIO_PROVIDER.ELEVENLABS
      : DOCKER_AUDIO_PROVIDER.FAL;
  }
  if (model === 'LYRIA3' || model === 'LYRIA2') {
    return shouldUseLyriaNative(payload)
      ? DOCKER_AUDIO_PROVIDER.GOOGLE_CLOUD
      : DOCKER_AUDIO_PROVIDER.FAL;
  }
  if (model === 'AUDIOCRAFT') {
    return DOCKER_AUDIO_PROVIDER.REPLICATE;
  }
  if (model === 'CASSETTEAI') {
    return DOCKER_AUDIO_PROVIDER.FAL;
  }
  return '';
}
