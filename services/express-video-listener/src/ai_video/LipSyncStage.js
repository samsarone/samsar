import { isLipSyncInfrastructureFailure } from './ProviderNetworkFailure.js';

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
  // The current scene type is authoritative. A narration scene can still use
  // a character-style base image, but that must never make it lip-syncable.
  return normalizeLayerType(layer?.layerAiVideoType) === 'character';
}

export function hasReusableBaseAiVideo(layer = {}) {
  return Boolean(
    layer?.hasAiVideoLayer
    || normalizeString(layer?.aiVideoLayer)
    || normalizeString(layer?.aiVideoRemoteLink)
  );
}

export function hasUsableBaseAiVideo(layer = {}) {
  const status = normalizeStatus(layer?.aiVideoGenerationStatus);
  return layer?.hasAiVideoLayer === true
    && layer?.aiVideoGenerationPending !== true
    && status !== 'FAILED'
    && status !== 'PENDING'
    && Boolean(normalizeString(layer?.aiVideoLayer));
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
  if (
    !isCharacterLipSyncLayer(layer)
    || !connectedSpeechAudioLayer
  ) {
    return false;
  }

  const status = normalizeStatus(layer?.lipSyncVideoGenerationStatus);
  return Boolean(
    hasReusableBaseAiVideo(layer)
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

export function assessLipSyncFallback(stageAssessment = {}, {
  missingRequestTimedOut = false,
} = {}) {
  const failed = stageAssessment.failed || [];
  const incomplete = stageAssessment.incomplete || [];
  const pending = stageAssessment.pending || [];
  const infrastructureFailure = (stageAssessment.required || [...failed, ...incomplete, ...pending])
    .find(assessment => assessment.state !== 'COMPLETED' && isLipSyncInfrastructureFailure(assessment.layer));
  if (infrastructureFailure) {
    return { state: 'INFRASTRUCTURE_FAILURE', assessment: infrastructureFailure };
  }
  const unresolved = incomplete.filter((assessment) =>
    assessment?.status !== 'COMPLETED'
  );

  // A failed layer must not end the stage while another layer can still
  // produce a lip-sync output. INIT can also be the enqueue window.
  if (pending.length || (unresolved.length && !missingRequestTimedOut)) {
    return { state: 'WAIT', assessment: pending[0] || unresolved[0] };
  }

  const missing = [...failed, ...incomplete];
  if (!missing.length) {
    return { state: 'COMPLETE', assessment: null };
  }

  const withoutBase = missing.find((assessment) =>
    !hasUsableBaseAiVideo(assessment?.layer)
  );
  if (withoutBase) {
    return { state: 'NO_BASE_VIDEO', assessment: withoutBase };
  }

  return { state: 'FALLBACK', assessment: missing[0] };
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
