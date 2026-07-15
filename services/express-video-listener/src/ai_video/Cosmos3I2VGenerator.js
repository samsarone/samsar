import { getDBConnectionString } from '../DBString.js';
import VideoSession from '../schema/VideoSession.js';
import AIVideoLayerGeneration from '../schema/AIVideoLayerGeneration.js';
import {
  getFrameImageForLayer,
  getBaseFrameImageForLayer,
  getSelectedFrameImageForImageSession,
} from './utils/ImageRenderUtils.js';
import { uploadFrameLayerImageToCDN, primeCDNCache } from './utils/AWS.js';
import {
  COSMOS3_SUPER_MODEL_KEY,
  getVideoModelDurationUnitsForFramesPerSecond,
} from '../consts/ModelPrices.js';
import { buildRetryableImageToVideoQueuePayload } from './utils/AIVideoQueuePayload.js';

const DEFAULT_COSMOS3_FRAMES_PER_SECOND = 24;

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

export async function requestRenderCosmos3I2VVideo(payload) {
  const {
    videoSessionId,
    layerId,
    useStartFrame,
    aspectRatio,
    duration = 5,
  } = payload;

  await getDBConnectionString();

  const videoSession = await VideoSession.findById(videoSessionId);
  const framesPerSecond = Number.isFinite(Number(videoSession?.framesPerSecond))
    ? Number(videoSession.framesPerSecond)
    : DEFAULT_COSMOS3_FRAMES_PER_SECOND;
  const durationUnits = getVideoModelDurationUnitsForFramesPerSecond(
    COSMOS3_SUPER_MODEL_KEY,
    framesPerSecond,
  );
  const normalizedDuration = pickDuration(durationUnits, Number(duration) || durationUnits[0]);
  const currentLayerIndex = videoSession.layers.findIndex((layer) => layer._id.toString() === layerId);
  if (currentLayerIndex === -1) {
    throw new Error(`Layer ${layerId} not found for Cosmos AI video generation.`);
  }
  const currentLayer = videoSession.layers[currentLayerIndex];
  const activeItemList = Array.isArray(currentLayer.imageSession?.activeItemList)
    ? currentLayer.imageSession.activeItemList
    : [];
  const currentLayerId = currentLayer._id.toString();

  let currentLayerFrameImage;
  let currentLayerFrameImageSource = '';

  if (useStartFrame) {
    const baseFrameImage = getBaseFrameImageForLayer(activeItemList, aspectRatio, videoSessionId);
    const selectedFrameImage = baseFrameImage
      ? null
      : getSelectedFrameImageForImageSession(currentLayer.imageSession, videoSessionId);
    const isBaseFrameImage = baseFrameImage || selectedFrameImage;
    if (isBaseFrameImage) {
      currentLayerFrameImage = isBaseFrameImage;
      currentLayerFrameImageSource = baseFrameImage ? 'active_item_base_image' : 'image_session_selected_image';
    } else {
      currentLayerFrameImage = await getFrameImageForLayer(videoSessionId, currentLayerId, aspectRatio, activeItemList);
      currentLayerFrameImageSource = 'rendered_active_items';
    }

    if (!currentLayerFrameImage) {
      throw new Error(`Unable to resolve start frame image for Cosmos AI video layer ${currentLayerId}.`);
    }

    const frameBoundaryImageName = currentLayerFrameImage.split('/').pop();
    currentLayerFrameImage = await uploadFrameLayerImageToCDN(currentLayerFrameImage, frameBoundaryImageName);
    await primeCDNCache(currentLayerFrameImage);
    console.log('[ai_video][cosmos3] resolved start frame image', {
      videoSessionId,
      layerId,
      source: currentLayerFrameImageSource,
      startImage: currentLayerFrameImage,
    });
  }

  const aiVideoRenderPayload = buildRetryableImageToVideoQueuePayload(payload, {
    useEndFrame: false,
    duration: normalizedDuration,
    framesPerSecond,
    generateAudio: false,
    isAudioVideoGeneration: false,
    isAudioVideoLayer: false,
    ...(currentLayerFrameImage ? { startImage: currentLayerFrameImage } : {}),
  });

  const aiRenderPayload = new AIVideoLayerGeneration(aiVideoRenderPayload);
  await aiRenderPayload.save();
}
