import { getDBConnectionString } from '../DBString.js';
import VideoSession from '../schema/VideoSession.js';
import AIVideoLayerGeneration from '../schema/AIVideoLayerGeneration.js';
import { getFrameImageForLayer, getBaseFrameImageForLayer } from './utils/ImageRenderUtils.js';
import { uploadFrameLayerImageToCDN, primeCDNCache } from './utils/AWS.js';
import { buildRetryableImageToVideoQueuePayload } from './utils/AIVideoQueuePayload.js';

export async function requestRenderHappyHorseI2VVideo(payload) {
  const {
    videoSessionId,
    layerId,
    useStartFrame,
    aspectRatio,
    duration,
  } = payload;

  await getDBConnectionString();

  const videoSession = await VideoSession.findById(videoSessionId);
  const currentLayerIndex = videoSession.layers.findIndex(layer => layer._id.toString() === layerId);
  const currentLayer = videoSession.layers[currentLayerIndex];
  const activeItemList = currentLayer.imageSession.activeItemList;

  let currentLayerFrameImage;
  if (useStartFrame) {
    const currentLayerId = currentLayer._id.toString();
    const baseFrameImage = getBaseFrameImageForLayer(activeItemList, aspectRatio, videoSessionId);
    currentLayerFrameImage = baseFrameImage || await getFrameImageForLayer(videoSessionId, currentLayerId, aspectRatio, activeItemList);

    const frameBoundaryImageName = currentLayerFrameImage.split('/').pop();
    currentLayerFrameImage = await uploadFrameLayerImageToCDN(currentLayerFrameImage, frameBoundaryImageName);
    await primeCDNCache(currentLayerFrameImage);
  }

  const aiVideoRenderPayload = buildRetryableImageToVideoQueuePayload(payload, {
    useEndFrame: false,
    duration: duration || 5,
    ...(currentLayerFrameImage ? { startImage: currentLayerFrameImage } : {}),
  });

  const aiRenderPayload = new AIVideoLayerGeneration(aiVideoRenderPayload);
  await aiRenderPayload.save();
}
