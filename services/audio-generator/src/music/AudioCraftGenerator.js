import { getDBConnectionString } from '../DBString.js';
import VideoSession from '../schema/VideoSession.js';
import { writeFile } from "node:fs/promises";
import AudioGeneration from '../schema/AudioGeneration.js';
import { generateS3UrlsFromLocalFile } from '../AWS.js';
import { markAudioGenerationAsFailed, upsertGeneratedMusicArtifact } from './audioUtils.js';
import { getProcessorAssetsV2Path, toAssetsV2RelativePath } from '../utils/AssetPaths.js';
import { createSubmissionOutcomeUnknownError, getProviderStatus, rethrowAudioMediaDownloadError } from '../utils/ProviderSubmissionSafety.js';

import path from 'path';
import fs from 'fs';

const REPLICATE_PREDICTIONS_URL = 'https://api.replicate.com/v1/predictions';
const AUDIOCRAFT_VERSION = '671ac645ce5e552cc63a54a2bbff63fcf798043055d2dac5fc9e36a837eedcfb';

async function readPrediction(fetchImpl, url, options) {
  const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(90000) });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch {
    if (response.ok) throw Object.assign(new Error('Replicate returned an invalid prediction response.'), { status: 502 });
  }
  if (!response.ok) {
    throw Object.assign(new Error(typeof body?.detail === 'string' ? body.detail : `Replicate request failed (${response.status}).`), {
      status: response.status, response: { status: response.status, data: body },
    });
  }
  if (!body || Array.isArray(body) || typeof body.id !== 'string' || !body.id.trim() ||
      !['starting', 'processing', 'succeeded', 'failed', 'canceled', 'cancelled'].includes(body.status)) {
    throw Object.assign(new Error('Replicate returned an invalid prediction envelope.'), { status: 502 });
  }
  return body;
}

// A terminal provider/content failure may use the existing bounded retry
// policy. Queue it for the next claim; never recursively submit from a catch.
async function retryDefinitiveFailure(payload, message, Model, markFailed) {
  const retries = Math.max(0, Number(payload.numRetries) || 0);
  if (retries >= 3) {
    await markFailed(payload._id, message || 'Music generation failed 3 times.');
    return;
  }
  await Model.findOneAndUpdate({ _id: payload._id }, { $set: {
    status: 'INIT', musicGenerationStatus: 'INIT', rowLocked: false,
    numRetries: retries + 1, error: message, nextAttemptAfter: null,
    providerSubmissionStartedAt: null, providerSubmissionLeaseExpiresAt: null,
  }, $unset: { apiRequestId: '', generationId: '', replicateOutputUrl: '' } });
}

export async function dispatchAndProcessAudiocraftMusicRequest(request, {
  connect = getDBConnectionString, Model = AudioGeneration,
  fetchImpl = globalThis.fetch, env = process.env,
  complete = updateAudiocraftGenerationStatus, markFailed = markAudioGenerationAsFailed,
} = {}) {
  await connect();
  const payload = typeof request.toObject === 'function' ? request.toObject() : request;
  const token = typeof env.REPLICATE_API_TOKEN === 'string' ? env.REPLICATE_API_TOKEN.trim() : '';
  if (!token) throw Object.assign(new Error('REPLICATE_API_TOKEN is required for AudioCraft.'), { providerRequestSent: false });
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  let prediction;
  const acceptedId = payload.apiRequestId || payload.generationId;
  if (acceptedId) {
    if (!payload.replicateOutputUrl) {
      try {
        prediction = await readPrediction(fetchImpl, `${REPLICATE_PREDICTIONS_URL}/${encodeURIComponent(acceptedId)}`, { headers });
        if (prediction.id !== acceptedId) throw Object.assign(new Error('Replicate returned a different prediction ID.'), { status: 502 });
      } catch (error) {
        if ([400, 401, 403, 404, 410, 422].includes(getProviderStatus(error))) error.providerMediaUnavailable = true;
        throw error;
      }
    }
  } else if (payload.status === 'PENDING' || payload.musicGenerationStatus === 'PENDING') {
    throw Object.assign(createSubmissionOutcomeUnknownError(new Error('Pending AudioCraft request has no saved prediction ID.')),
      { providerRequestUnpollable: true });
  } else if (payload.musicGenerationStatus === 'FAILED') {
    if (payload.submissionOutcomeUnknown) throw createSubmissionOutcomeUnknownError(new Error('AudioCraft acceptance was not confirmed.'));
    await retryDefinitiveFailure(payload, payload.error, Model, markFailed);
    return;
  } else {
    // The installed Replicate SDK retries POST transport failures internally.
    // Submit directly once, then checkpoint the real ID before any other work.
    try {
      prediction = await readPrediction(fetchImpl, REPLICATE_PREDICTIONS_URL, { method: 'POST',
        headers: { ...headers, Prefer: 'wait' }, body: JSON.stringify({ version: AUDIOCRAFT_VERSION, input: {
          prompt: payload.prompt, model_version: 'stereo-large', output_format: 'mp3',
          normalization_strategy: 'peak', duration: payload.duration,
        } }),
      });
      if (typeof prediction?.id !== 'string' || !prediction.id.trim()) throw new Error('Replicate did not return a prediction ID.');
      const fields = { status: 'PENDING', musicGenerationStatus: 'PENDING',
        apiRequestId: prediction.id, generationId: prediction.id, submittedAdapter: 'replicate',
        expireAt: null, rowLocked: true };
      const saved = await Model.findOneAndUpdate({ _id: payload._id, status: 'INIT' }, { $set: fields }, { new: true });
      if (!saved) throw new Error('The accepted AudioCraft prediction could not be checkpointed.');
      Object.assign(payload, fields);
    } catch (error) {
      if ([400, 422, 429].includes(getProviderStatus(error))) {
        await retryDefinitiveFailure(payload, error.message, Model, markFailed);
        return;
      }
      throw createSubmissionOutcomeUnknownError(error, 'AudioCraft submission');
    }
  }

  if (prediction && ['failed', 'canceled', 'cancelled'].includes(prediction.status)) {
    await retryDefinitiveFailure(payload, prediction.error || 'AudioCraft prediction failed.', Model, markFailed);
    return;
  }
  if (!payload.replicateOutputUrl && prediction?.status !== 'succeeded') return;
  const outputUrl = payload.replicateOutputUrl || (Array.isArray(prediction.output) ? prediction.output[0] : prediction.output);
  if (typeof outputUrl !== 'string' || !/^https?:\/\//i.test(outputUrl)) {
    throw Object.assign(new Error('AudioCraft completed without a usable audio URL.'), { providerMediaUnavailable: true });
  }
  if (!payload.replicateOutputUrl) {
    await Model.findOneAndUpdate({ _id: payload._id, apiRequestId: payload.apiRequestId }, { $set: { replicateOutputUrl: outputUrl } });
    payload.replicateOutputUrl = outputUrl;
  }
  try {
    const response = await fetchImpl(outputUrl, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw Object.assign(new Error(`AudioCraft output download failed (${response.status}).`), { status: response.status });
    const output = Buffer.from(await response.arrayBuffer());
    await complete({ ...payload, status: 'COMPLETED' }, output);
  } catch (error) {
    rethrowAudioMediaDownloadError(error);
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
