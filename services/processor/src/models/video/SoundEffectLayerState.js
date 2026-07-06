export function resolveLayerAiVideoTypeAfterSoundEffectRemoval(layer = {}) {
  return layer?.hasAiVideoLayer || layer?.aiVideoLayer ? 'ai_video' : 'none';
}

export function resetLayerSoundEffectState(layer = {}) {
  if (!layer || typeof layer !== 'object') {
    return layer;
  }

  layer.soundEffectVideoLayer = null;
  layer.soundEffectRemoteLink = null;
  layer.hasSoundEffectVideoLayer = false;
  layer.hasSoundEffect = false;
  layer.soundEffectGenerationPending = false;
  layer.soundEffectVideoGenerationStatus = 'INIT';
  layer.soundEffectVideoGenerationError = null;
  layer.soundEffectThumbnailPath = null;
  layer.soundEffectEndThumbnailPath = null;
  layer.soundEffectThumbnailVideo = null;
  layer.layerAISoundEffectPrompt = '';
  layer.layerAiVideoType = resolveLayerAiVideoTypeAfterSoundEffectRemoval(layer);

  return layer;
}
