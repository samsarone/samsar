
import { finalizeRemoteAudioGeneration, markAudioGenerationAsFailed } from "./audioUtils.js";
import AudioGeneration from "../schema/AudioGeneration.js";

import { fal } from "@fal-ai/client";
import dayjs from 'dayjs';



/* ----------  new / extra imports  ---------- */
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";



import { tmpdir } from "os";
import { join as joinPath } from "path";
import { v4 as uuidv4 } from "uuid";
import { promises as fs } from "fs";         // optional, in case you upload / delete temp files
import { uploadMusicToCDN } from '../AWS.js';
import {
  AUDIO_FFPROBE_THREAD_OPTIONS,
  applySingleThreadAudioFfmpeg,
} from '../utils/FfmpegResources.js';

import { getSimplifiedBackingTrackPromptForRetry } from "./BackingTrackPromptUtils.js";





/* ---------- helper: download remote asset with axios ---------- */
import axios from "axios";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";   // Node ≥ 16
import { getCurrentEnvironment, isDockerRuntime } from "../util/environmentUtils.js";
import { createSubmissionOutcomeUnknownError } from '../utils/ProviderSubmissionSafety.js';



const currentEnv = getCurrentEnvironment();

if (currentEnv === 'docker') {
  ffmpeg.setFfmpegPath('/usr/bin/ffmpeg');
  ffmpeg.setFfprobePath('/usr/bin/ffprobe');
} else {
  const { default: ffprobePath } = await import('ffprobe-static');
  ffmpeg.setFfmpegPath(ffmpegPath);
  ffmpeg.setFfprobePath(ffprobePath.path);
}


const FAL_API_KEY = process.env.FAL_API_KEY;

fal.config({
  credentials: FAL_API_KEY
});


function getTempDir(sessionId = 'audio') {
  const isDockerEnv = isDockerRuntime();
  const safeSessionId = String(sessionId || 'audio').replace(/[^a-zA-Z0-9_-]/g, '_');
  const tempDir = isDockerEnv ? joinPath(process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2', 'temp', safeSessionId) : tmpdir();

  if (isDockerEnv) {
    fs.access(tempDir)
      .catch(() => fs.mkdir(tempDir, { recursive: true }))
      .catch((err) => {
        console.error("Failed to create temp dir:", err);
      });
  }

  return tempDir;
}



export async function dispatchAndProcessLyriaAIMusicRequest(payload) {




  const { model, status } = payload;


  if (status === 'INIT') {
    const requestId = await requestGenerateLyriaAiLayer(payload);

    if (requestId) {


      await AudioGeneration.findOneAndUpdate({
        _id: payload._id
      }, {
        status: 'PENDING',
        generationId: requestId,
        rowLocked: false,
      });

      return;
    }

    await retryOrDeleteFailedUpdate(payload, 'Failed to submit Lyria backing track request.');
    return;

  } else if (status === 'PENDING') {

    let responseData;
    try {
      responseData = await listenToPendingLyriaAiRequest(payload);
    } catch (error) {
      console.error(`listenToPendingLyriaAiRequest failed for audioGeneration ${payload._id}:`, error);
      responseData = { responseStatus: 'FAILED' };
    }


    if (responseData && responseData.remoteUrl) {


      const audioUrl = responseData.remoteUrl;

      await finalizeRemoteAudioGeneration({
        sessionId: payload.sessionId,
        audioLayerId: payload.audioLayerId,
        audioGenerationId: payload._id,
        remoteAudioUrl: audioUrl
      });
    } else {
      if (responseData?.responseStatus === 'FAILED') {


        const failureAction = await retryOrDeleteFailedUpdate(
          payload,
          responseData.error || 'Lyria backing track generation failed.'
        );

        if (failureAction === 'RETRY_SCHEDULED') {
        } else {
        }
      }

    }

  } else if (status === 'FAILED') {
    await retryOrDeleteFailedUpdate(payload, payload?.error || 'Lyria backing track generation failed.');

    return {
      audio: null,
    };
  }

}


async function retryOrDeleteFailedUpdate(payload, errorMessage) {
  const currentRetries = Number.isFinite(Number(payload?.numRetries))
    ? Number(payload.numRetries)
    : 0;

  if (currentRetries < 1) {
    const nextRetryCount = currentRetries + 1;
    const generationMeta = payload?.generationMeta && typeof payload.generationMeta === 'object'
      ? { ...payload.generationMeta }
      : {};
    const originalBackingTrackPrompt =
      typeof generationMeta.originalBackingTrackPrompt === 'string' && generationMeta.originalBackingTrackPrompt.trim()
        ? generationMeta.originalBackingTrackPrompt.trim()
        : payload.prompt;
    const alternatePrompt = await getSimplifiedBackingTrackPromptForRetry(
      originalBackingTrackPrompt,
      errorMessage,
      { request: payload },
    );

    await AudioGeneration.findByIdAndUpdate(payload._id, {
      numRetries: nextRetryCount,
      musicGenerationStatus: 'INIT',
      status: 'INIT',
      prompt: alternatePrompt,
      generationId: null,
      error: errorMessage || null,
      rowLocked: false,
      generationMeta: {
        ...generationMeta,
        originalBackingTrackPrompt,
        backingTrackPromptSimplified: true,
      },
    });

    return 'RETRY_SCHEDULED';
  } else {
    await markAudioGenerationAsFailed(payload._id, errorMessage || 'Lyria backing track generation failed after retry.');
    await AudioGeneration.findByIdAndDelete(payload._id);
    return 'FAILED';
  }
}



const FA_AUDIO_LINK = "fal-ai/lyria2";


export async function requestGenerateLyriaAiLayer(payload) {

  let { prompt, duration } = payload;

  if (!prompt) {
    
    prompt = `Create a beautiful and serene backing track for a generative video composition`;
  }

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
        negative_prompt: "vocals",
      }
    });




    return request_id;

  } catch (error) {
    console.error('Failed to submit Lyria backing track request:', error?.message || error);
    throw createSubmissionOutcomeUnknownError(error, 'FAL Lyria submission');
  }
}





