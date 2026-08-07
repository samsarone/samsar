import fs from "fs";
import path from "path";
import VideoSession from "../schema/VideoSession.js";
import AudioGeneration from "../schema/AudioGeneration.js";
import mp3Duration from "mp3-duration";
import { getDBConnectionString } from "../DBString.js";
import { ElevenLabsClient } from "elevenlabs";
import { resolveSpeechLayerTimingUpdate } from "./SpeechLayerTiming.js";
import { getProcessorAssetsV2Path, toAssetsV2RelativePath } from "../utils/AssetPaths.js";
import { uploadAudioAssetToCDN } from "../AWS.js";
import {
  finalizeStandaloneExternalAudioGeneration,
} from '../external/StandaloneExternalAudio.js';
import { markAudioGenerationAsFailed } from '../music/audioUtils.js';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getElevenLabsApiKey() {
  return normalizeString(process.env.ELEVENLABS_API_TOKEN) || normalizeString(process.env.ELEVENLABS_API_KEY);
}

export function hasNativeElevenLabsSpeechCredential() {
  return Boolean(getElevenLabsApiKey());
}

function createElevenLabsClient() {
  return new ElevenLabsClient({ apiKey: getElevenLabsApiKey() });
}

export async function processElevenLabsSpeechRequest(payload) {
  let audioGenerationRecord;

  try {
    await getDBConnectionString();

    // Always refetch the AudioGeneration record at the top
    // so we have the most updated data (including requestTimeoutUntil).
    audioGenerationRecord = await AudioGeneration.findById(payload._id);
    if (!audioGenerationRecord) {
      // If we can't find the record, we can't do anything.
      console.error("AudioGeneration record not found. Aborting.");
      return;
    }

    // ------------------------------
    // 1) Check requestTimeoutUntil
    // ------------------------------
    // If requestTimeoutUntil is set and it's still in the future, skip.
    if (
      audioGenerationRecord.requestTimeoutUntil &&
      audioGenerationRecord.requestTimeoutUntil > new Date()
    ) {
      return;
    }

    // Destructure payload
    const { prompt, speaker, sessionId, audioLayerId } = payload;
    const outputFormat = 'mp3_44100_128';
    const modelID = 'eleven_multilingual_v2';

    // ------------------------------
    // 2) Generate speech using ElevenLabs
    // ------------------------------
    const client = createElevenLabsClient();
    const response = await client.textToSpeech.convert(speaker, {
      output_format: outputFormat,
      text: prompt,
      model_id: modelID,
    });

    // The response is a readable stream; read it to a buffer
    const chunks = [];
    for await (const chunk of response) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // ------------------------------
    // 3) Write file to disk
    // ------------------------------
    const audioFileBase = path.join('video', 'audio', sessionId, audioLayerId, 'speech.mp3');
    const audioAssetPath = toAssetsV2RelativePath(audioFileBase);
    const audioSaveFilePath = getProcessorAssetsV2Path(audioFileBase);

    // Ensure the folder path exists
    const audioFileFolder = path.dirname(audioSaveFilePath);
    if (!fs.existsSync(audioFileFolder)) {
      fs.mkdirSync(audioFileFolder, { recursive: true });
    }

    await fs.promises.writeFile(audioSaveFilePath, buffer);

    // ------------------------------
    // 4) Prepare remote file info
    // ------------------------------
    const remoteFilePath = await uploadAudioAssetToCDN(audioSaveFilePath, audioAssetPath);
    const remoteAudioData = [
      {
        audio_url: remoteFilePath,
        title: 'Speech',
      }
    ];

    // ------------------------------
    // 5) Calculate duration
    // ------------------------------
    let duration = await mp3Duration(audioSaveFilePath);
    duration = Math.ceil(duration);

    if (await finalizeStandaloneExternalAudioGeneration({
      payload: audioGenerationRecord,
      resultUrl: remoteFilePath,
      resultUrls: [remoteFilePath],
      duration,
      localAudioPath: audioAssetPath,
      remoteAudioData,
      title: 'Speech',
    })) {
      return 'Speech request processed';
    }

    // ------------------------------
    // 6) Update VideoSession + AudioLayer
    // ------------------------------
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

    // Fetch session again to evaluate statuses
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

    // ------------------------------
    // 7) Handle express generation logic
    // ------------------------------
    if (!speechGenerationPending && isExpressGeneration) {
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
      // If not express generation or there's still pending speech,
      // just ensure the startTime/endTime are set properly
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

    // If no audio is pending, update the session to reflect that
    if (!audioGenerationPending) {
      await VideoSession.findOneAndUpdate(
        { _id: sessionId },
        { $set: { audioGenerationPending } },
        { new: true }
      );
    }

    // Clean up the AudioGeneration record (no error => success)
    if (audioGenerationRecord) {
      await AudioGeneration.deleteOne({ _id: audioGenerationRecord._id });
    }

    return 'Speech request processed';

  } catch (e) {
    console.error("Error while processing ElevenLabs speech:", e);
    if (!audioGenerationRecord) return;
    await markAudioGenerationAsFailed(
      audioGenerationRecord._id,
      `ElevenLabs speech outcome is unknown: ${e?.message || 'provider request failed'}`,
    );
    await AudioGeneration.findByIdAndUpdate(audioGenerationRecord._id, {
      submissionOutcomeUnknown: true,
      rowLocked: false,
    });
    return;
  }
}
