import { getDBConnectionString } from "../DBString.js";
import VideoSession from "../schema/VideoSession.js";

export async function realignNarrativeLayersToVisuals(sessionId) {

  await getDBConnectionString();

  const sessionData = await VideoSession.findOne({ _id: sessionId });

  if (!sessionData) {
    throw new Error('Session not found');
  }

  const sessionLayers = sessionData.layers.filter((layer) => layer.layerAiVideoType === 'narrative');


  let audioLayers = sessionData.audioLayers;


  for (let i = 0; i < audioLayers.length; i++) {
    let currentAudioLayer = audioLayers[i];

    if (currentAudioLayer.generationType !== 'speech') {
      continue;
    }

    const connectedLayerId = currentAudioLayer.connectedLayerId;


    if (connectedLayerId) {
      const connectedLayer = sessionLayers.find((layer) => layer._id.toString() === connectedLayerId);

      if (connectedLayer && connectedLayer.layerAiVideoType === 'narration') {
        const layerStartTime = typeof connectedLayer.durationOffset === 'number'
          ? connectedLayer.durationOffset
          : 0;
        const layerDuration = typeof connectedLayer.duration === 'number'
          ? connectedLayer.duration
          : 0;
        const audioDuration = typeof currentAudioLayer.duration === 'number'
          ? currentAudioLayer.duration
          : 0;
        const durationDiff = layerDuration - audioDuration;
        const audioStartOffset = durationDiff > 0 ? (durationDiff / 2) : 0;

        currentAudioLayer.startTime = layerStartTime + audioStartOffset;
        currentAudioLayer.endTime = currentAudioLayer.startTime + audioDuration;
        currentAudioLayer.connectedLayerStartTimeOffset = audioStartOffset;


      }
    }
  }

  const audioSaveRes = await VideoSession.updateOne({ _id: sessionId }, { audioLayers: audioLayers });



}
