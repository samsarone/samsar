import {
  CUSTOM_AUDIO_ADAPTER_TYPES,
  listenToPendingCustomAudioRequest,
  submitCustomAudioRequest,
} from '../custom/CustomFalCompatibleAudio.js';

export function generateCustomSoundEffectLayer(payload) {
  return submitCustomAudioRequest(payload, CUSTOM_AUDIO_ADAPTER_TYPES.TEXT_TO_SOUND_EFFECT);
}

export function listenToPendingCustomSoundEffectRequest(payload) {
  return listenToPendingCustomAudioRequest(payload, CUSTOM_AUDIO_ADAPTER_TYPES.TEXT_TO_SOUND_EFFECT);
}
