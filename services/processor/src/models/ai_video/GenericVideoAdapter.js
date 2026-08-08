import { isProductionEdition } from '../../utils/EnvironmentUtils.js';

export function getInitialGenericVideoAdapter(model, env = process.env) {
  if (
    (model === 'SEEDANCE2.0I2V' || model === 'SEEDANCE2.5I2V') &&
    isProductionEdition(env)
  ) {
    return 'gmicloud';
  }
  return '';
}

export function resolveGenericVideoAudioContext(payload = {}, currentLayer = {}) {
  const currentLayerType = typeof currentLayer?.layerAiVideoType === 'string'
    ? currentLayer.layerAiVideoType.trim().toLowerCase()
    : '';
  const payloadLayerType = typeof payload.layerAiVideoType === 'string'
    ? payload.layerAiVideoType.trim().toLowerCase()
    : '';
  const payloadGenerationType = typeof payload.generationType === 'string'
    ? payload.generationType.trim().toLowerCase()
    : '';
  const isSeedance25 = payload.model === 'SEEDANCE2.5I2V';

  if (!isSeedance25) {
    const isPayloadSoundEffectLayer = payloadGenerationType === 'sound_effect' ||
      payloadLayerType === 'sound_effect';
    return {
      generateAudio: Boolean(
      payload.generateAudio === true ||
      payload.generate_audio === true ||
      payload.isAudioVideoGeneration === true ||
        isPayloadSoundEffectLayer,
      ),
      generationType: payload.generationType || payload.layerAiVideoType,
      layerAiVideoType: payload.layerAiVideoType,
    };
  }

  const layerSceneType = currentLayerType || payloadLayerType || payloadGenerationType;

  return {
    generateAudio: layerSceneType === 'sound_effect',
    generationType: layerSceneType || payload.generationType || payload.layerAiVideoType,
    layerAiVideoType: layerSceneType || payload.layerAiVideoType,
  };
}
