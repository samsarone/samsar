import {
  recalculateLayerOffsetsAndConnectedAudio,
  roundConnectedAudioSeconds,
} from './ConnectedAudioTimeline.js';

function normalizeAudioType(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export function isCustomSpeechAudioLayer(audioLayer = {}) {
  const candidateTypes = [
    audioLayer?.generationType,
    audioLayer?.libraryType === 'speech' ? audioLayer?.source : null,
    audioLayer?.sourceType,
    audioLayer?.generationMeta?.sourceType,
    audioLayer?.generationMeta?.uploadType,
  ];

  return candidateTypes.some((candidateType) => {
    const normalizedType = normalizeAudioType(candidateType);
    return normalizedType === 'custom_speech' || normalizedType === 'recorded_speech';
  });
}

function isSelectedTimelineAudioLayer(audioLayer = {}) {
  return (
    (audioLayer?.isEnabled === true || audioLayer?.defaultSelected === true)
    && audioLayer?.generationStatus !== 'PENDING'
  );
}

export function resolveAudioLayerTimelineEndTime(audioLayer = {}) {
  const startTime = Number.isFinite(Number(audioLayer?.startTime))
    ? Math.max(0, Number(audioLayer.startTime))
    : 0;
  const explicitEndTime = Number(audioLayer?.endTime);
  if (Number.isFinite(explicitEndTime) && explicitEndTime > startTime) {
    return roundConnectedAudioSeconds(explicitEndTime);
  }

  const duration = Number(audioLayer?.duration);
  if (Number.isFinite(duration) && duration > 0) {
    return roundConnectedAudioSeconds(startTime + duration);
  }

  return null;
}

function resolveSessionTimelineEndTimeFromLayers(layers = []) {
  if (!Array.isArray(layers) || layers.length === 0) {
    return 0;
  }

  const explicitEndTime = layers.reduce((maxEndTime, layer) => {
    const layerDuration = Number(layer?.duration) || 0;
    const layerOffset = Number(layer?.durationOffset) || 0;
    return Math.max(maxEndTime, layerOffset + layerDuration);
  }, 0);

  if (explicitEndTime > 0) {
    return explicitEndTime;
  }

  return layers.reduce((totalDuration, layer) => {
    return totalDuration + (Number(layer?.duration) || 0);
  }, 0);
}

export function extendSessionTimelineToEndTime(sessionData, targetEndTime) {
  const sessionLayers = Array.isArray(sessionData?.layers) ? sessionData.layers : [];
  const resolvedTargetEndTime = Number(targetEndTime);
  if (!sessionData || sessionLayers.length === 0 || !Number.isFinite(resolvedTargetEndTime)) {
    return {
      extended: false,
      currentEndTime: resolveSessionTimelineEndTimeFromLayers(sessionLayers),
      targetEndTime: Number.isFinite(resolvedTargetEndTime) ? resolvedTargetEndTime : null,
    };
  }

  const currentEndTime = resolveSessionTimelineEndTimeFromLayers(sessionLayers);
  if (resolvedTargetEndTime <= currentEndTime + 0.01) {
    return {
      extended: false,
      currentEndTime,
      targetEndTime: resolvedTargetEndTime,
    };
  }

  let lastLayer = sessionLayers[0];
  let lastLayerIndex = 0;
  let lastLayerEndTime = -Infinity;
  for (let i = 0; i < sessionLayers.length; i++) {
    const layerStartTime = Number(sessionLayers[i]?.durationOffset) || 0;
    const layerDuration = Number(sessionLayers[i]?.duration) || 0;
    const layerEndTime = layerStartTime + layerDuration;
    if (layerEndTime >= lastLayerEndTime) {
      lastLayer = sessionLayers[i];
      lastLayerIndex = i;
      lastLayerEndTime = layerEndTime;
    }
  }

  const lastLayerStartTime = Math.max(0, Number(lastLayer?.durationOffset) || 0);
  const nextDuration = roundConnectedAudioSeconds(resolvedTargetEndTime - lastLayerStartTime);
  if (!(nextDuration > 0)) {
    return {
      extended: false,
      currentEndTime,
      targetEndTime: resolvedTargetEndTime,
    };
  }

  lastLayer.duration = nextDuration;
  lastLayer.frameGenerationPending = true;
  sessionData.frameGenerationPending = true;
  sessionData.totalDuration = recalculateLayerOffsetsAndConnectedAudio(
    sessionLayers,
    Array.isArray(sessionData.audioLayers) ? sessionData.audioLayers : [],
  );

  return {
    extended: true,
    currentEndTime,
    targetEndTime: resolvedTargetEndTime,
    totalDuration: sessionData.totalDuration,
    extendedLayerId: lastLayer?._id?.toString?.() || lastLayer?._id || null,
    extendedLayerIndex: lastLayerIndex,
  };
}

export function extendSessionTimelineToCustomSpeechEnd(sessionData, audioLayers = null) {
  const candidateAudioLayers = Array.isArray(audioLayers)
    ? audioLayers
    : [
        ...(Array.isArray(sessionData?.audioLayers) ? sessionData.audioLayers : []),
        ...(Array.isArray(sessionData?.global_audio_layers) ? sessionData.global_audio_layers : []),
      ];

  const targetEndTime = candidateAudioLayers
    .filter((audioLayer) => isCustomSpeechAudioLayer(audioLayer) && isSelectedTimelineAudioLayer(audioLayer))
    .reduce((maxEndTime, audioLayer) => {
      const layerEndTime = resolveAudioLayerTimelineEndTime(audioLayer);
      return layerEndTime === null ? maxEndTime : Math.max(maxEndTime, layerEndTime);
    }, 0);

  return extendSessionTimelineToEndTime(sessionData, targetEndTime);
}
