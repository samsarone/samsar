function normalizeBindingMode(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isStudioUnboundSpeechLayer(audioLayer = {}) {
  const bindingMode = normalizeBindingMode(audioLayer.audioBindingMode);

  return audioLayer.studioSpeechGeneration === true
    || audioLayer.bindToLayer === false
    || bindingMode === 'unbound'
    || bindingMode === 'unbounded'
    || bindingMode === 'timeline';
}

export function resolveSpeechLayerTimingUpdate({ videoSession, audioLayer, duration }) {
  const safeDuration = Number.isFinite(Number(duration)) && Number(duration) > 0
    ? Number(duration)
    : 0;
  const isUnboundStudioSpeech = isStudioUnboundSpeechLayer(audioLayer);
  let audioLayerStartTime = typeof audioLayer.startTime === 'number' ? audioLayer.startTime : 0;
  let audioLayerEndTime = audioLayerStartTime + safeDuration;
  let connectedLayerStartTimeOffset = typeof audioLayer.connectedLayerStartTimeOffset === 'number'
    ? audioLayer.connectedLayerStartTimeOffset
    : 0;

  if (
    !isUnboundStudioSpeech
    && videoSession?.isExpressGeneration
    && audioLayer?.generationType === 'speech'
    && audioLayer?.connectedLayerId
  ) {
    const connectedLayer = videoSession.layers.find(
      (layer) => layer._id.toString() === audioLayer.connectedLayerId
    );
    if (connectedLayer) {
      const layerStartTime = Number(connectedLayer.durationOffset) || 0;
      const layerDuration = Number(connectedLayer.duration) || 0;
      const durationDiff = layerDuration - safeDuration;
      connectedLayerStartTimeOffset = durationDiff > 0 ? (durationDiff / 2) : 0;
      audioLayerStartTime = layerStartTime + connectedLayerStartTimeOffset;
      audioLayerEndTime = audioLayerStartTime + safeDuration;
    }
  }

  const set = {
    'audioLayers.$.duration': safeDuration,
    'audioLayers.$.originalDuration': safeDuration,
    'audioLayers.$.startTime': audioLayerStartTime,
    'audioLayers.$.endTime': audioLayerEndTime,
  };
  const unset = {};

  if (isUnboundStudioSpeech) {
    set['audioLayers.$.audioBindingMode'] = 'unbounded';
    set['audioLayers.$.bindToLayer'] = false;
    set['audioLayers.$.studioSpeechGeneration'] = true;
    unset['audioLayers.$.connectedLayerId'] = '';
    unset['audioLayers.$.connectedLayerIndex'] = '';
    unset['audioLayers.$.connectedLayerStartTimeOffset'] = '';
  } else {
    set['audioLayers.$.connectedLayerStartTimeOffset'] = connectedLayerStartTimeOffset;
  }

  return { set, unset };
}
