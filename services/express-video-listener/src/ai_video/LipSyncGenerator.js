import { getDBConnectionString } from "../DBString.js";
import AIVideoLayerGeneration from "../schema/AIVideoLayerGeneration.js";
import VideoSession from "../schema/VideoSession.js";

import fs from 'fs';
import path from 'path';

import { uploadSpeechAudioToCDN } from '../audio/AWS.js';
import { padBlankAudioAtBeginningAndEnd } from '../audio/Audio.js';
import { getCanonicalAiVideoReference } from './utils/ProviderMediaUrl.js';
import { publishLipSyncAudioWithRecovery } from './LipSyncMediaPreparation.js';
import { getSourceSceneMetadata } from './utils/SourceSceneMetadata.js';
import {
  findConnectedSpeechAudioLayer,
  hasLipSyncOutput,
  hasReusableBaseAiVideo,
  isCharacterLipSyncLayer,
} from './LipSyncStage.js';
import {
  resolveLocalAssetPath,
  toLocalAssetReference,
} from '../utils/LocalAssetPath.js';
import { isStandaloneEdition } from '../utils/EnvironmentUtils.js';

const ACTIVE_LIP_SYNC_REQUEST_STATUSES = ['INIT', 'PENDING'];

function shouldRetryLipSyncFailure(env = process.env) {
  return !isStandaloneEdition(env);
}


function normalizeStringId(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = value.toString().trim();
  return normalized || null;
}

function sanitizeRemoteFileNamePart(value) {
  const normalized = normalizeStringId(value);
  return normalized ? normalized.replace(/[^a-zA-Z0-9_-]/g, '') : null;
}

function buildPaddedAudioRemoteFileName({ sessionId, layerId, speechLayerId, paddedFileName }) {
  return [
    sanitizeRemoteFileNamePart(sessionId),
    sanitizeRemoteFileNamePart(layerId),
    sanitizeRemoteFileNamePart(speechLayerId),
    Date.now().toString(),
    paddedFileName,
  ].filter(Boolean).join('_');
}

function getCanonicalAudioReference(localReference, remoteReference) {
  const normalizedLocalReference = typeof localReference === 'string'
    ? localReference.trim()
    : '';
  if (normalizedLocalReference) {
    return normalizedLocalReference;
  }
  return typeof remoteReference === 'string' ? remoteReference.trim() : '';
}

function buildActiveLipSyncRequestQuery({ sessionId, layerId }) {
  return {
    sessionId: sessionId?.toString?.() || sessionId,
    layerId: layerId?.toString?.() || layerId,
    generationType: 'lip_sync',
    status: { $in: ACTIVE_LIP_SYNC_REQUEST_STATUSES },
  };
}

async function findActiveLipSyncGenerationRequest({ sessionId, layerId }) {
  if (!sessionId || !layerId) {
    return null;
  }

  return AIVideoLayerGeneration.findOne(
    buildActiveLipSyncRequestQuery({ sessionId, layerId })
  ).sort({ createdAt: -1 });
}

function getUploadedAudioReference(uploadedReference, localReference, remoteReference) {
  const normalizedUploadedReference = typeof uploadedReference === 'string'
    ? uploadedReference.trim()
    : '';
  if (normalizedUploadedReference) {
    return normalizedUploadedReference;
  }
  return getCanonicalAudioReference(localReference, remoteReference);
}

function buildLipSyncLayerWriteGuard(sessionId, layerId) {
  return {
    _id: sessionId,
    expressGenerationPaused: { $ne: true },
    expressGenerationCancelled: { $ne: true },
    expressGenerationFailed: { $ne: true },
    layers: { $elemMatch: { _id: layerId, lipSyncVideoGenerationStatus: { $ne: 'COMPLETED' } } },
  };
}

async function markLipSyncLayerFailed(sessionId, layerId, error) {
  if (!sessionId || !layerId) {
    return;
  }
  const message = error?.message || String(error || 'Lip sync generation failed.');
  await VideoSession.updateOne(
    buildLipSyncLayerWriteGuard(sessionId, layerId),
    {
      $set: {
        ...(error?.lipSyncInfrastructureFailure === true ? {
          'layers.$.lipSyncInfrastructureFailure': true,
          'layers.$.lipSyncVideoGenerationErrorCode': error.code,
          providerNetworkFailure: {
            code: error.code, message, stage: 'lip_sync_generation',
            layerId: layerId.toString(), phase: 'prepare', failedAt: new Date(),
          },
        } : {}),
        'layers.$.lipSyncGenerationPending': false,
        'layers.$.hasLipSyncVideoLayer': false,
        'layers.$.lipSyncVideoGenerationStatus': 'FAILED',
        'layers.$.lipSyncVideoGenerationError': message,
        lastLipSyncGenerationError: message,
      },
    },
  );
}


