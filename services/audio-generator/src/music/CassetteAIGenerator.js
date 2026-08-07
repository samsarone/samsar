
import { finalizeRemoteAudioGeneration, markAudioGenerationAsFailed } from "./audioUtils.js";
import AudioGeneration from "../schema/AudioGeneration.js";

import { fal } from "@fal-ai/client";
import { createSubmissionOutcomeUnknownError } from '../utils/ProviderSubmissionSafety.js';

const FAL_API_KEY = process.env.FAL_API_KEY;

fal.config({
  credentials: FAL_API_KEY
});


export async function dispatchAndProcessCassetteAIMusicRequest(payload) {




  const { model, status } = payload;



  if (status === 'INIT') {
    const requestId = await requestGenerateCassetteAiLayer(payload);

    if (requestId) {


      await AudioGeneration.findOneAndUpdate({
        _id: payload._id
      }, {
        status: 'PENDING',
        generationId: requestId,
        rowLocked: false,
      });

    }

  } else if (status === 'PENDING') {


    const responseData = await listenToPendingCassetteAiRequest(payload);


    if (responseData && responseData.remoteUrl) {


      const audioUrl = responseData.remoteUrl;


      // Call our utility:

      await finalizeRemoteAudioGeneration({
        sessionId: payload.sessionId,
        audioLayerId: payload.audioLayerId,
        audioGenerationId: payload._id,   
        remoteAudioUrl: audioUrl
      });
    } else {
      if (responseData.responseStatus === 'FAILED') {

        await retryOrDeleteFailedUpdate(payload);
        
      }

    }

  } else if (status === 'FAILED') {

    await retryOrDeleteFailedUpdate(payload);

    return {
      audio: null,
    };
  }

}


async function retryOrDeleteFailedUpdate(payload) {
  const { numRetries } = payload;

  if (numRetries < 3) {


    // Increment the number of retries
    payload.numRetries += 1;
    payload.musicGenerationStatus = 'INIT';
    payload.status = 'INIT';

    // Save the updated payload
    await AudioGeneration.findByIdAndUpdate(payload._id, payload);

    // Retry the generation
    await dispatchAndProcessCassetteAIMusicRequest(payload);
  } else {
    await markAudioGenerationAsFailed(payload._id, 'CassetteAI music generation failed after retries.');
    await AudioGeneration.findByIdAndDelete(payload._id);
  }
}



const FA_AUDIO_LINK = "CassetteAI/music-generator";


export async function requestGenerateCassetteAiLayer(payload) {

  let { prompt, duration } = payload;

  if (!duration) {
    duration = 10;
  }
  if (duration > 180) {
    duration = 180;
  }
  try {

    const { request_id } = await fal.queue.submit(FA_AUDIO_LINK, {
      input: {
        prompt: prompt,
        duration: duration,
      }
    });




    return request_id;

  } catch (error) {
    throw createSubmissionOutcomeUnknownError(error, 'CassetteAI submission');
  }
}


export async function listenToPendingCassetteAiRequest(payload) {

  const { generationId } = payload;




  const responseStatusData = await fal.queue.status(FA_AUDIO_LINK, {
    requestId: generationId,
    logs: true,
  });


  const responseStatus = responseStatusData.status;


  if (responseStatus === 'COMPLETED') {
    const result = await fal.queue.result(FA_AUDIO_LINK, {
      requestId: generationId
    });


    const audioUrl = result.data.audio_file.url;

    return {
      responseStatus: 'COMPLETED',
      remoteUrl: audioUrl
    };
  } else if (responseStatus === 'FAILED') {
    return {
      responseStatus: 'FAILED'
    }
  } else {
    return {
      responseStatus: 'PENDING'
    }
  }

}
