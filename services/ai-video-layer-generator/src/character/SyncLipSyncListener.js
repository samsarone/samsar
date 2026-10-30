import { buildSyncLipSyncInput } from '../utils/SyncLipSyncFace.js';
import { fal } from "@fal-ai/client";
const FAL_API_KEY = process.env.FAL_API_KEY;

fal.config({
  credentials: FAL_API_KEY
});


import { getDBConnectionString } from "../DBString.js";

function summarizeMediaUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  try {
    const parsed = new URL(value);
    return {
      protocol: parsed.protocol.replace(/:$/, ''),
      host: parsed.host,
      pathname: parsed.pathname,
    };
  } catch {
    return { value };
  }
}

function summarizeProviderError(error) {
  return {
    message: error?.message || String(error),
    name: error?.name || null,
    status: error?.status || error?.statusCode || error?.response?.status || null,
    body: error?.body || error?.response?.data || error?.data || null,
    stack: error?.stack || null,
  };
}

const RETRYABLE_POLL_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_POLL_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN']);

export function isRetryableSyncLipSyncPollError(error) {
  const status = Number(error?.status || error?.statusCode || error?.response?.status);
  return RETRYABLE_POLL_STATUSES.has(status) || RETRYABLE_POLL_CODES.has(error?.code);
}

export async function generateSyncLipSyncLayer(payload) {

  const { videoLink, audioLink } = payload;
  


  const inputPayload = buildSyncLipSyncInput(payload);

  if (!videoLink || !audioLink) {
    throw new Error("Missing video or audio link");
  }

  const FAL_VIDEO_LINK = getSyncLipSyncForModel();

  const apiRequestPayload = {
    input: inputPayload,
  }

  try {
    console.log('[lip_sync][syncliplayer][submit] submitting Sync lip sync request', {
      sessionId: payload?.sessionId || null,
      layerId: payload?.layerId || null,
      model: payload?.model || null,
      duration: payload?.duration,
      retryOnFail: payload?.retryOnFail,
      videoUrl: summarizeMediaUrl(videoLink),
      audioUrl: summarizeMediaUrl(audioLink),
    });

    const { request_id } = await fal.queue.submit(FAL_VIDEO_LINK, apiRequestPayload);

    console.log('[lip_sync][syncliplayer][submit] Sync lip sync request accepted', {
      sessionId: payload?.sessionId || null,
      layerId: payload?.layerId || null,
      requestId: request_id,
    });

    return request_id;
  } catch (error) {
    const errorSummary = summarizeProviderError(error);
    console.error('[lip_sync][syncliplayer][submit_failed] Sync lip sync submit failed', {
      sessionId: payload?.sessionId || null,
      layerId: payload?.layerId || null,
      model: payload?.model || null,
      duration: payload?.duration,
      videoUrl: summarizeMediaUrl(videoLink),
      audioUrl: summarizeMediaUrl(audioLink),
      error: errorSummary,
    });
    const submitError = new Error(`SYNCLIPSYNC submit failed: ${errorSummary.message}`);
    submitError.providerError = errorSummary;
    throw submitError;
  }

}

export async function listenToPendingSyncLipSyncRequests(payload, dependencies = {}) {

    await (dependencies.connect || getDBConnectionString)();
  


    const { generationId, model } = payload;
    const queue = dependencies.queue || fal.queue;
    let providerCompleted = false;


    try {
  
      const FAL_VIDEO_LINK = getSyncLipSyncForModel();
  
  
      const responseStatusData = await queue.status(FAL_VIDEO_LINK, {
        requestId: generationId,
      });


  
  
      const responseStatus = responseStatusData.status;
  
  
      if (responseStatus === 'COMPLETED') {
        providerCompleted = true;
  
  
        const result = await queue.result(FAL_VIDEO_LINK, {
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
        console.error('[lip_sync][syncliplayer][poll_failed] Sync lip sync provider returned FAILED', {
          requestId: generationId,
          model,
          status: responseStatusData,
        });

        return {
          responseStatus: 'FAILED',
          providerFailureMessage: 'SYNCLIPSYNC provider returned FAILED',
          providerStatus: responseStatusData,
        };
      } else {
        return {
          responseStatus: 'PENDING'
        }
      }
  
    } catch (error) {
      console.error('[lip_sync][syncliplayer][poll_error] Sync lip sync poll failed', {
        requestId: generationId,
        model,
        error: summarizeProviderError(error),
      });

      const body = error?.body || error?.response?.data || error?.data;
      const resultErrors = Array.isArray(body?.detail)
        ? body.detail.filter((detail) => typeof detail?.type === 'string' && typeof detail?.msg === 'string')
        : [];
      // FAL marks execution complete even when its result is a model failure.
      // A structured error from that result is final, including HTTP 5xx errors;
      // retrying retrieval cannot make the failed execution produce a video.
      if (providerCompleted && resultErrors.length) {
        return {
          responseStatus: 'FAILED',
          providerFailureMessage: resultErrors.map((detail) => detail.msg).join('; '),
          providerStatus: {
            status: error?.status || error?.statusCode || error?.response?.status || null,
            ...body,
          },
        };
      }

      // A queue status/result timeout says nothing about the accepted FAL job.
      // Keep its provider request ID and poll again instead of submitting twice.
      if (isRetryableSyncLipSyncPollError(error)) {
        return { responseStatus: 'PENDING' };
      }
  
      return {
        responseStatus: 'FAILED',
        providerFailureMessage: error?.message || String(error),
      }
    }

  
}


function getSyncLipSyncForModel() {
  return "fal-ai/sync-lipsync/v3";
}