export async function generateLipSyncForSession(sessionId) {

  await getDBConnectionString();


  const sessionData = await VideoSession.findOne({ _id: sessionId });
  if (!sessionData) {
    throw new Error(`VideoSession with ID ${sessionId} not found`);
  }

  const sessionLayers = Array.isArray(sessionData.layers) ? sessionData.layers : [];
  const sessionAudioLayers = Array.isArray(sessionData.audioLayers) ? sessionData.audioLayers : [];

  await enqueueLipSyncLayers(sessionId, sessionLayers, sessionAudioLayers);
}

async function enqueueLipSyncLayers(
  sessionId,
  sessionLayers,
  sessionAudioLayers,
  {
    generateLayer = generateLipSyncForLayer,
    markFailed = markLipSyncLayerFailed,
    log = (...args) => console.warn(...args),
  } = {},
) {
  for (let i = 0; i < sessionLayers.length; i++) {
    const currentLayer = sessionLayers[i];

    const hasBaseAiVideo = hasReusableBaseAiVideo(currentLayer);

    if (!isCharacterLipSyncLayer(currentLayer) || !hasBaseAiVideo || hasLipSyncOutput(currentLayer)) {
      continue;
    }

    const connectedAudioLayer = findConnectedSpeechAudioLayer(
      sessionAudioLayers,
      currentLayer,
      i,
    );

    // A character scene without connected speech never enters lip sync.
    if (!connectedAudioLayer) {
      continue;
    }

    try {
      await generateLayer(sessionId, currentLayer, connectedAudioLayer);
    } catch (error) {
      await markFailed(sessionId, currentLayer._id, error);
      log(error?.lipSyncInfrastructureFailure === true
        ? '[lip_sync][request_enqueue] media publication recovery exhausted'
        : '[lip_sync][request_enqueue] keeping base AI video after lip-sync setup failure', {
        sessionId,
        layerId: normalizeStringId(currentLayer._id),
        error: error?.message || String(error),
      });
      if (error?.lipSyncInfrastructureFailure === true) return;
    }
  }

}



