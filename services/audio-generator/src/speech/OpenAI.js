import fs from "fs";
import path from "path";
import VideoSession from "../schema/VideoSession.js";
import AudioGeneration from "../schema/AudioGeneration.js";
import mp3Duration from "mp3-duration";
import OpenAI from "openai";
import { getDBConnectionString } from "../DBString.js";
import { resolveSpeechLayerTimingUpdate } from "./SpeechLayerTiming.js";
import { getProcessorAssetsV2Path, toAssetsV2RelativePath } from "../utils/AssetPaths.js";
import { uploadAudioAssetToCDN } from "../AWS.js";
import {
  createSamsarExternalChatCompletion,
  shouldUseSamsarExternalInference,
} from "../inference/SamsarExternalInferenceAdapter.js";

const API_KEY = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: API_KEY || '' });

export async function processOpenAISpeechRequest(payload) {
  try {


    await getDBConnectionString();
    const { prompt, speaker, sessionId, audioLayerId , defaultSelected } = payload;

    const audioFileBase = path.join('video', 'audio', sessionId, audioLayerId, 'speech.mp3');
    const audioAssetPath = toAssetsV2RelativePath(audioFileBase);
    const audioSaveFilePath = getProcessorAssetsV2Path(audioFileBase);
    
    const audioFileFolder = path.dirname(audioSaveFilePath);
    if (!fs.existsSync(audioFileFolder)) {
      fs.mkdirSync(audioFileFolder, { recursive: true });
    }

    const mp3 = await openai.audio.speech.create({
      model: "tts-1",
      voice: speaker,
      input: prompt,
    });


    const buffer = Buffer.from(await mp3.arrayBuffer());
    await fs.promises.writeFile(audioSaveFilePath, buffer);

    const remoteFilePath = await uploadAudioAssetToCDN(audioSaveFilePath, audioAssetPath);
    const remoteAudioData = [
      {
        audio_url: remoteFilePath,
        title: 'Speech',
      }
    ];

    // Find the video session to get the current audio layer details
    let videoSession = await VideoSession.findById(sessionId);

    const isExpressGeneration = videoSession.isExpressGeneration;

    let duration = await mp3Duration(audioSaveFilePath);

    duration = Math.ceil(duration);
    const audioLayer = videoSession.audioLayers.find(layer => layer._id.toString() === audioLayerId);




    if (audioLayer) {
      const timingUpdate = resolveSpeechLayerTimingUpdate({ videoSession, audioLayer, duration });

      await VideoSession.findOneAndUpdate(
        { _id: sessionId, "audioLayers._id": audioLayerId },
        {
          $set: {
            "audioLayers.$.localAudioLinks": [audioAssetPath],
            "audioLayers.$.remoteAudioData": remoteAudioData,
            ...timingUpdate.set,
            "audioLayers.$.remoteAudioLinks": [remoteFilePath],
            "audioLayers.$.generationStatus": 'COMPLETED',
            ...(audioLayer.defaultSelected && {
              "audioLayers.$.selectedLocalAudioLink": audioAssetPath,
              "audioLayers.$.selectedRemoteAudioLink": remoteFilePath
            })
          },
          ...(Object.keys(timingUpdate.unset).length > 0 ? { $unset: timingUpdate.unset } : {}),
        },
        { new: true }
      );
    }

    const latestSessionData = await VideoSession.findOne({ _id: sessionId });
    // Check if all audio layers have their generationStatus set to 'COMPLETED'
    const allAudioCompleted = latestSessionData.audioLayers.every(layer => layer.generationStatus === 'COMPLETED');
    const audioGenerationPending = !allAudioCompleted;

    const allSpeechPending = latestSessionData.audioLayers.find(layer => (layer.generationType === 'speech' && layer.generationStatus !== 'COMPLETED'));
    


      

    let speechGenerationPending = !!allSpeechPending;

    if (!speechGenerationPending && isExpressGeneration) {


      videoSession = await VideoSession.findOne({ _id: sessionId });

      if (videoSession.setAutoDurationPerScene) {

        let effectiveAudioLayers = videoSession.audioLayers.filter(layer => layer.generationType === "speech");

        let durationOffset = 0;

        const layerUpdates = {};
        const audioLayerUpdates = {};

        for (let i = 0; i < effectiveAudioLayers.length; i++) {

          const audioDuration = effectiveAudioLayers[i].duration;
          let layerDuration = effectiveAudioLayers[i].duration + 1;

          if (i === effectiveAudioLayers.length - 1) {
            layerDuration = effectiveAudioLayers[i].duration + 2;
          }
          const durationDiff = layerDuration - audioDuration;
          const audioDurationOffset = durationDiff > 0 ? (durationDiff / 2) : 0;
          let newAudioStartTime = durationOffset + audioDurationOffset;
          layerUpdates[`layers.${i}.duration`] = layerDuration;
          layerUpdates[`layers.${i}.durationOffset`] = durationOffset;

          audioLayerUpdates[`audioLayers.${i}.startTime`] = newAudioStartTime;
          audioLayerUpdates[`audioLayers.${i}.endTime`] = newAudioStartTime + audioDuration;
          audioLayerUpdates[`audioLayers.${i}.connectedLayerStartTimeOffset`] = audioDurationOffset;
          durationOffset += layerDuration;

        }



        await VideoSession.updateOne(
          { _id: sessionId },
          { $set: { ...layerUpdates, ...audioLayerUpdates } }
        );

      }
    } else {
      // update start time and end time for the audio layer
      const audioLayer = latestSessionData.audioLayers.find(layer => layer.generationType === 'speech');
      const audioLayerIndex = latestSessionData.audioLayers.findIndex(layer => layer.generationType === 'speech');
      
      const audioLayerDuration = audioLayer.duration;
      const audioLayerStartTime = audioLayer.startTime;
      const audioLayerEndTime = audioLayer.startTime + audioLayerDuration;


      

      await VideoSession.findOneAndUpdate(
        { _id: sessionId, "audioLayers._id": audioLayer._id },
        {
          $set: {
            "audioLayers.$.startTime": audioLayerStartTime,
            "audioLayers.$.endTime": audioLayerEndTime,
            "audioLayers.$.duration": audioLayerDuration
          }
        }
      );
    }

    if (!audioGenerationPending) {
      await VideoSession.findOneAndUpdate(
        { _id: sessionId },
        { $set: { audioGenerationPending } },
        { new: true }
      );
    }


    const audioGenerationRecord = await AudioGeneration.findOne({ _id: payload._id });
    if (audioGenerationRecord) {
      await AudioGeneration.deleteOne({ _id: payload._id });
    }
    return 'Speech request processed';
  } catch (e) {
    console.error(e);

    await VideoSession.findOneAndUpdate(
      { _id: payload.sessionId, "audioLayers._id": payload.audioLayerId },
      { $set: { "audioLayers.$.generationStatus": "FAILED" } },
      { new: true }
    );

    await AudioGeneration.deleteOne({ _id: payload._id });
  }
}

