import { getDBConnectionString } from "../DBString.js";
import AIVideoLayerGeneration from "../schema/AIVideoLayerGeneration.js";
import VideoSession from "../schema/VideoSession.js";
import User from "../schema/User.js";
import { getCanonicalAiVideoReference } from './utils/ProviderMediaUrl.js';

export async function generateSoundEffectsForSession(sessionId) {

  await getDBConnectionString();


  let sessionData = await VideoSession.findOne({ _id: sessionId });

  const userId = sessionData.userId;
  const sessionLayers = sessionData.layers;

  const aspectRatio = sessionData.aspectRatio; 

  const sessionSoundEffectLayers = sessionLayers.filter((layer) =>
    layer.layerAiVideoType === "sound_effect" &&
    !layer.isAudioVideoLayer &&
    layer.soundEffectGenerationPending
  );

  if (!sessionSoundEffectLayers.length) {
    return;
  }


  try {
    for (let i = 0; i < sessionSoundEffectLayers.length; i++) {
      const currentLayer = sessionSoundEffectLayers[i];

      const audioPrompt = currentLayer.layerAISoundEffectPrompt;

      await generateSoundEffectsForLayer(userId, sessionId, currentLayer, audioPrompt, aspectRatio);

    }

  } catch {

  }


}

async function generateSoundEffectsForLayer(userId, sessionId, currentLayer, audioPrompt, aspectRatio) {



  const aiVideoLayer = currentLayer.aiVideoLayer;
  if (!aiVideoLayer) {
        await VideoSession.findOneAndUpdate({
          _id: sessionId,
          'layers._id': currentLayer._id,
        }, {
          $set: {
            'layers.$.soundEffectGenerationPending': false,
          }
        });

   return;
  }
  const videoUrl = getCanonicalAiVideoReference({
    layer: currentLayer,
    userId,
  });
  if (!videoUrl) {
    await VideoSession.findOneAndUpdate({
      _id: sessionId,
      'layers._id': currentLayer._id,
    }, {
      $set: {
        'layers.$.soundEffectGenerationPending': false,
      }
    });

    return;
  }

  const userData = await User.findById(userId);
  const userAgentSoundEffectModel = userData.agentSoundEffectModel || 'MIRELOAI';




  const aiVideoGenerationPayload = {
    model: userAgentSoundEffectModel,
    prompt: audioPrompt,

    duration: currentLayer.duration,
    videoLink: videoUrl,

    isAudioVideoGeneration: true,
    useStartFrame: false,
    useEndFrame: false,
    sessionId: sessionId,
    layerId: currentLayer._id,
    userId: userId,
    aspectRatio: aspectRatio,
    isExpressGeneration: true,
    isVideoGPTGeneration: true,
    retryOnFail: false,
  }

  const aiVideoGenerationResponse = await AIVideoLayerGeneration.create(aiVideoGenerationPayload);

}
