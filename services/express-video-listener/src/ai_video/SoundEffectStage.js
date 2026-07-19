function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStatus(value) {
  return normalizeString(value).toUpperCase();
}

function normalizeType(value) {
  return normalizeString(value).toLowerCase();
}

function normalizeId(value) {
  const normalized = value?.toString?.().trim?.() || '';
  return normalized || null;
}

export function isSoundEffectLayer(layer = {}) {
  // Terminal failures historically rewrite layerAiVideoType to `ai_video`.
  // The base type retains the layer's original sound-effect intent.
  return normalizeType(layer?.layerBaseAiImageType) === 'sound_effect'
    || normalizeType(layer?.layerAiVideoType) === 'sound_effect';
}

export function hasReusableBaseAiVideo(layer = {}) {
  return Boolean(
    layer?.hasAiVideoLayer
    || normalizeString(layer?.aiVideoLayer)
    || normalizeString(layer?.aiVideoRemoteLink)
  );
}

export function hasSoundEffectOutput(layer = {}) {
  return Boolean(
    layer?.hasSoundEffectVideoLayer
    && (
      normalizeString(layer?.soundEffectVideoLayer)
      || normalizeString(layer?.soundEffectRemoteLink)
    )
  );
}

function isTrackedSoundEffectLayer(layer = {}) {
  return Boolean(
    !layer?.isAudioVideoLayer
    && isSoundEffectLayer(layer)
    && hasReusableBaseAiVideo(layer)
  );
}

export function assessSoundEffectStage(layers = []) {
  const assessments = (Array.isArray(layers) ? layers : [])
    .filter(isTrackedSoundEffectLayer)
    .map((layer, layerIndex) => {
      const status = normalizeStatus(layer?.soundEffectVideoGenerationStatus) || 'INIT';
      const hasOutput = hasSoundEffectOutput(layer);
      let state = 'INCOMPLETE';
      if (status === 'FAILED') {
        state = 'FAILED';
      } else if (status === 'COMPLETED' && hasOutput) {
        state = 'COMPLETED';
      } else if (layer?.soundEffectGenerationPending || status === 'PENDING') {
        state = 'PENDING';
      }
      return {
        layer,
        layerIndex,
        layerId: normalizeId(layer?._id),
        status,
        hasOutput,
        state,
      };
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

  return { state, required: assessments, failed, incomplete, pending, completed };
}

export function getSoundEffectFailureMessage(assessment = {}) {
  const layer = assessment?.layer || {};
  const layerId = assessment?.layerId || normalizeId(layer?._id) || 'unknown';
  const existingError = normalizeString(
    layer?.soundEffectVideoGenerationError
    || layer?.soundEffectGenerationError,
  );
  if (existingError) {
    return existingError;
  }
  if (normalizeStatus(layer?.soundEffectVideoGenerationStatus) === 'COMPLETED') {
    return `Sound-effect generation completed without a reusable output for layer ${layerId}.`;
  }
  return `Sound-effect generation ended without a completed output for layer ${layerId}.`;
}
