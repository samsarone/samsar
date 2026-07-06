import axios from 'axios';
import { getDBConnectionString } from '../DBString.js';
import VideoSession from '../schema/VideoSession.js';
import { writeFile } from "node:fs/promises";
import Replicate from "replicate";
import AudioGeneration from '../schema/AudioGeneration.js';
import { generateS3UrlsFromLocalFile } from '../AWS.js';
import { upsertGeneratedMusicArtifact } from './audioUtils.js';
import { getProcessorAssetsV2Path, toAssetsV2RelativePath } from '../utils/AssetPaths.js';

const replicate = new Replicate();

import path from 'path';
import fs from 'fs';

export async function dispatchAndProcessAudiocraftMusicRequest(payload) {
  const { prompt } = payload;


  await getDBConnectionString();
  if (payload.musicGenerationStatus === 'INIT') {
    await requestProcessAudiocraftGeneration(payload);
  } else if (payload.musicGenerationStatus === 'PENDING') {
   // await checkAudiocraftGenerationStatus(payload);

  } else if (payload.musicGenerationStatus === 'FAILED') {
    // Check how many times we've retried
    const audioGeneration = await AudioGeneration.findById(payload._id);
    if (!audioGeneration) return;

    // If we have retried fewer than 3 times, increment and retry
    if (audioGeneration.numRetries >= 0 && audioGeneration.numRetries < 3) {

      audioGeneration.numRetries += 1;
      audioGeneration.musicGenerationStatus = 'INIT';
      audioGeneration.status = 'INIT';
      await audioGeneration.save();

      // Attempt the generation again
      await requestProcessAudiocraftGeneration(payload);
    } else {
      // We have failed 3 times: mark audioLayer as FAILED, handle express generation status, and delete this record



      // 1) Mark audioLayer generationStatus as FAILED
      const sessionData = await VideoSession.findById(payload.sessionId);
      if (sessionData) {
        const { audioLayers, isExpressGeneration, expressGenerationStatus } = sessionData;

        const currentAudioLayer = audioLayers?.find(
          (layer) => layer._id.toString() === payload.audioLayerId
        );
        if (currentAudioLayer) {
          currentAudioLayer.generationStatus = 'FAILED';
          currentAudioLayer.generationError = audioGeneration.error || "Music generation failed 3 times.";
        }

        // 2) If expressGeneration, mark expressGenerationStatus.music_generation as FAILED
        if (isExpressGeneration && expressGenerationStatus) {
          expressGenerationStatus.music_generation = 'FAILED';
          sessionData.expressGenerationPending = false;
        }

        await sessionData.save();
      }

      // 3) Delete AudioGeneration doc
      await AudioGeneration.findByIdAndDelete(payload._id);
    }
  }
}

async function requestProcessAudiocraftGeneration(payload) {
  const { prompt, duration } = payload;



  try {


    await AudioGeneration.findOneAndUpdate({ _id: payload._id }, {
      musicGenerationStatus: 'PENDING',
      generationStatus: 'PENDING'
    });

    const inputPayload = {
      prompt: prompt,
      model_version: "stereo-large",
      output_format: "mp3",
      normalization_strategy: "peak",
      duration: duration
    };

    const output = await replicate.run("meta/musicgen:671ac645ce5e552cc63a54a2bbff63fcf798043055d2dac5fc9e36a837eedcfb", { input: inputPayload });



    // Instead, pass `output` to the update function where we will write locally & generate s3 URLs
    await updateAudiocraftGenerationStatus(payload, output);

  } catch (error) {

    await AudioGeneration.findOneAndUpdate({ _id: payload._id }, {
      musicGenerationStatus: 'FAILED',
      generationStatus: 'FAILED',
      error: error.message
    });

  }
}

export async function updateAudiocraftGenerationStatus(payload, output) {
  await getDBConnectionString();

  const {
    requestId,
    status,
    s3Urls,
    error,
    _id,
    sessionId,
    audioLayerId,


  } = payload;


  const audioGeneration = await AudioGeneration.findById(_id);



  if (audioGeneration) {
    audioGeneration.musicGenerationStatus = status;
    audioGeneration.status = status;




    // Define paths for downloading and storing audio files
    const localDownloadBase = path.join('video', 'audio', sessionId.toString(), audioLayerId.toString());
    const localDownloadFolderPath = getProcessorAssetsV2Path(localDownloadBase);
    
    if (!fs.existsSync(localDownloadFolderPath)) {
      fs.mkdirSync(localDownloadFolderPath, { recursive: true });
    }

    // Write the output directly to a local file here
    const localAudioFileName = 'output.mp3';
    const localAudioFilePath = path.join(localDownloadFolderPath, localAudioFileName);
    await writeFile(localAudioFilePath, output);



    let sessionData = await VideoSession.findOne({ _id: sessionId });

    if (sessionData) {
      const { audioLayers } = sessionData;

      
      let currentAudioLayer = audioLayers.find((audioLayer) => audioLayer._id.toString() == audioLayerId);



      if (currentAudioLayer) {
        currentAudioLayer.generationStatus = 'COMPLETED';
      }

      // Now, call a placeholder function to generate S3 URLs from the local file
      const generatedS3Urls = await generateS3UrlsFromLocalFile(sessionId, localAudioFilePath);


      // Update remoteAudioLinks and related fields
      currentAudioLayer.remoteAudioLinks = generatedS3Urls;
      currentAudioLayer.selectedRemoteAudioLink = generatedS3Urls[0];


      audioGeneration.remoteAudioLinks = generatedS3Urls;

      currentAudioLayer.remoteAudioData = [
        {
          "audio_url": generatedS3Urls[0],
          "lyric": "[Instrumental]",
          "_id": audioLayerId,
        }
      ];

      // Update local audio paths to reflect what was written
      const localAudioPaths = [toAssetsV2RelativePath(localDownloadBase, localAudioFileName)];
      currentAudioLayer.localAudioLinks = localAudioPaths;
      currentAudioLayer.selectedLocalAudioLink = localAudioPaths[0];

      if (sessionData.isExpressGeneration) {
        currentAudioLayer.fadeOnEdges = true; // check after
      }


      // Save the updated session data
      await sessionData.save();

      await upsertGeneratedMusicArtifact({
        sessionData,
        currentAudioLayer,
        audioGeneration,
        localAudioPath: localAudioPaths[0],
      });

      // Clean up the AudioGeneration document
      await AudioGeneration.findByIdAndDelete(_id);


    } else {
      // If status is not COMPLETED, just save the audioGeneration doc with the updated status
      await AudioGeneration.findByIdAndDelete(_id);
    }
  } else {
    console.error(`AudioGeneration document with ID ${_id} not found.`);
  }
}
