import { getDBConnectionString } from "../DBString.js";
import AudioGeneration from '../schema/AudioGeneration.js';
import { processOpenAISpeechRequest } from './OpenAI.js';
import { processOpenAITTSSpeechRequest } from './OpenAITTS.js';
import { processPlayAISpeechRequest } from './PlayAI.js';
import { processGoogleTTSSpeechRequest } from './GoogleTTS.js';

import { processElevenLabsFalSpeechRequest } from "./ElevenLabsFal.js";
import { hasNativeElevenLabsSpeechCredential, processElevenLabsSpeechRequest } from './ElevenLabs.js';
import { SPEAKERS as ELEVENLABS_SPEAKERS } from './ElevenLabsSpeakers.js';
import { processCustomTextToSpeechRequest } from './CustomTextToSpeech.js';
import { recordProviderUsageLog } from '../utils/ProviderUsageAudit.js';
import {
  DOCKER_AUDIO_PROVIDER,
  getGenBlazeSpeechLogicalModel,
  hasDockerSpeechProviderPriority,
  isInitialDockerAudioRoutingRequest,
  resolveDockerSpeechProvider,
} from '../consts/DockerProviderPriority.js';
import {
  processSamsarExternalSpeechRequest,
} from '../external/SamsarExternalAudioAdapter.js';
import { processGenBlazeSpeechRequest } from './GenBlazeSpeech.js';
import { isStandaloneEdition } from '../util/environmentUtils.js';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function shouldUseNativeElevenLabsSpeech() {
  if (!hasNativeElevenLabsSpeechCredential()) {
    return false;
  }

  const preference = normalizeString(process.env.ELEVENLABS_TTS_PROVIDER).toLowerCase();
  if (['native', 'elevenlabs', 'direct'].includes(preference)) {
    return true;
  }
  if (['fal', 'fal-ai', 'fal_ai'].includes(preference)) {
    return false;
  }

  return isStandaloneEdition() && !normalizeString(process.env.FAL_API_KEY);
}

function normalizeTTSProvider(provider, speakerValue = '') {
  const rawProvider =
    typeof provider === 'string'
      ? provider
      : typeof provider?.value === 'string'
        ? provider.value
        : '';
  const normalizedProvider = rawProvider.trim().toUpperCase();

  if (normalizedProvider === 'OPENAI') {
    return 'OPENAI';
  }

  if (normalizedProvider === 'PLAYAI' || normalizedProvider === 'PLAYHT') {
    return 'PLAYAI';
  }

  if (normalizedProvider === 'GOOGLE' || normalizedProvider === 'GOOGLE_TTS') {
    return 'GOOGLE';
  }

  if (
    normalizedProvider === 'CUSTOM_TEXT_TO_SPEECH' ||
    normalizedProvider === 'CUSTOMTTS'
  ) {
    return 'CUSTOM_TEXT_TO_SPEECH';
  }

  if (
    normalizedProvider === 'ELEVENLABS' ||
    normalizedProvider === 'ELEVENLABS_FAL' ||
    normalizedProvider === 'ELEVENLABSFAL' ||
    normalizedProvider === 'ELEVEN'
  ) {
    return 'ELEVENLABS';
  }

  if (ELEVENLABS_SPEAKERS.some((speaker) => speaker.value === speakerValue)) {
    return 'ELEVENLABS';
  }

  return 'OPENAI';
}

function normalizeSpeechRequestPayload(speechRequest, normalizedTtsProvider) {
  const payload =
    speechRequest && typeof speechRequest.toObject === 'function'
      ? speechRequest.toObject()
      : speechRequest?._doc
        ? { ...speechRequest._doc }
        : { ...speechRequest };

  return {
    ...payload,
    ttsProvider: normalizedTtsProvider,
  };
}

