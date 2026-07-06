import { getDBConnectionString } from '../DBString.js';
import VideoSession from '../../schema/VideoSession.js';
import AIVideoLayerGeneration from '../../schema/AIVideoLayerGeneration.js';
import { getFrameImageForLayer, getBaseFrameImageForLayer, getRenderableItemListForLayer } from '../../utils/ImageRenderUtils.js';
import { uploadFrameLayerImageToCDN, primeCDNCache } from '../AWS.js';
import {
  COSMOS3_SUPER_MODEL_KEY,
  getVideoModelDurationUnitsForFramesPerSecond,
} from '../../consts/ModelPrices.js';

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
  let {
    videoSessionId,
    currentLayerId,
    prompt,
    combineLayers,
    useStartFrame,
    useEndFrame,
    aspectRatio,
    model,
    clipLayerToAiVideo,
    duration,
    userId,
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
  duration = pickDuration(durationUnits, Number(duration) || durationUnits[0]);
  const currentLayerIndex = videoSession.layers.findIndex((layer) => layer._id.toString() === currentLayerId);
  const currentLayer = videoSession.layers[currentLayerIndex];
  const activeItemList = getRenderableItemListForLayer(currentLayer);

  let currentLayerFrameImage;

  if (useStartFrame) {
    if (combineLayers) {
      currentLayerFrameImage = await getFrameImageForLayer(videoSessionId, currentLayerId, aspectRatio, activeItemList);
    } else {
      currentLayerFrameImage = getBaseFrameImageForLayer(activeItemList, aspectRatio, videoSessionId);
    }

    if (!currentLayerFrameImage) {
      useStartFrame = false;
      useEndFrame = false;
    } else {
      const frameBoundaryImageName = currentLayerFrameImage.split('/').pop();
      currentLayerFrameImage = await uploadFrameLayerImageToCDN(currentLayerFrameImage, frameBoundaryImageName);
      await primeCDNCache(currentLayerFrameImage);
    }
  }

  const aiVideoRenderPayload = {
    model,
    sessionId: videoSessionId,
    layerId: currentLayerId,
    useEndFrame: false,
    useStartFrame,
    combineLayers,
    aspectRatio,
    clipLayerToAiVideo,
    userId,
    prompt,
    duration,
    framesPerSecond,
    generateAudio: false,
  };

  if (currentLayerFrameImage) {
    aiVideoRenderPayload.startImage = currentLayerFrameImage;
  }

  const aiRenderPayload = new AIVideoLayerGeneration(aiVideoRenderPayload);
  await aiRenderPayload.save();
}