export async function updateMusicPrompt(originalPrompt, errorMessage) {

    const systemPrompt = `
    You are a creative assistant for a generative AI tool that generates music from text prompts.
    I need you to modify the provided prompt to preserve its original meaning as much as possible while removing any terms or themes that may trigger content policy violations according to the error message provided.
    Ensure that the modified prompt retains the key elements, meaning, and atmosphere intended, while correcting any issues that may have caused the error.
    Do not provide headings or titles. Provide the modified prompt in a single paragraph.
    `;

    const userPrompt = `Please modify the following prompt to avoid content policy violations: ${originalPrompt} Error: ${errorMessage}`;

    const messageList = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const response = await sendAssistantMessageRequest(messageList);
    const resData = response.content;
    return resData;

}

export async function updateSpeechPrompt(originalPrompt) {
  
    const systemPrompt = `
You are a creative assistant for a generative AI tool that produces speech from text prompts. Your task is to revise the provided prompt so that it keeps its original message and length as closely as possible, but remove or replace any words or themes that:

May violate content policy (e.g., offensive, hateful, or copyrighted references).
Are too difficult or complex for text-to-speech software.
Use simpler synonyms or phrasing to preserve the prompt’s intent and style. Ensure the final output remains clear, coherent, and comparable in length to the original.
    `;

    const userPrompt = `Please enhance the following speech prompt: ${originalPrompt}`;

    const messageList = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const response = await sendAssistantMessageRequest(messageList);
    const resData = response.content;
    return resData;
}



export async function sendAssistantMessageRequest(messageList) {

  try {
    const payload = {
      messages: messageList,
      model: "gpt-4o-mini",
    };
    const response = shouldUseSamsarExternalInference(payload)
      ? await createSamsarExternalChatCompletion(payload)
      : await openai.chat.completions.create(payload);
    return response.choices[0].message;
  } catch (error) {
    let errorString = 'An error occurred while sending the message. Please try again with a different message.'
    throw new Error(errorString);
  }

}
