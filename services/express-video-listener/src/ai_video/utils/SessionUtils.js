import { getDBConnectionString } from "../../DBString.js";
import VideoSession from "../../schema/VideoSession.js";


export async function updateLayerAiVideoGenerationPrompt(sessionId, layerId, prompt) {

  await getDBConnectionString();

  const updateRes = await VideoSession.updateOne({
    _id: sessionId,
    'layers._id': layerId
  }, {
    $set: {
      'layers.$.videoGenerationPrompt': prompt
    }
  });

}

export async function revertUserCreditsOnFailure() {

}

export async function sendSuccessWebhookNotification(sessionId) {

  await getDBConnectionString();

  const sessionData = await VideoSession.findOne({ _id: sessionId });

  if (sessionData.externalWebhook) {
    const postPayload = {
     video: {
      url: 'https://cdn.samsar.ai/ai_video/1.mp4',
     }
    }
  }

}

export async function sendFailureWebhookNotification() {

}