async function downloadToTmp(url, sessionId = 'audio') {
  const tempDir = getTempDir(sessionId);

  const tmpPath = joinPath(tempDir, `lyria-src-${uuidv4()}.mp3`);
  const res = await axios.get(url, { responseType: "stream", maxRedirects: 5 });

  // Axios throws for non-2xx codes, so res.status is already OK here
  await pipeline(res.data, createWriteStream(tmpPath));
  return tmpPath;
}

/* ---------- helper: make sure clip is long enough  ---------- */
async function ensureAudioLength(sourceUrl, wantedSec = 10, sessionId = 'audio') {
  let tmpIn = null;

  try {
    /* 0. download first --------------------------------------------------- */
    tmpIn = await downloadToTmp(sourceUrl, sessionId);

    /* 1. probe duration --------------------------------------------------- */
    let realSec;
    try {
      realSec = await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(tmpIn, AUDIO_FFPROBE_THREAD_OPTIONS, (err, data) => {
          if (err) return reject(err);
          resolve(data.format.duration || 0);
        });
      });
    } catch (e) {
      console.error("[ensureAudioLength] ffprobe failed – using original", e);
      return sourceUrl;
    }

    realSec = Number(realSec);
    if (!Number.isFinite(realSec) || realSec <= 0) {
      return sourceUrl;
    }

    /* 2. already long enough? -------------------------------------------- */
    if (realSec >= wantedSec - 0.25) {
      return sourceUrl;
    }

    /* 3. loop + trim ------------------------------------------------------ */
    const loopsNeeded = Math.ceil(wantedSec / realSec);
    const tempDir = getTempDir(sessionId);

    const tmpOut = joinPath(tempDir, `lyria-looped-${uuidv4()}.mp3`);

    // Keep loop boundaries aligned to the original rendered item and soften each boundary.
    const maxFadeWindow = (realSec / 2) - 0.01;
    const loopFadeSec = Math.min(0.8, maxFadeWindow);
    const useBoundaryFades = loopsNeeded > 1 && Number.isFinite(loopFadeSec) && loopFadeSec > 0.05;
    const outputOptions = ["-t", String(wantedSec), "-c:a", "libmp3lame"];

    if (useBoundaryFades) {
      const loopSec = Number(realSec.toFixed(6));
      const fadeSec = Number(loopFadeSec.toFixed(6));
      const fadeOutStart = Number((loopSec - fadeSec).toFixed(6));

      // Repeating fade envelope based on mod(t, loopSec):
      // - fade out before each loop end
      // - fade in at each loop start
      const boundaryFadeFilter =
        `volume=if(lt(mod(t\\,${loopSec})\\,${fadeSec})\\,mod(t\\,${loopSec})/${fadeSec}` +
        `\\,if(gt(mod(t\\,${loopSec})\\,${fadeOutStart})\\,(${loopSec}-mod(t\\,${loopSec}))/${fadeSec}\\,1))`;
      outputOptions.push("-af", boundaryFadeFilter);
    }

    try {
      await new Promise((resolve, reject) => {
        applySingleThreadAudioFfmpeg(
          ffmpeg()
            .input(tmpIn)
            .inputOptions(["-stream_loop", String(loopsNeeded - 1)]),
        )
          .outputOptions(outputOptions)
          .save(tmpOut)
          .on("end", resolve)
          .on("error", reject);
      });
      return tmpOut;
    } catch (e) {
      console.error("[ensureAudioLength] ffmpeg failed – using original", e);
      return sourceUrl;
    }
  } finally {
    if (tmpIn) fs.unlink(tmpIn).catch(() => { });
  }
}




