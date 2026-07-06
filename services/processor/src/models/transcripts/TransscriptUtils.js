import { getDBConnectionString } from "../DBString.js";

import VideoSession from '../../schema/VideoSession.js';
import { getSessionFramesPerSecond } from '../../utils/FpsUtils.js';

export async function addSubtitlesForSessionForAudio(sessionId, audioLayerId, rawLayers) {

  
  // Get the session data
  const session = await VideoSession.findById(sessionId);
  const framesPerSecond = getSessionFramesPerSecond(
    session,
    'TransscriptUtils.addSubtitlesForSessionForAudio'
  );

  // Find the audioLayer in the session layers
  const audioLayer = session.audioLayers.find(
    (layer) => layer._id.toString() === audioLayerId
  );

  if (!audioLayer) {
    console.error('Audio Layer not found');
    return;
  }



  // Get all session layers
  const sessionLayers = session.layers;

  const audioLayerStartTime = audioLayer.startTime;
  const audioLayerEndTime = audioLayer.endTime;

  const audioLayerFrameStartTime = audioLayerStartTime * framesPerSecond;
  const audioLayerFrameEndTime = audioLayerEndTime * framesPerSecond;
  // For each subtitle item in rawLayers
  for (const subtitleItem of rawLayers) {
    // The subtitleItem has config.frameOffset and config.frameDuration
    // Convert frame offset and duration to absolute times (in seconds)



    const subtitleStartFrame = audioLayerFrameStartTime + subtitleItem.config.frameOffset; // frame number
    const subtitleDurationFrames = subtitleItem.config.frameDuration; // frame count
    const subtitleEndFrame = subtitleStartFrame + subtitleDurationFrames; // end frame number

    // Convert frames to time in seconds
    const subtitleStartTime = subtitleStartFrame / framesPerSecond;
    const subtitleEndTime = subtitleEndFrame / framesPerSecond;

    // For each layer in session layers
    for (const layer of sessionLayers) {
      const layerStartTime = layer.durationOffset || 0; // in seconds
      const layerEndTime = (layer.durationOffset || 0) + (layer.duration || 0); // in seconds

      // Check if there is an overlap between subtitle time and layer time
      const overlapStartTime = Math.max(subtitleStartTime, layerStartTime);
      const overlapEndTime = Math.min(subtitleEndTime, layerEndTime);


      if (overlapStartTime < overlapEndTime) {

        // There is overlap
        // Calculate adjusted frameOffset and frameDuration within the layer
        const adjustedFrameOffset = (overlapStartTime - layerStartTime) * framesPerSecond; // frames relative to layer
        const adjustedFrameDuration = (overlapEndTime - overlapStartTime) * framesPerSecond; // frame count within layer

        // Clone the subtitle item and adjust frameOffset and frameDuration
        const adjustedSubtitleItem = { ...subtitleItem };
        adjustedSubtitleItem.config = { ...subtitleItem.config };
        adjustedSubtitleItem.config.frameOffset = Math.floor(adjustedFrameOffset);
        adjustedSubtitleItem.config.frameDuration = Math.floor(adjustedFrameDuration);

        // Assign a unique id to the adjustedSubtitleItem
        adjustedSubtitleItem.id = `subtitle_${Math.random().toString(36).substr(2, 5)}`;

        // Ensure the layer has an imageSession with an activeItemList
        if (!layer.imageSession) {
          layer.imageSession = { activeItemList: [] };
        } else if (!layer.imageSession.activeItemList) {
          layer.imageSession.activeItemList = [];
        }

        // Add the adjusted subtitle item to the layer's activeItemList
        layer.imageSession.activeItemList.push(adjustedSubtitleItem);
      }
    }
  }

  // Save the session data
  await session.save();
}



export async function updateSubtitlesForSessionForAudio(sessionId, audioLayerId) {
  await getDBConnectionString

  const session = await VideoSession.findById(sessionId);

  const audioLayer = session.layers.filter(layer => layer.generationType === 'speech' && layer._id === audioLayerId);

  const sessionLayers = session.layers;
  const audioLayerStartTime = audioLayer.startTime;

  const audioLayerEndTime = audioLayer.endTime;

  for (let i =0;  i < layers.length; i++) {
    const layer = layers[i];
    const layerStartTime = layer.durationOffset;
    const layerEndTime = layer.durationOffset + layer.duration;
    if (layerStartTime >= audioLayerStartTime && layerEndTime <= audioLayerEndTime) {
    

    }
  }
}



export async function updateSubtitlesForAudioLayers(sessionId, audioLayerId) {

}




