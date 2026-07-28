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

export function hasConnectedSpeechAudioLayer(audioLayers, layer, layerIndex) {
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

/**
 * Clears legacy per-layer lip-sync pending flags after their speech source is
 * removed or reclassified. Completed lip-sync outputs are preserved.
 */
export function reconcileOrphanedLipSyncGenerationState(sessionData = {}) {
  const layers = Array.isArray(sessionData?.layers) ? sessionData.layers : [];
  const audioLayers = Array.isArray(sessionData?.audioLayers) ? sessionData.audioLayers : [];
  const clearedLayerIds = [];

  layers.forEach((layer, layerIndex) => {
    if (
      !layer?.lipSyncGenerationPending
      || hasConnectedSpeechAudioLayer(audioLayers, layer, layerIndex)
    ) {
      return;
    }

    layer.lipSyncGenerationPending = false;
    if (
      !layer?.hasLipSyncVideoLayer
      && ['INIT', 'PENDING'].includes(
        typeof layer?.lipSyncVideoGenerationStatus === 'string'
          ? layer.lipSyncVideoGenerationStatus.trim().toUpperCase()
          : 'INIT'
      )
    ) {
      layer.lipSyncVideoGenerationStatus = 'INIT';
      layer.lipSyncVideoGenerationError = null;
    }

    clearedLayerIds.push(normalizeId(layer?._id) || `layer-${layerIndex}`);
  });

  const hasPendingLipSync = layers.some((layer) => Boolean(layer?.lipSyncGenerationPending));
  if (
    sessionData?.lipSyncGenerationPending !== undefined
    && sessionData.lipSyncGenerationPending !== hasPendingLipSync
  ) {
    sessionData.lipSyncGenerationPending = hasPendingLipSync;
  }

  return {
    changed: clearedLayerIds.length > 0,
    clearedLayerIds,
    hasPendingLipSync,
  };
}
