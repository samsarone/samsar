function normalizeId(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = value?.toString?.().trim?.() || '';
  return normalized || null;
}

function normalizeLayerIndex(value) {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
  }
  return null;
}

function isSpeechAudioLayer(audioLayer = {}) {
  return typeof audioLayer?.generationType === 'string'
    && audioLayer.generationType.trim().toLowerCase() === 'speech';
}

function hasConnectedSpeechAudioLayer(audioLayers, layer, layerIndex) {
  const layerId = normalizeId(layer?._id);
  if (layerId && audioLayers.some((audioLayer) => (
    isSpeechAudioLayer(audioLayer)
    && normalizeId(audioLayer?.connectedLayerId) === layerId
  ))) {
    return true;
  }

  return audioLayers.some((audioLayer) => (
    isSpeechAudioLayer(audioLayer)
    && normalizeLayerIndex(audioLayer?.connectedLayerIndex) === layerIndex
  ));
}

function isActiveUserVideoUploadTask(task) {
  return task?.status === 'UPLOADING' || task?.status === 'PROCESSING';
}

export function hasBlockingLayerGenerationForRender(sessionData) {
  if (!sessionData) {
    return false;
  }

  const sessionLayers = Array.isArray(sessionData.layers) ? sessionData.layers : [];
  const hasAudioLayerState = Array.isArray(sessionData.audioLayers);
  const audioLayers = Array.isArray(sessionData.audioLayers) ? sessionData.audioLayers : [];

  return sessionLayers.some((layer, layerIndex) => (
    layer?.imageSession?.generationStatus === 'PENDING'
    || layer?.aiVideoGenerationPending
    || (
      layer?.lipSyncGenerationPending
      && (
        !hasAudioLayerState
        || hasConnectedSpeechAudioLayer(audioLayers, layer, layerIndex)
      )
    )
    || layer?.soundEffectGenerationPending
    || layer?.userVideoGenerationPending
    || layer?.videoEditPending
    || isActiveUserVideoUploadTask(layer?.userVideoUploadTask)
  ));
}
