import { getDBConnectionString } from '../DBString.js';
import VideoSession from '../../schema/VideoSession.js';
import AIVideoLayerGeneration from '../../schema/AIVideoLayerGeneration.js';
import { getFrameImageForLayer, getBaseFrameImageForLayer, getRenderableItemListForLayer } from '../../utils/ImageRenderUtils.js';
import { uploadFrameLayerImageToCDN, primeCDNCache } from '../AWS.js';

async function getUploadedFrameImage({
  videoSessionId,
  layer,
  aspectRatio,
  combineLayers,
}) {
  const layerId = layer?._id?.toString?.();
  const activeItemList = getRenderableItemListForLayer(layer);

  const baseFrameImage = combineLayers
    ? null
    : getBaseFrameImageForLayer(activeItemList, aspectRatio, videoSessionId);
  const frameImage = baseFrameImage ||
    (await getFrameImageForLayer(videoSessionId, layerId, aspectRatio, activeItemList));

  if (!frameImage) {
    return null;
  }

  const frameImageName = frameImage.split('/').pop();
  const uploadedFrameImage = await uploadFrameLayerImageToCDN(frameImage, frameImageName);
  await primeCDNCache(uploadedFrameImage);

  return uploadedFrameImage;
}

export async function requestRenderVeo3FirstLastFrameVideo(payload) {
  const {
    videoSessionId,
    prompt,
    combineLayers = false,
    aspectRatio,
    model,
    clipLayerToAiVideo,
    duration = 8,
    userId,
  } = payload;
  const currentLayerId = payload.currentLayerId || payload.layerId;
  const generateAudio = payload.generateAudio === true || payload.generate_audio === true;

  await getDBConnectionString();

  const videoSession = await VideoSession.findById(videoSessionId);
  const currentLayerIndex = videoSession?.layers?.findIndex(
    (layer) => layer._id.toString() === currentLayerId
  );

  if (!videoSession || currentLayerIndex < 0 || currentLayerIndex + 1 >= videoSession.layers.length) {
    throw new Error('VEO3.1 first/last frame generation requires a current layer and next layer.');
  }

  const currentLayer = videoSession.layers[currentLayerIndex];
  const nextLayer = videoSession.layers[currentLayerIndex + 1];

  const currentLayerFrameImage = await getUploadedFrameImage({
    videoSessionId,
    layer: currentLayer,
    aspectRatio,
    combineLayers,
  });
  const nextLayerFrameImage = await getUploadedFrameImage({
    videoSessionId,
    layer: nextLayer,
    aspectRatio,
    combineLayers,
  });

  if (!currentLayerFrameImage || !nextLayerFrameImage) {
    throw new Error('VEO3.1 first/last frame generation requires starting images on both adjacent layers.');
  }

  const aiVideoRenderPayload = {
    prompt,
    model,
    startImage: currentLayerFrameImage,
    endImage: nextLayerFrameImage,
    sessionId: videoSessionId,
    layerId: currentLayerId,
    useEndFrame: true,
    useStartFrame: true,
    combineLayers,
    aspectRatio,
    clipLayerToAiVideo,
    userId,
    duration,
    generateAudio,
    retryOnFail: true,
  };

  const aiRenderPayload = new AIVideoLayerGeneration(aiVideoRenderPayload);
  await aiRenderPayload.save();
}
