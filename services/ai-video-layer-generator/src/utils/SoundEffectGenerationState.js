export function isStaleSoundEffectGenerationForLayer({
  model,
  isAudioVideoGeneration = false,
  currentLayer = {},
  soundEffectModels = [],
} = {}) {
  const soundEffectModelSet = new Set(soundEffectModels);

  return Boolean(
    isAudioVideoGeneration &&
    soundEffectModelSet.has(model) &&
    currentLayer?.layerAiVideoType !== 'sound_effect'
  );
}
