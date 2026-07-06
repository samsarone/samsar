import fs from "fs";
import path from "path";
import axios from "axios";
import mp3Duration from "mp3-duration";

import { fal } from "@fal-ai/client";
import { getDBConnectionString } from "../DBString.js";
import { updateSpeechPrompt } from './OpenAI.js';
import VideoSession from "../schema/VideoSession.js";
import AudioGeneration from "../schema/AudioGeneration.js";
import { resolveSpeechLayerTimingUpdate } from "./SpeechLayerTiming.js";
import { getProcessorAssetsV2Path, toAssetsV2RelativePath } from "../utils/AssetPaths.js";
import { uploadAudioAssetToCDN } from "../AWS.js";

const FAL_API_KEY = process.env.FAL_API_KEY;
fal.config({ credentials: FAL_API_KEY });

/**
 * processPlayAISpeechRequest
 * 
 * 1) If status is INIT -> submit job to Fal queue
 * 2) If status is PENDING -> poll Fal queue; if COMPLETE, download + save MP3
 * 3) If error, retry up to 3 times
 */
export async function processPlayAISpeechRequest(payload) {

  // Helper for sleeping (retry delay, etc.)
  async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  try {
    await getDBConnectionString();

    const {
      _id,                // AudioGeneration doc _id
      prompt,
      speaker,
      sessionId,
      audioLayerId,
      model,
      apiRequestId,
      status
    } = payload;

    // Get or create the AudioGeneration record
    let audioGenerationRecord = await AudioGeneration.findById(_id);
    if (!audioGenerationRecord) {
      console.error("AudioGeneration record not found. Aborting.");
      return;
    }

    // We’ll use the Fal Link for your TTS model
    const falLink = 'fal-ai/playai/tts/v3';

    // -------------
    // INIT: Submit TTS Request
    // -------------
    if (status === 'INIT') {
      // Mark as locked
      audioGenerationRecord.rowLocked = true;
      await audioGenerationRecord.save();

      // Queue up the TTS job
      const payloadToFal = {
        input: prompt,
        voice: speaker,
      };

      const response = await fal.queue.submit(falLink, {
        input: payloadToFal,
      });


      
      // Store the request_id from Fal
      audioGenerationRecord.apiRequestId = response.request_id;
      audioGenerationRecord.status = 'PENDING';
      audioGenerationRecord.rowLocked = false;
      await audioGenerationRecord.save();

      // Also update the VideoSession layer to reflect status
      await VideoSession.findOneAndUpdate(
        { _id: sessionId, "audioLayers._id": audioLayerId },
        { 
          $set: { 
            "audioLayers.$.generationStatus": "PENDING"
          }
        }
      );

      return; // Done submitting, will pick up next time
    }

    // -------------
    // PENDING: Poll & Download
    // -------------
    if (status === 'PENDING') {
      // Mark as locked
      audioGenerationRecord.rowLocked = true;
      await audioGenerationRecord.save();

      let falStatus;
      try {
        falStatus = await fal.queue.status(falLink, {
          requestId: apiRequestId,
          logs: true,
        });
      } catch (err) {
        console.error(err.data);
        console.error(err.body);

        console.error("Fal queue.status error:", err);
        // Mark fail and let it go to retry logic below
        throw err;
      }

      if (falStatus.status === 'COMPLETED') {
        // -----------
        // Retrieve result
        // -----------
        let result;
        try {
          result = await fal.queue.result(falLink, {
            requestId: apiRequestId
          });
        } catch (err) {
          console.error("Fal queue.result error:", err);
          throw err;
        }

        const audioData = result?.data?.audio;
        if (!audioData?.url) {
          throw new Error("No audio URL returned from Fal result.");
        }

        const { url: audioUrl, duration: falDuration } = audioData;

        // -----------
        // Download the audio file
        // -----------
        const audioResponse = await axios.get(audioUrl, { responseType: 'arraybuffer' });
        const audioBuffer = Buffer.from(audioResponse.data);

        // -----------
        // Save locally
        // -----------
        const audioFileBase = path.join('video', 'audio', sessionId, audioLayerId, 'speech.mp3');
        const audioAssetPath = toAssetsV2RelativePath(audioFileBase);
        const audioSaveFilePath = getProcessorAssetsV2Path(audioFileBase);
        
        // Ensure local directory
        const audioFileFolder = path.dirname(audioSaveFilePath);
        if (!fs.existsSync(audioFileFolder)) {
          fs.mkdirSync(audioFileFolder, { recursive: true });
        }
        await fs.promises.writeFile(audioSaveFilePath, audioBuffer);

        // -----------
        // Calculate duration
        // -----------
        let duration = 0;
        try {
          duration = await mp3Duration(audioSaveFilePath);
        } catch(e) {
          console.error("Error getting MP3 duration:", e);
        }
        // If Fal gave us a duration, fallback to that if needed
        if (!duration && falDuration) {
          duration = falDuration;
        }
        duration = Math.ceil(duration);

        // -----------
        // Prepare remote path
        // -----------
        const remoteFilePath = await uploadAudioAssetToCDN(audioSaveFilePath, audioAssetPath);
        const remoteAudioData = [
          {
            audio_url: remoteFilePath,
            title: 'Speech',
          }
        ];

        // -----------
        // Update VideoSession -> audioLayers
        // -----------
        let videoSession = await VideoSession.findById(sessionId);
        const isExpressGeneration = videoSession.isExpressGeneration;

        const audioLayer = videoSession.audioLayers.find(
          layer => layer._id.toString() === audioLayerId
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
                })
              },
              ...(Object.keys(timingUpdate.unset).length > 0 ? { $unset: timingUpdate.unset } : {}),
            },
            { new: true }
          );
        }

        // Fetch updated session data
        const latestSessionData = await VideoSession.findOne({ _id: sessionId });

        // Check if all audio layers are completed
        const allAudioCompleted = latestSessionData.audioLayers.every(
          layer => layer.generationStatus === 'COMPLETED'
        );
        const audioGenerationPending = !allAudioCompleted;

        // Check if any speech generation is still pending
        const allSpeechPending = latestSessionData.audioLayers.find(
          layer => layer.generationType === 'speech' && layer.generationStatus !== 'COMPLETED'
        );
        let speechGenerationPending = !!allSpeechPending;

        // ----------
        // Express Generation logic
        // ----------
        if (!speechGenerationPending && isExpressGeneration) {
          // Re-fetch session in case it changed
          videoSession = await VideoSession.findOne({ _id: sessionId });

          if (videoSession.setAutoDurationPerScene) {
            let effectiveAudioLayers = videoSession.audioLayers.filter(
              layer => layer.generationType === "speech"
            );

            let durationOffset = 0;
            const layerUpdates = {};
            const audioLayerUpdates = {};

            for (let i = 0; i < effectiveAudioLayers.length; i++) {
              const audioDuration = effectiveAudioLayers[i].duration;
              let layerDuration = audioDuration + 1;

              if (i === effectiveAudioLayers.length - 1) {
                layerDuration = audioDuration + 2; 
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
          // If not express or there's still pending speech, just ensure times are set
          const audioLayerSpeech = latestSessionData.audioLayers.find(
            layer => layer.generationType === 'speech'
          );
          if (audioLayerSpeech) {
            const audioLayerDuration = audioLayerSpeech.duration;
            const audioLayerStartTime = audioLayerSpeech.startTime || 0;
            const audioLayerEndTime = audioLayerStartTime + audioLayerDuration;

            await VideoSession.findOneAndUpdate(
              { _id: sessionId, "audioLayers._id": audioLayerSpeech._id },
              {
                $set: {
                  "audioLayers.$.startTime": audioLayerStartTime,
                  "audioLayers.$.endTime": audioLayerEndTime,
                  "audioLayers.$.duration": audioLayerDuration
                }
              }
            );
          }
        }

        // If no more audio pending, mark session
        if (!audioGenerationPending) {
          await VideoSession.findOneAndUpdate(
            { _id: sessionId },
            { $set: { audioGenerationPending } },
            { new: true }
          );
        }

        // All done => remove the AudioGeneration record
        await AudioGeneration.deleteOne({ _id });
        return 'Speech request processed';

      } else if (falStatus.status === 'FAILED') {
        // Fal queue says it failed
        throw new Error("Fal queue returned FAILED status.");
      } else {
        // If still RUNNING or PENDING, we do nothing here; 
        // the next cron/queue check or request will pick it up again.
        // Release row lock
        audioGenerationRecord.rowLocked = false;
        await audioGenerationRecord.save();
      }
    }

  } catch (err) {
    console.error("Error in processPlayAISpeechRequest:", err);

    // Attempt a retry if possible
    let audioGenerationRecord = await AudioGeneration.findById(payload._id);
    if (!audioGenerationRecord) {
      console.error("AudioGeneration record missing on catch, cannot retry.");
      return;
    }

    // Wait 5 seconds
    await delay(5000);

    // If we haven't exhausted our retries
    if (audioGenerationRecord.numRetries < 3) {
      // Optionally: update the prompt to add variety / fallback text
      const updatedSpeechPrompt = await updateSpeechPrompt(audioGenerationRecord.prompt);

      audioGenerationRecord.numRetries += 1;
      audioGenerationRecord.rowLocked = false;
      audioGenerationRecord.prompt = updatedSpeechPrompt;
      // Reset generation status
      audioGenerationRecord.status = 'INIT';
      await audioGenerationRecord.save();

      // Reset the VideoSession audio layer to INIT so it will be re-queued
      await VideoSession.findOneAndUpdate(
        { _id: payload.sessionId, "audioLayers._id": payload.audioLayerId },
        {
          $set: {
            "audioLayers.$.generationStatus": "INIT",
            "audioLayers.$.prompt": updatedSpeechPrompt
          }
        },
        { new: true }
      );
      // Return; next pass will handle the new INIT status
    } else {
      // 3+ retries => mark failed
      console.error("Max retries reached for PlayAI. Marking as FAILED.");
      await VideoSession.findOneAndUpdate(
        { _id: payload.sessionId, "audioLayers._id": payload.audioLayerId },
        { $set: { "audioLayers.$.generationStatus": "FAILED" } },
        { new: true }
      );
      await AudioGeneration.deleteOne({ _id: payload._id });
    }
  }
}
