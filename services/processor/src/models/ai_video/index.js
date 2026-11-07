import { normalizeKlingModelKey, isKlingV4Model, validateKlingV4Duration } from '../../utils/KlingModel.js';
import AIVideoLayerGeneration from '../../schema/AIVideoLayerGeneration.js';
import { prepareVideoRequestBilling } from './VideoRequestBilling.js';
import { requestRenderLumaVideo } from './Luma.js';
import { requestRenderSDVideo } from './SDVideo.js';
import { requestRenderRunwayVideo } from './RunwayML.js';
import { requestRenderKlingVideo } from './Kling.js';
import { requestRenderHailuoVideo } from './Hailuo.js';
import { requestRenderHaiperVideo } from './Haiper.js';
import { requestRenderSyncLipSyncVideo } from './SyncLipSync.js';
import { requestRenderPikaVideo } from './Pika.js';

import { requestRenderSoundEffectSyncedMMVideo } from './MMAudio.js';

import { requestRenderLatentSyncVideo } from './LatentSync.js';

import { requestRenderHummingBirdLipSyncVideo } from './HummingBirdLipSync.js';

import { requestRenderSkyReelsVideo } from './SkyReels.js';
import { requestRenderSoundEffectSyncedMireloVideo } from './MireloAI.js';
import { requestRenderCreatifyLipSyncVideo }  from './CreatifyLipSync.js';

import { requestRenderVeoVideo } from './Veo.js';

import { setSessionLayerAiVideoGenerationPending } from '../VideoSession.js';
import {
  COSMOS3_SUPER_MODEL_KEY,
  getVideoModelDurationUnitsForFramesPerSecond,
} from '../../consts/ModelPrices.js';
import { getDBConnectionString } from '../DBString.js';

import GeneratedAIVideo from '../../schema/generations/GeneratedAIVideo.js';

import { requestRenderPixVerseVideo } from './PixVerse.js';

import { requestRenderVeoI2VVideo } from './VeoI2V.js';
import { requestRenderVeo3I2VVideo } from './Veo3I2V.js';
import { requestRenderVeo3FirstLastFrameVideo } from './Veo3FirstLastFrame.js';
import { requestRenderCosmos3I2VVideo } from './Cosmos3I2V.js';
import { requestRenderDirectExternalI2VVideo } from './DirectExternalI2V.js';

import { requestRenderGenericVideo, requestRenderGenericLipSyncVideo } from './Generic.js';

import VideoSession from '../../schema/VideoSession.js';
import { getRenderableItemListForLayer } from '../../utils/ImageRenderUtils.js';
import { assertVideoModelEnabled } from '../../consts/VideoModelAvailability.js';

function pickDuration(units, target) {
  if (!Array.isArray(units) || units.length === 0) {
    return target;
  }
  for (const unit of units) {
    if (unit >= target) {
      return unit;
    }
  }
  return units[units.length - 1];
}

async function normalizeCosmos3PayloadDuration(payload = {}) {
  if (payload?.model !== COSMOS3_SUPER_MODEL_KEY) {
    return payload;
  }

  const videoSessionId = payload.videoSessionId || payload.sessionId;
  const videoSession = videoSessionId
    ? await VideoSession.findById(videoSessionId).select('framesPerSecond').lean()
    : null;
  const units = getVideoModelDurationUnitsForFramesPerSecond(
    COSMOS3_SUPER_MODEL_KEY,
    videoSession?.framesPerSecond,
  );
  const requestedDuration = Number(payload.duration);
  const targetDuration = Number.isFinite(requestedDuration) && requestedDuration > 0
    ? requestedDuration
    : units[0];

  return {
    ...payload,
    duration: pickDuration(units, targetDuration),
  };
}

async function assertLayerCanQueueAiVideoGeneration(payload = {}) {
  const videoSessionId = payload?.videoSessionId || payload?.sessionId;
  const currentLayerId = payload?.currentLayerId || payload?.layerId;

  if (!videoSessionId || !currentLayerId) {
    return;
  }

  const existingSession = await VideoSession.findOne({ _id: videoSessionId })
    .select('layers isExpressGeneration')
    .lean();
  const existingLayers = Array.isArray(existingSession?.layers) ? existingSession.layers : [];
  const existingLayerIndex = existingLayers.findIndex(
    (layer) => layer?._id?.toString?.() === String(currentLayerId)
  );
  const existingLayer = existingLayerIndex >= 0 ? existingLayers[existingLayerIndex] : null;

  if (!existingLayer) {
    throw new Error('Layer or session not found');
  }

  const normalizedLayerType = typeof existingLayer?.layerAiVideoType === 'string'
    ? existingLayer.layerAiVideoType.trim().toLowerCase()
    : '';
  const isUserVideoLayer = Boolean(
    existingLayer?.skipAiVideoGeneration === true
    || existingLayer?.userVideoGenerationPending
    || existingLayer?.hasUserVideoLayer
    || existingLayer?.userVideoLayer
    || existingLayer?.userVideoUploadTaskId
    || normalizedLayerType === 'user_video'
  );

  if (isUserVideoLayer) {
    throw new Error('Uploaded user videos cannot be queued for AI video generation.');
  }

  if (payload?.model === 'VEO3.1FLIV') {
    if (existingSession?.isExpressGeneration === true) {
      throw new Error('VEO3.1 first/last frame generation is not available for express video generation.');
    }

    const hasAiVideoLayer = Boolean(
      existingLayer?.hasAiVideoLayer ||
      existingLayer?.aiVideoLayer ||
      existingLayer?.aiVideoRemoteLink ||
      existingLayer?.aiVideoGenerationPending
    );
    const layerHasStartingImage = (layer) =>
      getRenderableItemListForLayer(layer).some(
        (item) => item?.type === 'image' && item?.src && item?.isHidden !== true
      );
    const nextLayer = existingLayerIndex >= 0 ? existingLayers[existingLayerIndex + 1] : null;

    if (hasAiVideoLayer) {
      throw new Error('Remove the existing AI video layer before using VEO3.1 first/last frame generation.');
    }
    if (!layerHasStartingImage(existingLayer) || !layerHasStartingImage(nextLayer)) {
      throw new Error('VEO3.1 first/last frame generation requires starting images on this layer and the next layer.');
    }
  }
}

