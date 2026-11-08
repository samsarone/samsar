import { isProviderNetworkError, isProviderHttpFailure, completedProviderResultFailure } from '../utils/ProviderNetworkRecovery.js';
import { fal } from "@fal-ai/client";
const FAL_API_KEY = process.env.FAL_API_KEY;

fal.config({
  credentials: FAL_API_KEY
});


import { getDBConnectionString } from "../DBString.js";
import AIVideoLayerGeneration from '../schema/AIVideoLayerGeneration.js';
import { getVideoDuration } from '../VideoProcessor.js';
import { videoBillingError, videoBillingMode } from '../billing/VideoPricing.js';
import { requireCurrentFalLipSyncTariff } from '../billing/FalLipSyncTariffs.js';


export async function generateKlingLipSyncLayer(payload, dependencies = {}) {

  const { videoLink, audioLink } = payload;

  const inputPayload = {
    video_url: videoLink,
    audio_url: audioLink,
  };



  if (!videoLink || !audioLink) {
    throw new Error("Missing video or audio link");
  }

  if (videoBillingMode(payload, dependencies.env || process.env) === 'adapter') {
    requireCurrentFalLipSyncTariff('KLINGLIPSYNC');
    if (!payload._id) throw videoBillingError('The Kling lip sync billing queue ID is missing.');
    let inputSeconds;
    try {
      inputSeconds = await (dependencies.probeDuration || getVideoDuration)(videoLink);
    } catch {
      // ffprobe errors can include the signed input URL.
      throw videoBillingError('The Kling lip sync input duration could not be measured.');
    }
    if (!Number.isFinite(inputSeconds) || inputSeconds <= 0) {
      throw videoBillingError('The Kling lip sync input duration is invalid.');
    }
    const nativeReceipt = { adapter: 'fal', model: 'KLINGLIPSYNC', inputSeconds };
    const persistNativeReceipt = dependencies.persistNativeReceipt || (async (id, receipt) => {
      await getDBConnectionString();
      const update = await AIVideoLayerGeneration.updateOne({ _id: id },
        { $set: { videoBillingNativeReceipt: receipt } });
      if (update.matchedCount !== 1) throw videoBillingError('The Kling lip sync billing queue is unavailable.');
    });
    await persistNativeReceipt(payload._id, nativeReceipt);
    payload.videoBillingNativeReceipt = nativeReceipt;
  }



  const FAL_VIDEO_LINK = getLatentSyncForModel();



  const apiRequestPayload = {
    input: inputPayload,
  }



  try {

    const { request_id } = await (dependencies.queue || fal.queue).submit(FAL_VIDEO_LINK, apiRequestPayload);



    return request_id;
  } catch (error) {
    if (isProviderNetworkError(error)) throw error;
    console.error("Error generating lipsync");
    


    return {
      responseStatus: 'FAILED'
    }
  }

}

export async function listenToPendingKlingLipSyncRequests(payload) {
  await getDBConnectionString();



  const { generationId, model } = payload;

  let providerCompleted = false;
  try {

    const FAL_VIDEO_LINK = getLatentSyncForModel();


    const responseStatusData = await fal.queue.status(FAL_VIDEO_LINK, {
      requestId: generationId,
    });

    const responseStatus = responseStatusData.status;

    if (responseStatus === 'COMPLETED') {
      providerCompleted = true;

      const result = await fal.queue.result(FAL_VIDEO_LINK, {
        requestId: generationId
      });

      const videoURL = result.data.video.url;
      if (!videoURL) {
        return {
          responseStatus: 'FAILED'
        };
      }
      return {
        responseStatus: 'COMPLETED',
        remoteUrl: videoURL
      };
    } else if (responseStatus === 'FAILED') {
      console.error("LIP SYNC FAILED");
      

      return {
        responseStatus: 'FAILED'
      };
    } else {
      return {
        responseStatus: 'PENDING'
      }
    }

  } catch (error) {
    const executionFailure = providerCompleted ? completedProviderResultFailure(error) : null;
    if (executionFailure) return executionFailure;
    if (isProviderNetworkError(error) || isProviderHttpFailure(error)) throw error;
    console.error(error);

    return {
      responseStatus: 'FAILED'
    }
  }
}

function getLatentSyncForModel() {
  return "fal-ai/kling-video/lipsync/audio-to-video";
}
