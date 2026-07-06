import fs from "fs";
import path from "path";
import VideoSession from "../schema/VideoSession.js";
import AudioGeneration from "../schema/AudioGeneration.js";

import OpenAI from "openai";
import { getDBConnectionString } from "../DBString.js";

import ffmpeg from 'fluent-ffmpeg';

import { promisify } from 'util';
import { resolveSpeechLayerTimingUpdate } from "./SpeechLayerTiming.js";
import { getProcessorAssetsV2Path, toAssetsV2RelativePath } from "../utils/AssetPaths.js";
import { uploadAudioAssetToCDN } from "../AWS.js";
import {
  createSamsarExternalChatCompletion,
  shouldUseSamsarExternalInference,
} from "../inference/SamsarExternalInferenceAdapter.js";

ffmpeg.setFfprobePath('/usr/bin/ffprobe'); // Use system-installed ffprobe


const probe = promisify(ffmpeg.ffprobe);

export async function getDurationSeconds(filePath) {
  const { format } = await probe(filePath);
  return format.duration;        // ← float, in seconds
}


const API_KEY = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: API_KEY || '' });


function removeEmptyKeys(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([key, value]) => {
      // Remove if value is null, undefined, or an empty string
      if (value === null || value === undefined) return false;
      if (typeof value === 'string' && value.trim() === '') return false;
      return true;
    })
  );
}

