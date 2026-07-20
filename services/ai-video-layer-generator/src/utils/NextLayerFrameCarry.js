function layerHasVideoVisual(layer = {}) {
  return Boolean(
    layer.userVideoGenerationPending
    || layer.layerAiVideoType === 'user_video'
    || layer.hasUserVideoLayer
    || layer.userVideoLayer
    || layer.hasAiVideoLayer
    || layer.aiVideoLayer
    || layer.hasLipSyncVideoLayer
    || layer.lipSyncVideoLayer
    || layer.hasSoundEffectVideoLayer
    || layer.soundEffectVideoLayer
  );
}

/**
 * Carrying the generated final frame into the next scene is a legacy continuity
 * feature. It must only run for an explicit "combine layers" request and must
 * never replace a layer that already has a video as its visual base.
 */
export function shouldCarryGeneratedLastFrameToNextLayer(payload = {}, nextLayer = null) {
  return Boolean(
    payload.endImage
    && payload.combineLayers === true
    && nextLayer
    && !layerHasVideoVisual(nextLayer)
  );
}

export const __testOnly__ = {
  layerHasVideoVisual,
};
