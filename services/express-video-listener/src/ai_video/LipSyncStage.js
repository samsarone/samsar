function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStatus(value) {
  return normalizeString(value).toUpperCase();
}

function normalizeLayerType(value) {
  return normalizeString(value).toLowerCase();
}

function normalizeId(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = value?.toString?.().trim?.() || '';
  return normalized || null;
}

function normalizeOptionalInteger(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
  }
  return null;
}

export function isCharacterLipSyncLayer(layer = {}) {
  // layerAiVideoType was historically changed to `ai_video` when lip sync
  // could not be queued. The base image type preserves the original intent.
  return normalizeLayerType(layer?.layerBaseAiImageType) === 'character'
    || normalizeLayerType(layer?.layerAiVideoType) === 'character';
}

export function hasReusableBaseAiVideo(layer = {}) {
  return Boolean(
    layer?.hasAiVideoLayer
    || normalizeString(layer?.aiVideoLayer)
    || normalizeString(layer?.aiVideoRemoteLink)
  );
}

export function hasLipSyncOutput(layer = {}) {
  return Boolean(
    layer?.hasLipSyncVideoLayer
    && (
      normalizeString(layer?.lipSyncVideoLayer)
      || normalizeString(layer?.lipSyncRemoteLink)
    )
  );
}

function isSpeechAudioLayer(audioLayer = {}) {
  return normalizeLayerType(audioLayer?.generationType) === 'speech';
}

export function findConnectedSpeechAudioLayer(
  sessionAudioLayers = [],
  currentLayer = {},
  layerIndex = -1,
) {
  const speechAudioLayers = Array.isArray(sessionAudioLayers)
    ? sessionAudioLayers.filter(isSpeechAudioLayer)
    : [];
  const currentLayerId = normalizeId(currentLayer?._id);

  if (currentLayerId) {
    const connectedById = speechAudioLayers.find((audioLayer) =>
      normalizeId(audioLayer?.connectedLayerId) === currentLayerId
    );
    if (connectedById) {
      return connectedById;
    }
  }

  if (!Number.isInteger(layerIndex) || layerIndex < 0) {
    return null;
  }

  return speechAudioLayers.find((audioLayer) =>
    normalizeOptionalInteger(audioLayer?.connectedLayerIndex) === layerIndex
  ) || null;
}

function isTrackedLipSyncLayer(layer = {}, connectedSpeechAudioLayer = null) {
  if (!isCharacterLipSyncLayer(layer) || !hasReusableBaseAiVideo(layer)) {
    return false;
  }

  const status = normalizeStatus(layer?.lipSyncVideoGenerationStatus);
  return Boolean(
    connectedSpeechAudioLayer
    || layer?.lipSyncGenerationPending
    || hasLipSyncOutput(layer)
    || (status && status !== 'INIT')
  );
}

export function assessLipSyncStage(layers = [], audioLayers = []) {
  const assessments = [];
  const safeLayers = Array.isArray(layers) ? layers : [];

  safeLayers.forEach((layer, layerIndex) => {
    const connectedSpeechAudioLayer = findConnectedSpeechAudioLayer(
      audioLayers,
      layer,
      layerIndex,
    );
    if (!isTrackedLipSyncLayer(layer, connectedSpeechAudioLayer)) {
      return;
    }

    const status = normalizeStatus(layer?.lipSyncVideoGenerationStatus) || 'INIT';
    const hasOutput = hasLipSyncOutput(layer);
    let state = 'INCOMPLETE';
    if (status === 'FAILED') {
      state = 'FAILED';
    } else if (status === 'COMPLETED' && hasOutput) {
      state = 'COMPLETED';
    } else if (layer?.lipSyncGenerationPending || status === 'PENDING') {
      state = 'PENDING';
    }

    assessments.push({
      layer,
      layerIndex,
      layerId: normalizeId(layer?._id),
      audioLayer: connectedSpeechAudioLayer,
      audioLayerId: normalizeId(connectedSpeechAudioLayer?._id),
      status,
      hasOutput,
      state,
    });
  });

  const failed = assessments.filter((assessment) => assessment.state === 'FAILED');
  const incomplete = assessments.filter((assessment) => assessment.state === 'INCOMPLETE');
  const pending = assessments.filter((assessment) => assessment.state === 'PENDING');
  const completed = assessments.filter((assessment) => assessment.state === 'COMPLETED');

  let state = 'NOT_REQUIRED';
  if (failed.length) {
    state = 'FAILED';
  } else if (incomplete.length) {
    state = 'INCOMPLETE';
  } else if (pending.length) {
    state = 'PENDING';
  } else if (assessments.length && completed.length === assessments.length) {
    state = 'COMPLETED';
  }

  return {
    state,
    required: assessments,
    failed,
    incomplete,
    pending,
    completed,
  };
}

export function getLipSyncFailureMessage(assessment = {}) {
  const layer = assessment?.layer || {};
  const layerId = assessment?.layerId || normalizeId(layer?._id) || 'unknown';
  const existingError = normalizeString(
    layer?.lipSyncVideoGenerationError
    || layer?.lipSyncGenerationError,
  );
  if (existingError) {
    return existingError;
  }
  if (!assessment?.audioLayer) {
    return `Lip sync input is missing a connected speech audio layer for character layer ${layerId}.`;
  }
  if (normalizeStatus(layer?.lipSyncVideoGenerationStatus) === 'COMPLETED') {
    return `Lip sync completed without a reusable output for character layer ${layerId}.`;
  }
  return `Lip sync generation ended without a completed output for character layer ${layerId}.`;
}