export async function processOpenAITTSSpeechRequest(payload) {
  // First, remove empty keys
  payload = removeEmptyKeys(payload);

  payload = payload._doc ? payload._doc : payload;

  try {
    // Continue using payload as normal after cleaning
    await getDBConnectionString();

    let {
      prompt,
      instructions,
      generationMeta,
      speaker,
      sessionId,
      audioLayerId,
      defaultSelected,
      _id, // Make sure to keep _id if you need it
    } = payload;


    if (!sessionId || !audioLayerId) {
      throw new Error(
        `Missing sessionId or audioLayerId. sessionId: ${sessionId}, audioLayerId: ${audioLayerId}`
      );
    }


    let instrString;
    if (generationMeta && Object.keys(generationMeta).length > 0) {
      const parts = [];
      for (const key in generationMeta) {
        if (generationMeta.hasOwnProperty(key) && generationMeta[key]) {
          if (key === 'Affect') {
            parts.push(`Personality/affect: ${generationMeta[key]}`);
          } else {
            parts.push(`${key}: ${generationMeta[key]}`);
          }
        }
      }
      instrString = parts.join('\n\n');
    }

    if (!prompt) {


    }



    const finalInstructionString = instrString ? instrString : instructions;

    const audioFileBase = path.join('video', 'audio', sessionId, audioLayerId, 'speech.mp3');
    const audioAssetPath = toAssetsV2RelativePath(audioFileBase);
    const audioSaveFilePath = getProcessorAssetsV2Path(audioFileBase);


    const audioFileFolder = path.dirname(audioSaveFilePath);
    if (!fs.existsSync(audioFileFolder)) {
      fs.mkdirSync(audioFileFolder, { recursive: true });
    }

    let inputPayload = {
      model: "gpt-4o-mini-tts",
      voice: speaker,
      input: prompt,

    };


    let retryCount = 0;
    if (_id) {
      try {
        const audioGen = await AudioGeneration.findById(_id).lean();
        retryCount = audioGen?.numRetries ?? 0;
      } catch (e) {
        // If lookup fails, keep retryCount = 0 (first attempt semantics)
        console.error('Could not read AudioGeneration.numRetries; assuming first attempt.', e?.message);
      }
    }


    if (finalInstructionString && finalInstructionString !== undefined && finalInstructionString.trim().length > 0 && retryCount === 0) {
      inputPayload = {
        ...inputPayload,
        instructions: finalInstructionString,
      };
    }

    let mp3;
    try {
      mp3 = await openai.audio.speech.create(inputPayload);




      const buffer = Buffer.from(await mp3.arrayBuffer());


      await fs.promises.writeFile(audioSaveFilePath, buffer);

    } catch (error) {

      const audioGenerationRecord = await AudioGeneration.findOne({ _id });
      if (!audioGenerationRecord) return;          // nothing to retry

      if ((audioGenerationRecord.numRetries ?? 0) < 3) {
        let updatedPrompt = audioGenerationRecord.prompt;
        if (!updatedPrompt || updatedPrompt.trim().length === 0) {
          updatedPrompt = " ";
        } else {
          try {

            console.error("Attempting to fix prompt for retry:", updatedPrompt);
            
            updatedPrompt = await updateSpeechPrompt(updatedPrompt);
          } catch (e) {
            console.error('Prompt fixer failed, retrying with original prompt');
          }
        }

        await AudioGeneration.updateOne(
          { _id },
          {
            $inc: { numRetries: 1 },
            $set: {
              rowLocked: false,
              prompt: updatedPrompt,
              requestTimeoutUntil: new Date(Date.now() + 5000),
              generationStatus: 'PENDING'
            }
          }
        );

        // Mark this audioLayer as 'INIT' again so it will be re-attempted
        await VideoSession.findOneAndUpdate(
          { _id: payload.sessionId, "audioLayers._id": payload.audioLayerId },
          {
            $set: {
              "audioLayers.$.generationStatus": "INIT",
              "audioLayers.$.prompt": updatedPrompt
            }
          },
          { new: true }
        );

      } else {
        console.error('Max retries reached. Giving up.');
        await VideoSession.updateOne(
          { _id: sessionId, "audioLayers._id": audioLayerId },
          { $set: { "audioLayers.$.generationStatus": "FAILED", "audioLayers.$.errorMessage": error.message || 'Unknown error' } }
        );

        await AudioGeneration.deleteOne({ _id });
      }

      return;


    }



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

    let duration = await getDurationSeconds(audioSaveFilePath);
    duration = Math.ceil(duration);

    const audioLayer = videoSession.audioLayers.find(
      (layer) => layer._id.toString() === audioLayerId
    );


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
            }),
          },
          ...(Object.keys(timingUpdate.unset).length > 0 ? { $unset: timingUpdate.unset } : {}),
        },
        { new: true }
      );
    }

    const latestSessionData = await VideoSession.findOne({ _id: sessionId });
    // Check if all audio layers have their generationStatus set to 'COMPLETED'
    const allAudioCompleted = latestSessionData.audioLayers.every(
      (layer) => layer.generationStatus === 'COMPLETED'
    );
    const audioGenerationPending = !allAudioCompleted;

    const allSpeechPending = latestSessionData.audioLayers.find(
      (layer) => layer.generationType === 'speech' && layer.generationStatus !== 'COMPLETED'
    );
    let speechGenerationPending = !!allSpeechPending;

    if (!speechGenerationPending && isExpressGeneration) {
      videoSession = await VideoSession.findOne({ _id: sessionId });

      if (videoSession.setAutoDurationPerScene) {
        let effectiveAudioLayers = videoSession.audioLayers.filter(
          (layer) => layer.generationType === "speech"
        );

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
      const audioLayer = latestSessionData.audioLayers.find(
        (layer) => layer.generationType === 'speech'
      );

      const audioLayerDuration = audioLayer.duration;
      const audioLayerStartTime = audioLayer.startTime;
      const audioLayerEndTime = audioLayer.startTime + audioLayerDuration;

      await VideoSession.findOneAndUpdate(
        { _id: sessionId, "audioLayers._id": audioLayer._id },
        {
          $set: {
            "audioLayers.$.startTime": audioLayerStartTime,
            "audioLayers.$.endTime": audioLayerEndTime,
            "audioLayers.$.duration": audioLayerDuration,
          },
        }
      );
    }

    // query the audio layer and log
    const sessionData = await VideoSession.findOne(
      { _id: sessionId });

    if (!audioGenerationPending) {
      await VideoSession.findOneAndUpdate(
        { _id: sessionId },
        { $set: { audioGenerationPending } },
        { new: true }
      );
    }

    const audioGenerationRecord = await AudioGeneration.findOne({ _id });
    if (audioGenerationRecord) {
      await AudioGeneration.deleteOne({ _id });
    }

    return 'Speech request processed';
  } catch (e) {
    console.error(e);

    await VideoSession.findOneAndUpdate(
      { _id: payload.sessionId, "audioLayers._id": payload.audioLayerId },
      { $set: { "audioLayers.$.generationStatus": "FAILED" } },
      { new: true }
    );

    // Only remove record if it was created
    if (payload._id) {
      await AudioGeneration.deleteOne({ _id: payload._id });
    }
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
