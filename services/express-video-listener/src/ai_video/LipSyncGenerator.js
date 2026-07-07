import { getDBConnectionString } from "../DBString.js";
import AIVideoLayerGeneration from "../schema/AIVideoLayerGeneration.js";
import VideoSession from "../schema/VideoSession.js";

import fs from 'fs';
import path from 'path';

import { uploadSpeechAudioToCDN } from '../audio/AWS.js';
import { padBlankAudioAtBeginningAndEnd } from '../audio/Audio.js';
import { resolveProviderAiVideoUrl } from './utils/ProviderMediaUrl.js';
import { normalizeProviderMediaUrl } from './utils/AWS.js';


function normalizeStringId(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = value.toString().trim();
  return normalized || null;
}

function normalizeOptionalInteger(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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

async function resolveProviderAudioUrl(audioReference) {
  const providerAudioUrl = await normalizeProviderMediaUrl(audioReference);
  if (process.env.CURRENT_ENV === 'docker' && !/^https?:\/\//i.test(providerAudioUrl || '')) {
    throw new Error('Lip sync generation requires a provider-readable audio URL.');
  }
  return providerAudioUrl;
}

function getProcessorAssetsRoot(folderName) {
  if (process.env.CURRENT_ENV === 'staging' || process.env.CURRENT_ENV === 'docker') {
    return `/${folderName}`;
  }
  return path.join(process.cwd(), '../', 'samsar_processor', folderName);
}

function normalizeLocalAssetReference(value) {
  return typeof value === 'string'
    ? value.trim().replace(/\\/g, '/').replace(/^\/+/, '')
    : '';
}

function resolveLocalAssetPath(localAssetRef) {
  const rawRef = typeof localAssetRef === 'string' ? localAssetRef.trim() : '';
  if (!rawRef) {
    return null;
  }

  if (path.isAbsolute(rawRef) && fs.existsSync(rawRef)) {
    return rawRef;
  }

  const normalizedRef = normalizeLocalAssetReference(rawRef)
    .replace(/^samsar_processor\/assets_v2\/+/, 'assets_v2/')
    .replace(/^samsar_processor\/assets\/+/, 'assets/');

  const assetsV2Root = getProcessorAssetsRoot('assets_v2');
  const legacyAssetsRoot = getProcessorAssetsRoot('assets');

  let candidates;
  if (normalizedRef.startsWith('assets_v2/')) {
    candidates = [path.join(assetsV2Root, normalizedRef.replace(/^assets_v2\/+/, ''))];
  } else if (normalizedRef.startsWith('assets/')) {
    candidates = [path.join(legacyAssetsRoot, normalizedRef.replace(/^assets\/+/, ''))];
  } else {
    candidates = [
      path.join(assetsV2Root, normalizedRef),
      path.join(legacyAssetsRoot, normalizedRef),
    ];
  }

  return candidates.find((candidatePath) => fs.existsSync(candidatePath)) || candidates[0] || null;
}

function toLocalAssetReference(absolutePath) {
  if (typeof absolutePath !== 'string' || !absolutePath.trim()) {
    return absolutePath;
  }

  const normalizedPath = absolutePath.replace(/\\/g, '/');
  const isStagingOrDocker = process.env.CURRENT_ENV === 'staging' || process.env.CURRENT_ENV === 'docker';
  const roots = [
    { root: getProcessorAssetsRoot('assets_v2'), prefix: 'assets_v2' },
    { root: getProcessorAssetsRoot('assets'), prefix: '' },
  ];

  for (const { root, prefix } of roots) {
    const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
    if (normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)) {
      const relativePath = normalizedPath.slice(normalizedRoot.length).replace(/^\/+/, '');
      if (!prefix) {
        return isStagingOrDocker ? normalizedPath : relativePath;
      }
      return isStagingOrDocker
        ? path.posix.join('/', prefix, relativePath)
        : path.posix.join(prefix, relativePath);
    }
  }

  return absolutePath;
}