export async function generateLipSyncForLayer(sessionId, currentLayer, connectedAudioLayer) {
  // 1) Download the remote audio if needed
  //    Make sure the `selectedRemoteAudioLink` is a URL, then store locally.
  //    If it's already local or you handle local paths differently, adapt accordingly.


  const sessionData = await VideoSession.findOne({ _id: sessionId });
  if (!sessionData) {
    throw new Error(`VideoSession with ID ${sessionId} not found`);

  }

  const existingLipSyncRequest = await findActiveLipSyncGenerationRequest({
    sessionId,
    layerId: currentLayer._id,
  });

  if (existingLipSyncRequest) {
    await VideoSession.updateOne(
      buildLipSyncLayerWriteGuard(sessionId, currentLayer._id),
      {
        $set: {
          'layers.$.lipSyncGenerationPending': true,
          'layers.$.lipSyncVideoGenerationStatus': 'PENDING',
          'layers.$.lipSyncVideoGenerationError': null,
          'layers.$.lipSyncInfrastructureFailure': false,
          'layers.$.lipSyncVideoGenerationErrorCode': null,
        },
      },
    );
    console.log('[lip_sync][request_enqueue] reusing active lip sync generation request', {
      sessionId,
      layerId: currentLayer?._id?.toString?.() || currentLayer?._id || null,
      generationRequestId: existingLipSyncRequest?._id?.toString?.() || existingLipSyncRequest?._id || null,
      status: existingLipSyncRequest?.status || null,
    });
    return existingLipSyncRequest;
  }

  const userId = sessionData.userId;


  const audioLayerIndex = sessionData.audioLayers.findIndex(
    (layer) => layer._id.toString() === connectedAudioLayer._id.toString()
  );




  if (audioLayerIndex === -1) {
    throw new Error(
      `Connected speech audio layer ${normalizeStringId(connectedAudioLayer?._id) || 'unknown'} is missing from session ${sessionId}.`,
    );
  }

  const refreshedAudioLayer = sessionData.audioLayers[audioLayerIndex];
  const sourceAudioData = refreshedAudioLayer.previousAudioData || {};
  const selectedLocalAudioLink =
    sourceAudioData.selectedLocalAudioLink ||
    refreshedAudioLayer.selectedLocalAudioLink ||
    refreshedAudioLayer.localAudioLinks?.[0];

  const audioPrompt = refreshedAudioLayer.prompt;

  const speechLayerId = refreshedAudioLayer._id.toString();

  let remoteUrl =
    sourceAudioData.selectedRemoteAudioLink ||
    sourceAudioData.remoteAudioLink ||
    refreshedAudioLayer.selectedRemoteAudioLink ||
    refreshedAudioLayer.remoteAudioLinks?.[0];

  const speechLayerDurationFromPayload =
    typeof sourceAudioData.duration === 'number' && sourceAudioData.duration > 0
      ? sourceAudioData.duration
      : refreshedAudioLayer.originalDuration > 0
        ? refreshedAudioLayer.originalDuration
        : refreshedAudioLayer.duration;



  if (!remoteUrl && !selectedLocalAudioLink) {
    throw new Error(
      `Connected speech audio layer ${speechLayerId} has no selected local or remote media reference.`,
    );
  }

  const resolvedLocalAudioFile = selectedLocalAudioLink
    ? resolveLocalAssetPath(selectedLocalAudioLink)
    : null;
  const hasLocalAudioFile = Boolean(
    resolvedLocalAudioFile && fs.existsSync(resolvedLocalAudioFile),
  );
  const localAudioFile = hasLocalAudioFile ? resolvedLocalAudioFile : null;
  const audioDir = localAudioFile ? path.dirname(localAudioFile) : null;

  if (audioDir && !fs.existsSync(audioDir)) {
    fs.mkdirSync(audioDir, { recursive: true });
  }



  let paddedAudioPath;
  let paddedAudioReference = getCanonicalAudioReference(
    hasLocalAudioFile ? selectedLocalAudioLink : '',
    remoteUrl,
  );
  if (!paddedAudioReference) {
    throw new Error(
      `Connected speech audio layer ${speechLayerId} has no readable local file or remote media reference.`,
    );
  }
  let paddedAudioRelativePath = selectedLocalAudioLink;
  const layerDuration = typeof currentLayer?.duration === 'number' ? currentLayer.duration : null;
  const speechLayerDuration = typeof speechLayerDurationFromPayload === 'number'
    ? speechLayerDurationFromPayload
    : null;

  let videoDuration = Number.isFinite(speechLayerDuration) ? speechLayerDuration : layerDuration;
  if (Number.isFinite(layerDuration) && layerDuration > 0 && Number.isFinite(videoDuration)) {
    videoDuration = Math.min(videoDuration, layerDuration);
  } else if (Number.isFinite(layerDuration) && layerDuration > 0) {
    videoDuration = layerDuration;
  }

  const shouldCenterPadAudio = Number.isFinite(layerDuration) &&
    Number.isFinite(speechLayerDuration) &&
    layerDuration > speechLayerDuration &&
    (layerDuration - speechLayerDuration) > 0.01;
  const shouldPrepareLayerLengthAudio = Number.isFinite(layerDuration) &&
    layerDuration > 0 &&
    hasLocalAudioFile;

  if (shouldPrepareLayerLengthAudio) {
    const durationDiff = layerDuration - speechLayerDuration;
    const startPadDuration = shouldCenterPadAudio ? durationDiff / 2 : 0;
    const localFileExtension = path.extname(localAudioFile) || '.mp3';
    const localFileBaseName = path.basename(localAudioFile, localFileExtension).replace(/_padded$/, '');
    const paddedFileName = `${localFileBaseName}_padded.wav`;
    paddedAudioPath = path.join(audioDir, paddedFileName);

    paddedAudioPath = await padBlankAudioAtBeginningAndEnd(
      localAudioFile,
      layerDuration,
      paddedAudioPath,
      startPadDuration
    );

    paddedAudioRelativePath = toLocalAssetReference(paddedAudioPath);

    const remotePaddedAudioName = buildPaddedAudioRemoteFileName({
      sessionId,
      layerId: currentLayer?._id,
      speechLayerId,
      paddedFileName,
    });
    const uploadedPaddedAudioUrl = await publishLipSyncAudioWithRecovery(
      uploadSpeechAudioToCDN, paddedAudioPath, remotePaddedAudioName,
    );
    // The upload key intentionally differs from the local padded path. Queue
    // the URL returned by the upload so CloudFront signs the object that
    // actually exists, instead of deriving a nonexistent S3 key from the local
    // filesystem reference.
    paddedAudioReference = getUploadedAudioReference(
      uploadedPaddedAudioUrl,
      paddedAudioRelativePath,
      remoteUrl,
    );

    const previousAudioData = refreshedAudioLayer.previousAudioData || {
      audioLink: refreshedAudioLayer.audioLink || remoteUrl,
      remoteAudioLink: refreshedAudioLayer.selectedRemoteAudioLink || remoteUrl,
      selectedRemoteAudioLink: refreshedAudioLayer.selectedRemoteAudioLink || remoteUrl,
      selectedLocalAudioLink: refreshedAudioLayer.selectedLocalAudioLink || selectedLocalAudioLink,
      startTime: refreshedAudioLayer.startTime,
      endTime: refreshedAudioLayer.endTime,
      duration: speechLayerDuration,
      localAudioLinks: refreshedAudioLayer.localAudioLinks?.length
        ? refreshedAudioLayer.localAudioLinks
        : [selectedLocalAudioLink],
      remoteAudioLinks: refreshedAudioLayer.remoteAudioLinks?.length
        ? refreshedAudioLayer.remoteAudioLinks
        : [remoteUrl],
      remoteAudioData: refreshedAudioLayer.remoteAudioData?.length
        ? refreshedAudioLayer.remoteAudioData
        : [{
          title: 'speech',
          audio_url: remoteUrl,
        }],
    };

    sessionData.audioLayers[audioLayerIndex].audioLink = uploadedPaddedAudioUrl;
    sessionData.audioLayers[audioLayerIndex].selectedRemoteAudioLink = uploadedPaddedAudioUrl;
    sessionData.audioLayers[audioLayerIndex].selectedLocalAudioLink = paddedAudioRelativePath;
    sessionData.audioLayers[audioLayerIndex].duration = layerDuration;
    sessionData.audioLayers[audioLayerIndex].startTime = currentLayer.durationOffset;
    sessionData.audioLayers[audioLayerIndex].endTime = currentLayer.durationOffset + layerDuration;
    sessionData.audioLayers[audioLayerIndex].localAudioLinks = [paddedAudioRelativePath];
    sessionData.audioLayers[audioLayerIndex].remoteAudioLinks = [uploadedPaddedAudioUrl];
    sessionData.audioLayers[audioLayerIndex].remoteAudioData = [{
      title: 'speech',
      audio_url: uploadedPaddedAudioUrl,
    }];
    sessionData.audioLayers[audioLayerIndex].previousAudioData = previousAudioData;
    sessionData.audioLayers[audioLayerIndex].originalDuration = speechLayerDuration;

    videoDuration = layerDuration;

    await VideoSession.findOneAndUpdate({
      _id: sessionId,
    }, {
      $set: {
        audioLayers: sessionData.audioLayers,
      }
    });
  }


  const aspectRatio = sessionData.aspectRatio;

  const hasAiVideoReference = hasReusableBaseAiVideo(currentLayer);

  if (!hasAiVideoReference) {
    throw new Error(
      `Character layer ${normalizeStringId(currentLayer?._id) || 'unknown'} has no reusable base AI video for lip sync.`,
    );
  }

  const videoLayerLink = getCanonicalAiVideoReference({
    layer: currentLayer,
    userId,
  });

  if (!videoLayerLink) {
    throw new Error(
      `Character layer ${normalizeStringId(currentLayer?._id) || 'unknown'} has no canonical provider video reference for lip sync.`,
    );
  }



  let lipSyncModel = 'SYNCLIPSYNC';
  let currentAudioLayer = refreshedAudioLayer;

  const isHumanSpeech = currentAudioLayer.isHuman;


  // if (isHumanSpeech === false) {
  //   lipSyncModel = 'HUMMINGBIRDLIPSYNC';
  // }
  


  // 3) Build the generation payload, referencing the padded audio
  const generationPayload = {
      videoBillingPolicy: sessionData.videoBillingPolicy || 'pipeline',
      videoBillingAPIKeyUsage: sessionData.videoBillingAPIKeyUsage || null,
      expireAt: null,
    videoLink: videoLayerLink,  // The local/remote path to the AI video
    audioLink: paddedAudioReference,
    duration: videoDuration,
    audioDuration: videoDuration,
    model: lipSyncModel,
    generationType: 'lip_sync',
    samsarExternalProviderStage: 'lip_sync_generation',
    samsarExternalVideoRoute: 'lip_sync',
    sessionId: sessionId,
    layerId: currentLayer._id,
    ...getSourceSceneMetadata(currentLayer),
    userId: userId,
    isAudioVideoGeneration: true,
    clipLayerToAiVideo: false,
    aspectRatio: aspectRatio,
    isExpressGeneration: true,
    isVideoGPTGeneration: true,
    retryOnFail: shouldRetryLipSyncFailure(),
    audioPrompt: audioPrompt,
  };

  console.log('[lip_sync][request_enqueue] creating lip sync generation request', {
    sessionId,
    layerId: currentLayer?._id?.toString?.() || currentLayer?._id || null,
    audioLayerId: refreshedAudioLayer?._id?.toString?.() || refreshedAudioLayer?._id || null,
    model: lipSyncModel,
    generationType: generationPayload.generationType,
    route: generationPayload.samsarExternalVideoRoute,
    stage: generationPayload.samsarExternalProviderStage,
    retryOnFail: generationPayload.retryOnFail,
    videoLink: videoLayerLink,
    audioLink: paddedAudioReference,
    duration: videoDuration,
    audioDuration: videoDuration,
    aspectRatio,
  });



  // 4) Save an AIVideoLayerGeneration record. Controls and late success win
  // while padding/publication is in progress; no new request is persisted.
  const pendingWrite = await VideoSession.updateOne(
    buildLipSyncLayerWriteGuard(sessionId, currentLayer._id),
    {
      $set: {
        'layers.$.lipSyncGenerationPending': true,
        'layers.$.lipSyncVideoGenerationStatus': 'PENDING',
        'layers.$.lipSyncVideoGenerationError': null,
        'layers.$.lipSyncInfrastructureFailure': false,
        'layers.$.lipSyncVideoGenerationErrorCode': null,
      },
    },
  );
  if (pendingWrite?.matchedCount === 0 || pendingWrite?.n === 0) return null;
  const aiVideoPayload = new AIVideoLayerGeneration(generationPayload);
  await aiVideoPayload.save();
}



