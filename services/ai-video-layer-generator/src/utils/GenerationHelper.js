import { getDBConnectionString } from "../DBString.js";
import { getFramesPerSecondFromValue } from './FpsUtils.js';

export async function adjustDurationsAndOffsetsForSubsequentLayers(sessionData, currentLayerIndex, durationDiff) {
  const layers = sessionData.layers;
  await getDBConnectionString();

  
  // Recalculate durationOffset for layers
  let durationOffset = 0;
  for (let i = 0; i < layers.length; i++) {
    if (i === 0) {
      layers[i].durationOffset = 0;
    } else {
      durationOffset += layers[i - 1].duration;
      layers[i].durationOffset = durationOffset;
    }
  }

  // Adjust timing of audio layers if necessary
  if (sessionData.audioLayers) {
    for (let audioLayer of sessionData.audioLayers) {
      if (audioLayer.startTime >= layers[currentLayerIndex + 1]?.durationOffset) {
        // Adjust startTime and endTime
        audioLayer.startTime += durationDiff;
        if (audioLayer.endTime != null) {
          audioLayer.endTime += durationDiff;
        } else {
          audioLayer.duration += durationDiff;
        }
      }
    }
  }

  // Save the updated session data
  await sessionData.save();
}

export async function adjustFrameOffsetsAndDurations(
  sessionData,
  currentLayerIndex,
  durationDiff,
  framesPerSecond
) {
  const effectiveFramesPerSecond = getFramesPerSecondFromValue(framesPerSecond);

  await getDBConnectionString();

  // Adjust nested elements in the current layer
  let currentLayer = sessionData.layers[currentLayerIndex];
  const frameDurationRatio = currentLayer.duration / (currentLayer.duration - durationDiff);

  let activeItemList = currentLayer.imageSession.activeItemList;
  if (activeItemList) {
    for (let item of activeItemList) {
      if (item.config) {
        // Scale frameOffset and frameDuration
        if (item.config.frameOffset != null) {
          item.config.frameOffset = Math.round(item.config.frameOffset * frameDurationRatio);
        }
        if (item.config.frameDuration != null) {
          item.config.frameDuration = Math.round(item.config.frameDuration * frameDurationRatio);
        }
      }
    }
  }

  // Adjust frameOffsets for subsequent layers
  for (let i = currentLayerIndex + 1; i < sessionData.layers.length; i++) {
    let layer = sessionData.layers[i];
    let layerActiveItemList = layer.imageSession.activeItemList;
    if (layerActiveItemList) {
      for (let item of layerActiveItemList) {
        if (item.config && item.config.frameOffset != null) {
          // Shift frameOffset by durationDiff in frames
          item.config.frameOffset += Math.round(durationDiff * effectiveFramesPerSecond);
        }
        // frameDuration remains unchanged unless layer's duration changes
      }
    }

    // Mark layer for frame regeneration
    layer.frameGenerationPending = true;
  }

  // Save the updated session data
  await sessionData.save();
}
