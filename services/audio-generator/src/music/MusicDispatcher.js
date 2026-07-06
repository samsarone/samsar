import axios from 'axios';
import { getDBConnectionString } from '../DBString.js';
import { dispatchAndProcessAudiocraftMusicRequest} from './AudioCraftGenerator.js';

import {  dispatchAndProcessCassetteAIMusicRequest } from './CassetteAIGenerator.js';
import { dispatchAndProcessElevenLabsMusicRequest, shouldUseNativeElevenLabsMusic } from './ElevenLabsMusicGenerator.js';
import { dispatchAndProcessLyriaAIMusicRequest } from './LyriaAIGenerator.js';
import {
  dispatchAndProcessLyriaNativeMusicRequest,
  shouldUseLyriaNative,
} from './GoogleLyriaNativeGenerator.js';
import { dispatchAndProcessCustomMusicRequest } from './CustomMusicGenerator.js';
import { recordProviderUsageLog } from '../utils/ProviderUsageAudit.js';
import {
  DOCKER_AUDIO_PROVIDER,
  hasDockerMusicProviderPriority,
  isInitialDockerAudioRoutingRequest,
  resolveDockerMusicProvider,
} from '../consts/DockerProviderPriority.js';
import {
  dispatchAndProcessSamsarExternalMusicRequest,
} from '../external/SamsarExternalAudioAdapter.js';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toPlainPayload(payload = {}) {
  return typeof payload?.toObject === 'function' ? payload.toObject() : payload;
}

function resolveMusicProvider(payload = {}) {
  const model = normalizeString(payload.model);
  if (model === 'CUSTOM_TEXT_TO_MUSIC') {
    return '';
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

async function recordMusicProviderUsage(payload = {}) {
  if (normalizeString(payload.status || 'INIT').toUpperCase() !== 'INIT') {
    return;
  }
  const provider = resolveMusicProvider(payload);
  if (!provider) {
    return;
  }
  await recordProviderUsageLog({
    payload,
    requestType: 'text_to_music',
    callType: 'text_to_music',
    provider,
    model: payload.model,
    source: 'music_generator',
    service: 'samsar_audio_generator',
    status: 'requested',
    metadata: {
      duration: payload.duration,
      isInstrumental: payload.isInstrumental,
    },
  });
}

export async function dispatchAndProcessMusicRequest(payload) {

  const { model } = payload;

  await getDBConnectionString();
  await recordMusicProviderUsage(payload);
  const provider = resolveMusicProvider(payload);

  if (
    !provider &&
    isInitialDockerAudioRoutingRequest(payload) &&
    hasDockerMusicProviderPriority(model)
  ) {
    throw new Error(`No configured Docker music provider for ${model}.`);
  }

  if (provider === DOCKER_AUDIO_PROVIDER.SAMSAR) {
    await dispatchAndProcessSamsarExternalMusicRequest(payload);
  } else if (model === 'AUDIOCRAFT') {
    await dispatchAndProcessAudiocraftMusicRequest(payload);
  } else if (model === 'CASSETTEAI') {
    await dispatchAndProcessCassetteAIMusicRequest(payload);
  } else if (model === 'ELEVENLABS_MUSIC') {
    await dispatchAndProcessElevenLabsMusicRequest({
      ...toPlainPayload(payload),
      resolvedMusicProvider: provider,
    });
  } else if (model === 'LYRIA3' || model === 'LYRIA2') {
    if (provider === DOCKER_AUDIO_PROVIDER.GOOGLE_CLOUD || (!provider && shouldUseLyriaNative(payload))) {
      await dispatchAndProcessLyriaNativeMusicRequest(payload);
    } else {
      await dispatchAndProcessLyriaAIMusicRequest(payload);
    }
  } else if (model === 'CUSTOM_TEXT_TO_MUSIC') {
    await dispatchAndProcessCustomMusicRequest(payload);
  } else {
  }
 
}
