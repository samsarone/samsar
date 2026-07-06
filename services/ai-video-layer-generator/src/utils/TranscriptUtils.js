import { getDBConnectionString } from "../DBString.js";

import VideoSession from '../schema/VideoSession.js';
import User from '../schema/User.js';

import { normalizeFramesPerSecond, resolveFramesPerSecond } from './FpsUtils.js';

export async function addSubtitlesForSessionForAudio(sessionId, audioLayerId, rawLayers) {
  // Get the session data
  const session = await VideoSession.findById(sessionId);
  const sessionFps = normalizeFramesPerSecond(session?.framesPerSecond);
  let framesPerSecond = sessionFps;
  if (!framesPerSecond) {
    const userData = await User.findById(session.userId).select('videoFramesPerSecond').lean();
    framesPerSecond = resolveFramesPerSecond(session, userData);
  }

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


        const activeItemLength = layer.imageSession.activeItemList.length;
        adjustedSubtitleItem.id = `item_${activeItemLength}`;


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
  // Get the session data
  const session = await VideoSession.findById(sessionId);
  const sessionFps = normalizeFramesPerSecond(session?.framesPerSecond);
  let framesPerSecond = sessionFps;
  if (!framesPerSecond) {
    const userData = await User.findById(session.userId).select('videoFramesPerSecond').lean();
    framesPerSecond = resolveFramesPerSecond(session, userData);
  }

  // Find the audioLayer in the session layers
  const audioLayer = session.audioLayers.find(
    (layer) => layer._id.toString() === audioLayerId.toString()
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
        const adjustedFrameOffset = Math.floor((overlapStartTime - layerStartTime) * framesPerSecond); // frames relative to layer
        const adjustedFrameDuration = Math.floor((overlapEndTime - overlapStartTime) * framesPerSecond); // frame count within layer

        if (adjustedFrameDuration <= 0) {
          continue; // Skip if duration is invalid
        }

        // Clone the subtitle item and adjust frameOffset and frameDuration
        const adjustedSubtitleItem = { ...subtitleItem };
        adjustedSubtitleItem.config = { ...subtitleItem.config };
        adjustedSubtitleItem.config.frameOffset = adjustedFrameOffset;
        adjustedSubtitleItem.config.frameDuration = adjustedFrameDuration;
        adjustedSubtitleItem.audioLayerId = audioLayerId;
        // Assign a unique id to the adjustedSubtitleItem
        const activeItemLength = layer.imageSession.activeItemList.length;
        adjustedSubtitleItem.id = `item_${activeItemLength}`;


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
      }
    }
  }

  // Save the session data
  await session.save();
}