function findConnectedAudioLayer(sessionAudioLayers = [], currentLayer = {}, layerIndex = -1) {
  const currentLayerId = normalizeStringId(currentLayer?._id);
  if (!currentLayerId) {
    return null;
  }

  const connectedById = sessionAudioLayers.find((audioLayer) =>
    normalizeStringId(audioLayer?.connectedLayerId) === currentLayerId
  );
  if (connectedById) {
    return connectedById;
  }

  if (!Number.isInteger(layerIndex) || layerIndex < 0) {
    return null;
  }

  return sessionAudioLayers.find((audioLayer) =>
    normalizeOptionalInteger(audioLayer?.connectedLayerIndex) === layerIndex
  ) || null;
}


export async function generateLipSyncForSession(sessionId) {

  await getDBConnectionString();


  let sessionData = await VideoSession.findOne({ _id: sessionId });

  const sessionLayers = sessionData.layers;

  const sessionAudioLayers = sessionData.audioLayers;



  try {
    for (let i = 0; i < sessionLayers.length; i++) {
      const currentLayer = sessionLayers[i];

      const hasBaseAiVideo = Boolean(currentLayer?.hasAiVideoLayer || currentLayer?.aiVideoLayer);

      if (
        currentLayer.layerAiVideoType === "character" &&
        currentLayer.lipSyncGenerationPending &&
        hasBaseAiVideo
      ) { //&& currentLayer.aiVideoGenerationStatus !== "COMPLETED") {


        const connectedAudioLayer = findConnectedAudioLayer(sessionAudioLayers, currentLayer, i);


        if (!connectedAudioLayer) {

          await VideoSession.findOneAndUpdate({
            _id: sessionId,
            'layers._id': currentLayer._id,
          }, {
            $set: {
              'layers.$.lipSyncGenerationPending': false,
              'layers.$.aiVideoGenerationStatus': 'COMPLETED',
              'layers.$.layerAiVideoType': 'ai_video',
            }
          });

          continue;
        }


        await generateLipSyncForLayer(sessionId, currentLayer, connectedAudioLayer);
      }
    }

  } catch (error) {
    const message = error?.message || 'Lip sync generation request failed.';
    console.error('[lip_sync][request_enqueue] failed to create lip sync generation request', {
      sessionId,
      error: message,
      stack: error?.stack,
    });
    await VideoSession.updateOne(
      { _id: sessionId },
      {
        $set: {
          'expressGenerationStatus.lip_sync_generation': 'FAILED',
          'expressGenerationStatus.status': 'FAILED',
          expressGenerationPending: false,
          expressGenerationFailed: true,
          expressGenerationError: message,
          lastLipSyncGenerationError: message,
        },
      }
    );
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

  const userId = sessionData.userId;


  const audioLayerIndex = sessionData.audioLayers.findIndex(
    (layer) => layer._id.toString() === connectedAudioLayer._id.toString()
  );




  if (audioLayerIndex === -1) {
    await VideoSession.findOneAndUpdate({
      _id: sessionId,
      'layers._id': currentLayer._id,
    }, {
      $set: {
        'layers.$.layerAiVideoType': 'ai_video',
        'layers.$.aiVideoGenerationStatus': 'COMPLETED',
        'layers.$.lipSyncGenerationPending': false,

      }
    });
    return;
    // throw new Error("Connected audio layer not found in session data");
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



  if (!remoteUrl || !selectedLocalAudioLink) {
    // could not find remote audio link set layer ai video type to base

    await VideoSession.findOneAndUpdate({
      _id: sessionId,
      'layers._id': currentLayer._id,
    }, {
      $set: {
        'layers.$.layerAiVideoType': 'ai_video',
        'layers.$.aiVideoGenerationStatus': 'COMPLETED',
        'layers.$.lipSyncGenerationPending': false,

      }
    });

    return;
  }

  let localAudioFile = resolveLocalAssetPath(selectedLocalAudioLink);
  let audioDir = path.dirname(localAudioFile);


  if (!fs.existsSync(audioDir)) {
    fs.mkdirSync(audioDir, { recursive: true });
  }



  let paddedAudioPath;
  let paddedAudioRemotePath = await resolveProviderAudioUrl(remoteUrl);
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
    fs.existsSync(localAudioFile);

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
    const uploadedPaddedAudioUrl = await uploadSpeechAudioToCDN(paddedAudioPath, remotePaddedAudioName);
    paddedAudioRemotePath = await resolveProviderAudioUrl(uploadedPaddedAudioUrl);

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

    sessionData.audioLayers[audioLayerIndex].audioLink = paddedAudioRemotePath;
    sessionData.audioLayers[audioLayerIndex].selectedRemoteAudioLink = paddedAudioRemotePath;
    sessionData.audioLayers[audioLayerIndex].selectedLocalAudioLink = paddedAudioRelativePath;
    sessionData.audioLayers[audioLayerIndex].duration = layerDuration;
    sessionData.audioLayers[audioLayerIndex].startTime = currentLayer.durationOffset;
    sessionData.audioLayers[audioLayerIndex].endTime = currentLayer.durationOffset + layerDuration;
    sessionData.audioLayers[audioLayerIndex].localAudioLinks = [paddedAudioRelativePath];
    sessionData.audioLayers[audioLayerIndex].remoteAudioLinks = [paddedAudioRemotePath];
    sessionData.audioLayers[audioLayerIndex].remoteAudioData = [{
      title: 'speech',
      audio_url: paddedAudioRemotePath,
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

  const aiVideoRelativePath = currentLayer.aiVideoLayer;

  if (!aiVideoRelativePath) {
    await VideoSession.findOneAndUpdate({
      _id: sessionId,
      'layers._id': currentLayer._id,
    }, {
      $set: {
        'layers.$.layerAiVideoType': 'ai_video',
        'layers.$.aiVideoGenerationStatus': 'COMPLETED',
        'layers.$.lipSyncGenerationPending': false,

      }
    });
    return;
  }

  const videoLayerLink = await resolveProviderAiVideoUrl({
    layer: currentLayer,
    userId,
  });

  if (!videoLayerLink) {
    await VideoSession.findOneAndUpdate({
      _id: sessionId,
      'layers._id': currentLayer._id,
    }, {
      $set: {
        'layers.$.layerAiVideoType': 'ai_video',
        'layers.$.aiVideoGenerationStatus': 'COMPLETED',
        'layers.$.lipSyncGenerationPending': false,
      }
    });
    return;
  }



  let lipSyncModel = 'SYNCLIPSYNC';
  let currentAudioLayer = refreshedAudioLayer;

  const isHumanSpeech = currentAudioLayer.isHuman;


  // if (isHumanSpeech === false) {
  //   lipSyncModel = 'HUMMINGBIRDLIPSYNC';
  // }
  


  // 3) Build the generation payload, referencing the padded audio
  const generationPayload = {
    videoLink: videoLayerLink,  // The local/remote path to the AI video
    audioLink: paddedAudioRemotePath,
    duration: videoDuration,
    audioDuration: videoDuration,
    model: lipSyncModel,
    generationType: 'lip_sync',
    samsarExternalProviderStage: 'lip_sync_generation',
    samsarExternalVideoRoute: 'lip_sync',
    sessionId: sessionId,
    layerId: currentLayer._id,
    userId: userId,
    isAudioVideoGeneration: true,
    clipLayerToAiVideo: false,
    aspectRatio: aspectRatio,
    isExpressGeneration: true,
    isVideoGPTGeneration: true,
    retryOnFail: process.env.CURRENT_ENV !== 'docker',
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
    audioLink: paddedAudioRemotePath,
    duration: videoDuration,
    audioDuration: videoDuration,
    aspectRatio,
  });



  // 4) Save an AIVideoLayerGeneration record
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
