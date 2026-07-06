function normalizePositiveSeconds(value) {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : null;
}

function getObjectIdString(value) {
  if (!value) {
    return '';
  }
  return value?.toString?.() || `${value}`;
}

function getSessionLayerTimelineDurationSeconds(sessionData = {}) {
  const layers = Array.isArray(sessionData?.layers) ? sessionData.layers : [];
  let sequentialDuration = 0;
  let maxLayerEndTime = 0;

  for (const layer of layers) {
    const duration = normalizePositiveSeconds(layer?.duration) || 0;
    sequentialDuration += duration;

    const durationOffset = normalizePositiveSeconds(layer?.durationOffset);
    const offsetEndTime = durationOffset !== null && duration > 0
      ? durationOffset + duration
      : null;
    const explicitEndTime = normalizePositiveSeconds(layer?.endTime);

    maxLayerEndTime = Math.max(
      maxLayerEndTime,
      offsetEndTime || 0,
      explicitEndTime || 0
    );
  }

  return Math.max(sequentialDuration, maxLayerEndTime);
}

export function resolveBackingTrackTargetDurationSeconds({
  sessionData = null,
  audioLayerId = null,
  requestedDuration = null,
  requestedStartTime = null,
  requestedEndTime = null,
} = {}) {
  const candidates = [];
  const addCandidate = (value) => {
    const duration = normalizePositiveSeconds(value);
    if (duration !== null) {
      candidates.push(duration);
    }
  };

  addCandidate(requestedDuration);
  addCandidate(requestedEndTime);

  const startTime = Number(requestedStartTime);
  const endTime = Number(requestedEndTime);
  if (Number.isFinite(startTime) && startTime >= 0 && Number.isFinite(endTime) && endTime > startTime) {
    addCandidate(endTime - startTime);
  }

  if (sessionData) {
    addCandidate(sessionData.totalDuration);
    addCandidate(sessionData.expressGenerationBillingDurationSeconds);
    addCandidate(getSessionLayerTimelineDurationSeconds(sessionData));

    const requestedAudioLayerId = getObjectIdString(audioLayerId);
    if (requestedAudioLayerId && Array.isArray(sessionData.audioLayers)) {
      const matchingAudioLayer = sessionData.audioLayers.find((layer) => (
        getObjectIdString(layer?._id) === requestedAudioLayerId
      ));

      if (matchingAudioLayer) {
        addCandidate(matchingAudioLayer.duration);
        addCandidate(matchingAudioLayer.endTime);
      }
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  return Number(Math.max(...candidates).toFixed(6));
}

export function buildBackingTrackGenerationMeta(generationMeta = {}, targetDurationSeconds = null) {
  const normalizedGenerationMeta = generationMeta && typeof generationMeta === 'object'
    ? { ...generationMeta }
    : {};
  const normalizedTargetDuration = normalizePositiveSeconds(targetDurationSeconds);

  return {
    ...normalizedGenerationMeta,
    isBackingTrack: true,
    ...(normalizedTargetDuration !== null
      ? {
          targetDurationSeconds: normalizedTargetDuration,
          fullTimelineDurationSeconds: normalizedTargetDuration,
          durationIncludesOutro: true,
        }
      : {}),
  };
}