export async function addSubtitlesForAudioLayer(sessionId, audioLayerId, rawLayers) {

  const session = await VideoSession.findById(sessionId);
  const framesPerSecond = getSessionFramesPerSecond(
    session,
    'TransscriptUtils.addSubtitlesForAudioLayer'
  );

  // Find the audioLayer in the session layers
  const audioLayer = session.audioLayers.find(
    (layer) => layer._id.toString() === audioLayerId.toString()
  );

  if (!audioLayer) {
    console.error('Audio Layer not found');
    return;
  }

  // Get all session layers
  let sessionLayers = session.layers;

  // Get audio layer's start and end time in seconds
  const audioLayerStartTime = audioLayer.startTime;
  const audioLayerEndTime = audioLayer.endTime;

  // Convert to frames
  const audioLayerFrameStart = audioLayerStartTime * framesPerSecond;
  const audioLayerFrameEnd = audioLayerEndTime * framesPerSecond;

  // Initialize framesDisplayed for each subtitleItem
  const subtitleItems = rawLayers.map(item => ({
    ...item,
    framesDisplayed: 0 // New property to track frames displayed for this subtitle
  }));

  // Loop over the session layers
  for (let layer of sessionLayers) {
    const layerStartTime = layer.durationOffset || 0; // in seconds
    const layerEndTime = (layer.durationOffset || 0) + (layer.duration || 0); // in seconds

    const layerStartFrame = layerStartTime * framesPerSecond;
    const layerEndFrame = layerEndTime * framesPerSecond;

    // Check if layer overlaps with audio layer
    const overlapLayerStartFrame = Math.max(layerStartFrame, audioLayerFrameStart);
    const overlapLayerEndFrame = Math.min(layerEndFrame, audioLayerFrameEnd);

    if (overlapLayerStartFrame >= overlapLayerEndFrame) {
      // No overlap between this layer and the audio layer
      continue;
    }

    // For each subtitleItem
    for (const subtitleItem of subtitleItems) {


      // If the subtitle has already been fully displayed, skip
      if (subtitleItem.framesDisplayed >= subtitleItem.config.frameDuration) {
        continue;
      }

      // Absolute start and end frames of the subtitle
      const subtitleAbsoluteStartFrame = audioLayerFrameStart + subtitleItem.config.frameOffset;
      const subtitleAbsoluteEndFrame = subtitleAbsoluteStartFrame + subtitleItem.config.frameDuration;

      // Compute the overlap between subtitle and current layer in frames
      const overlapStartFrame = Math.max(subtitleAbsoluteStartFrame, layerStartFrame);
      const overlapEndFrame = Math.min(subtitleAbsoluteEndFrame, layerEndFrame);

      const overlapFrames = overlapEndFrame - overlapStartFrame;

      if (overlapFrames <= 0) {
        // No overlap between subtitle and layer
        continue;
      }

      // Calculate how many frames of the subtitle remain to be displayed
      const framesRemaining = subtitleItem.config.frameDuration - subtitleItem.framesDisplayed;

      // The number of frames we can display in this layer is the minimum of the overlap and frames remaining
      const adjustedFrameDuration = Math.min(overlapFrames, framesRemaining);

      if (adjustedFrameDuration <= 0) {
        continue; // Skip if there's no duration to display
      }

      // Adjusted frameOffset within this layer
      const adjustedFrameOffset = overlapStartFrame - layerStartFrame;

      // Create a new subtitle item for this layer
      const adjustedSubtitleItem = { ...subtitleItem };
      adjustedSubtitleItem.config = { ...subtitleItem.config };
      adjustedSubtitleItem.config.frameOffset = Math.floor(adjustedFrameOffset);
      adjustedSubtitleItem.config.frameDuration = Math.floor(adjustedFrameDuration);
      adjustedSubtitleItem.audioLayerId = audioLayerId;

      // Assign a unique id to the adjustedSubtitleItem
      adjustedSubtitleItem.id = `subtitle_${Math.random().toString(36).substr(2, 5)}`;

      // Ensure the layer has an imageSession with an activeItemList
      if (!layer.imageSession) {
        layer.imageSession = { activeItemList: [] };
      } else if (!layer.imageSession.activeItemList) {
        layer.imageSession.activeItemList = [];
      }

      // Add the adjusted subtitle item to the layer's activeItemList
      layer.imageSession.activeItemList.push(adjustedSubtitleItem);

      // Set frameGenerationPending to true for this layer
      layer.frameGenerationPending = true;

      // Update framesDisplayed for the subtitleItem
      subtitleItem.framesDisplayed += adjustedSubtitleItem.config.frameDuration;


      // If we've displayed the entire subtitle, we can skip this subtitle in future layers
      if (subtitleItem.framesDisplayed >= subtitleItem.config.frameDuration) {
        continue;
      }
    }
  }



  await VideoSession.findByIdAndUpdate(sessionId, {
    layers: sessionLayers
  });

}


function calculateFrameOffset(startTime, endTime) {
  const frameOffset = secondsToFrame(startTime);
  const effectiveFrameOffset = frameOffset + 1;
  const endFrame = Math.floor(endTime * FPS);
  const frameDuration = endFrame - effectiveFrameOffset;
  const effectiveOffset = effectiveFrameOffset + 1;
  return { frameDuration, frameOffset: effectiveOffset };
}