export function resolveSpeechProvider(normalizedTtsProvider, payload = {}) {
  if (normalizedTtsProvider === 'CUSTOM_TEXT_TO_SPEECH') {
    return '';
  }

  const dockerProvider = resolveDockerSpeechProvider(normalizedTtsProvider, payload);
  if (dockerProvider) {
    return dockerProvider;
  }

  if (normalizedTtsProvider === 'OPENAI') {
    return DOCKER_AUDIO_PROVIDER.OPENAI;
  }
  if (normalizedTtsProvider === 'PLAYAI') {
    return DOCKER_AUDIO_PROVIDER.FAL;
  }
  if (normalizedTtsProvider === 'GOOGLE') {
    return DOCKER_AUDIO_PROVIDER.GOOGLE_CLOUD;
  }
  if (normalizedTtsProvider === 'ELEVENLABS') {
    return shouldUseNativeElevenLabsSpeech()
      ? DOCKER_AUDIO_PROVIDER.ELEVENLABS
      : DOCKER_AUDIO_PROVIDER.FAL;
  }
  return '';
}

async function recordSpeechProviderUsage(payload, normalizedTtsProvider) {
  if (normalizeString(payload?.status || 'INIT').toUpperCase() !== 'INIT') {
    return;
  }
  const provider = resolveSpeechProvider(normalizedTtsProvider, payload);
  if (!provider) {
    return;
  }
  await recordProviderUsageLog({
    payload,
    requestType: 'text_to_speech',
    callType: 'text_to_speech',
    provider,
    model: provider === DOCKER_AUDIO_PROVIDER.GMICLOUD
      ? getGenBlazeSpeechLogicalModel(normalizedTtsProvider)
      : payload?.model || normalizedTtsProvider,
    source: 'speech_generator',
    service: 'samsar_audio_generator',
    status: 'requested',
    metadata: {
      speaker: payload?.speaker,
      ttsProvider: normalizedTtsProvider,
      languageCode: payload?.languageCode,
    },
  });
}

export async function dispatchSpeechRequest(speechRequest) {

  await getDBConnectionString();

  const { ttsProvider } = speechRequest;
  const normalizedTtsProvider = normalizeTTSProvider(ttsProvider, speechRequest?.speaker);
  const normalizedSpeechRequest = normalizeSpeechRequestPayload(speechRequest, normalizedTtsProvider);
  const provider = resolveSpeechProvider(normalizedTtsProvider, normalizedSpeechRequest);
  const submittedAdapter = provider || (
    normalizedTtsProvider === 'CUSTOM_TEXT_TO_SPEECH'
      ? DOCKER_AUDIO_PROVIDER.CUSTOM
      : ''
  );

  if (
    normalizeString(normalizedSpeechRequest?.status || 'INIT').toUpperCase() === 'INIT' &&
    submittedAdapter &&
    normalizedSpeechRequest?._id
  ) {
    normalizedSpeechRequest.submittedAdapter = submittedAdapter;
    await AudioGeneration.findByIdAndUpdate(
      normalizedSpeechRequest._id,
      { submittedAdapter },
    );
  }

  await recordSpeechProviderUsage(normalizedSpeechRequest, normalizedTtsProvider);

  if (
    !provider &&
    isInitialDockerAudioRoutingRequest(normalizedSpeechRequest) &&
    hasDockerSpeechProviderPriority(normalizedTtsProvider)
  ) {
    throw new Error(`No configured Docker speech provider for ${normalizedTtsProvider}.`);
  }

  if (provider === DOCKER_AUDIO_PROVIDER.SAMSAR) {
    await processSamsarExternalSpeechRequest(normalizedSpeechRequest);
  } else if (provider === DOCKER_AUDIO_PROVIDER.GMICLOUD) {
    await processGenBlazeSpeechRequest(normalizedSpeechRequest);
  } else if (normalizedTtsProvider === 'OPENAI') {
    await processOpenAITTSSpeechRequest(normalizedSpeechRequest);
  } else if (normalizedTtsProvider === 'PLAYAI') {
    await processPlayAISpeechRequest(normalizedSpeechRequest);
  } else if (normalizedTtsProvider === 'GOOGLE') {
    await processGoogleTTSSpeechRequest(normalizedSpeechRequest);
  } else if (normalizedTtsProvider === 'ELEVENLABS') {
    if (provider === DOCKER_AUDIO_PROVIDER.ELEVENLABS) {
      await processElevenLabsSpeechRequest(normalizedSpeechRequest);
    } else {
      await processElevenLabsFalSpeechRequest(normalizedSpeechRequest);
    }
  } else if (normalizedTtsProvider === 'CUSTOM_TEXT_TO_SPEECH') {
    await processCustomTextToSpeechRequest(normalizedSpeechRequest);
  }
}
