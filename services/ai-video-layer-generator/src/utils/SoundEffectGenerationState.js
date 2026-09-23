export function isSoundEffectGenerationForLayer(currentLayer = {}, generationType = '') {
  return currentLayer?.layerAiVideoType === 'sound_effect' || (
    currentLayer?.layerBaseAiImageType === 'sound_effect' &&
    ((currentLayer?.isAudioVideoLayer === true && currentLayer?.aiVideoGenerationPending === true) ||
      (generationType === 'sound_effect' && currentLayer?.soundEffectGenerationPending === true))
  );
}

export function isStaleSoundEffectGenerationForLayer({
  model,
  isAudioVideoGeneration = false,
  generationType = '',
  currentLayer = {},
  soundEffectModels = [],
} = {}) {
  const soundEffectModelSet = new Set(soundEffectModels);

  return Boolean(
    isAudioVideoGeneration &&
    soundEffectModelSet.has(model) &&
    !isSoundEffectGenerationForLayer(currentLayer, generationType)
  );
}