/* ----------  UPDATED listenToPendingLyriaAiRequest()  ---------- */
/**
 * Polls the Fal queue & returns the (possibly extended) audio.
 * @param {Object} payload
 * @param {string} payload.generationId   Fal request_id
 * @param {number} [payload.duration=10]  Desired seconds
 * @returns {Promise<{responseStatus: string, remoteUrl?: string}>}
 */
export async function listenToPendingLyriaAiRequest(payload) {
  const { generationId, duration = 10 } = payload;

  // Ask Fal what the job status is
  let responseStatusData;
  try {
    responseStatusData = await fal.queue.status(FA_AUDIO_LINK, {
      requestId: generationId,
      logs: true,
    });
  } catch (error) {
    console.error(`Failed to fetch fal queue status for ${generationId}:`, error);
    return {
      responseStatus: "PENDING",
      error: error?.message || 'Failed to fetch Lyria queue status.',
    };
  }

  const responseStatus = responseStatusData.status;


  if (responseStatus === "COMPLETED") {

    let result;
    try {
      result = await getFalQueueResultWithRetry(generationId);
    } catch (error) {
      console.error("Error fetching result:", error);
      console.error(error);

      return {
        responseStatus: "FAILED",
        error: error?.message || 'Failed to fetch Lyria result.',
      };
    }

    let rawAudioUrl = result.data.audio.url;


    if (duration > 30) {


      const fixedAudioPathOrUrl = await ensureAudioLength(rawAudioUrl, duration, payload.sessionId);


      const dateString = dayjs().format('YYYY-MM-DD_HH-mm-ss');


      const audioRemoteFileName = `audio_${payload.sessionId}_${payload.audioLayerId}_${dateString}.mp3`;



      let localAudioPath = fixedAudioPathOrUrl;
      let cleanupPath = null;
      const tempDirBase = getTempDir(payload.sessionId);

      if (typeof fixedAudioPathOrUrl === 'string' && fixedAudioPathOrUrl.startsWith('http')) {
        localAudioPath = await downloadToTmp(fixedAudioPathOrUrl, payload.sessionId);
        cleanupPath = localAudioPath;
      } else if (
        typeof fixedAudioPathOrUrl === 'string' &&
        tempDirBase &&
        fixedAudioPathOrUrl.startsWith(tempDirBase)
      ) {
        cleanupPath = fixedAudioPathOrUrl;
      }

      try {
        const audioRemotePath = await uploadMusicToCDN(localAudioPath, audioRemoteFileName);
        rawAudioUrl = audioRemotePath;
    } catch (error) {
        console.error(`Failed to upload extended Lyria audio for ${payload._id}:`, error);
        return {
          responseStatus: "FAILED",
          error: error?.message || 'Failed to upload extended Lyria audio.',
        };
      } finally {
        if (cleanupPath) {
          await fs.unlink(cleanupPath).catch(() => { });
        }
      }
    }
    return {
      responseStatus: "COMPLETED",
      remoteUrl: rawAudioUrl,
    };
  }

  if (responseStatus === "FAILED") {
    return {
      responseStatus: "FAILED",
      error: 'Lyria queue request failed.',
    };
  }

  // still cooking…
  return { responseStatus: "PENDING" };
}


async function getFalQueueResultWithRetry(requestId, maxRetries = 3, baseDelay = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await fal.queue.result(FA_AUDIO_LINK, {
        requestId,
      });
      return result;
    } catch (error) {
      if (attempt === maxRetries) {
        console.error(`Fal queue result failed after ${maxRetries} attempts`);
        throw error;
      }

      const delay = baseDelay * Math.pow(2, attempt - 1); // exponential backoff: 1s, 2s, 4s
      console.error(`Retry ${attempt} failed. Retrying in ${delay}ms...`);
      await new Promise(res => setTimeout(res, delay));
    }
  }
}