export async function sessionLayerDurationToMatchSpeechLayer(sessionId, currentLayer, videoDuration) {
  try {
    // 1) Find the session
    const sessionData = await VideoSession.findById(sessionId);
    if (!sessionData) {
      throw new Error(`VideoSession with ID ${sessionId} not found`);
    }

    // 2) Find the index of the current layer
    const layerId = currentLayer._id.toString();
    const layerIndex = sessionData.layers.findIndex(
      (ly) => ly._id.toString() === layerId
    );
    if (layerIndex === -1) {
      throw new Error(`Layer with ID ${layerId} not found in session ${sessionId}`);
    }

    // 6) Find connected audio layer (if any)
    const connectedAudioLayer = sessionData.audioLayers.find(
      (al) => al.connectedLayerId === layerId
    );



    const newDuration = videoDuration; // Use the video duration as the new duration for this layer


    // // 3) Keep old duration for reference
    // const oldDuration = sessionData.layers[layerIndex].duration;

    // // 4) Update this layer’s duration and mark frames pending
    sessionData.layers[layerIndex].duration = newDuration;
    sessionData.layers[layerIndex].frameGenerationPending = true;

    let nextLayerOffset = sessionData.layers[layerIndex].durationOffset + newDuration;


    for (let i = layerIndex + 1; i < sessionData.layers.length; i++) {
      // Shift the next layer's offset
      sessionData.layers[i].durationOffset = nextLayerOffset;
      nextLayerOffset += sessionData.layers[i].duration;

      // Optionally mark subsequent layers to regenerate frames too:
      sessionData.layers[i].frameGenerationPending = true;
    }


    await sessionData.save();

  } catch (error) {
    throw error;
  }
}

export const __testOnly__ = {
  ACTIVE_LIP_SYNC_REQUEST_STATUSES,
  buildActiveLipSyncRequestQuery,
  buildLipSyncLayerWriteGuard,
  findConnectedAudioLayer: findConnectedSpeechAudioLayer,
  getCanonicalAudioReference,
  getUploadedAudioReference,
  hasReusableBaseAiVideo,
  shouldRetryLipSyncFailure,
  enqueueLipSyncLayers,
};