export async function requestGenerateCustomAIVideo(userId, payload) {
  payload = { ...payload, model: normalizeKlingModelKey(payload?.model) };
  if (isKlingV4Model(payload.model)) {
    payload.duration = validateKlingV4Duration(payload.duration ?? 5);
    payload.generateAudio = false;
    payload.generate_audio = false;
    payload.isAudioVideoGeneration = false;
  }

  assertVideoModelEnabled(payload?.model);

  await getDBConnectionString();

  if (payload.generationRequestId) {
    const existing = await AIVideoLayerGeneration.findOne({ _id: payload.generationRequestId, userId: String(userId) }).lean();
    if (existing) return;
  }

  await assertLayerCanQueueAiVideoGeneration(payload);

  payload = await normalizeCosmos3PayloadDuration(payload);

  const { model, aspectRatio, duration = 5 } = payload;


  const billingFields = await prepareVideoRequestBilling(userId);
  payload = { ...payload, ...billingFields };

  payload.userId = userId;

  await setSessionLayerAiVideoGenerationPending(payload);

  if (payload.directExternalImageToVideo === true) {
    await requestRenderDirectExternalI2VVideo(payload);
  } else if (payload.model === 'LUMA' || payload.model === 'LUMAFLASH2') {
    await requestRenderLumaVideo(payload);
  } else if (payload.model === 'SDVIDEO') {
    await requestRenderSDVideo(payload);
  } else if (payload.model === 'RUNWAYML') {
    await requestRenderRunwayVideo(payload);
  } else if (payload.model === 'KLINGLIPSYNC') {
    await requestRenderGenericLipSyncVideo(payload);
  } else if (payload.model.startsWith('KLING')) {
    await requestRenderKlingVideo(payload);
  } else if (payload.model === 'HAILUOPRO') {
    await requestRenderHailuoVideo(payload);
  } else if (payload.model === 'HAIPER2.0') {
    await requestRenderHaiperVideo(payload);
  } else if (payload.model === 'SKYREELSI2V') {
    await requestRenderSkyReelsVideo(payload);
  } else if (payload.model === 'SYNCLIPSYNC') {
    await requestRenderSyncLipSyncVideo(payload);
  } else if (payload.model === 'LATENTSYNC') {
    await requestRenderLatentSyncVideo(payload);
  } else if (payload.model === 'MMAUDIOV2') {
    await requestRenderSoundEffectSyncedMMVideo(payload);
  } else if (payload.model === 'VEO3.1' || payload.model === 'VEO3.1FAST') {
    await requestRenderVeoVideo(payload);
  } else if (payload.model === 'PIXVERSEI2V' || payload.model === 'PIXVERSEI2VFAST') {
    await requestRenderPixVerseVideo(payload);
  } else if (payload.model === 'VEOI2V') {
    await requestRenderVeoI2VVideo(payload);
  } else if (payload.model === 'PIKA2.2I2V') {
    await requestRenderPikaVideo(payload);
  } else if (payload.model === 'MAGIDISTILLED') {
    await requestRenderGenericVideo(payload);
  } else if (payload.model === 'HUMMINGBIRDLIPSYNC') {
    await requestRenderHummingBirdLipSyncVideo(payload);
  } else if (payload.model === 'VIDUI2V') {
    await requestRenderGenericVideo(payload);
  } else if (
    payload.model === 'SEEDANCEI2V' ||
    payload.model === 'SEEDANCE2.0I2V' ||
    payload.model === 'SEEDANCE2.5I2V' ||
    payload.model === 'HAPPYHORSEI2V'
  ) {
    await requestRenderGenericVideo(payload);
  } else if (payload.model === 'MIRELOAI') {
    await requestRenderSoundEffectSyncedMireloVideo(payload);
  } else if (payload.model === 'CREATIFYLIPSYNC') {
    await requestRenderCreatifyLipSyncVideo(payload);
  } else if (payload.model === 'VEO3.1I2V' || payload.model === 'VEO3.1I2VFAST') {
    await requestRenderVeo3I2VVideo(payload);
  } else if (payload.model === 'COSMOS3SUPERI2V') {
    await requestRenderCosmos3I2VVideo(payload);
  } else if (payload.model === 'VEO3.1FLIV') {
    await requestRenderVeo3FirstLastFrameVideo(payload);
  }
}


export async function getUserAIVideoLibrary(userId, query) {
  await getDBConnectionString();

  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.limit) || 20; // Default limit
  const search = query.search || '';

  const skip = (page - 1) * limit;





  // Build filter
  const filter = { userId: userId };
  if (search) {
    filter.$or = [
      { description: { $regex: search, $options: 'i' } },
      { prompt: { $regex: search, $options: 'i' } },
      { model: { $regex: search, $options: 'i' } },
    ];
  }



  // Get total count for pagination
  const totalItems = await GeneratedAIVideo.countDocuments(filter);
  const totalPages = Math.ceil(totalItems / limit);

  // Fetch paginated data
  const userGeneratedVideos = await GeneratedAIVideo.find(filter)
    .sort({ createdAt: -1 }) // Optionally sort by newest first
    .skip(skip)
    .limit(limit);




  return {
    items: userGeneratedVideos,
    totalPages: totalPages,
    currentPage: page,
  };
}
