

import { getDBConnectionString } from '../DBString.js';
import VideoSession from '../schema/VideoSession.js';
import AIVideoLayerGeneration from '../schema/AIVideoLayerGeneration.js';
import { normalizeProviderMediaUrl } from './utils/AWS.js';
import { buildRetryableImageToVideoQueuePayload } from './utils/AIVideoQueuePayload.js';

const IMAGE_REFERENCE_KEYS = [
  'src',
  'image',
  'image_url',
  'imageUrl',
  'url',
  'remoteURL',
  'remoteUrl',
  'remote_url',
  'rawUrl',
];

function isSamsarExternalProviderPayload(payload = {}) {
  return payload?.samsarExternalProvider === true ||
    payload?.externalProvider === 'samsar' ||
    payload?.model === 'SAMSAR_EXTERNAL_VIDEO';
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getItemImageReference(item = {}) {
  for (const key of IMAGE_REFERENCE_KEYS) {
    const value = normalizeString(item?.[key]);
    if (value) {
      return value;
    }
  }
  return '';
}

function getLayerStartImageReference(currentLayer = {}, activeItemList = []) {
  const imageSession = currentLayer.imageSession || {};
  const candidates = [
    imageSession.videoRenderStartFrameImage,
    imageSession.activeEditedImage,
    imageSession.activeSelectedImage,
    imageSession.activeGeneratedImage,
    imageSession.activeImageRemoteLink,
  ];

  if (Array.isArray(activeItemList)) {
    for (const item of activeItemList) {
      if (item?.type === 'image' && item?.isHidden !== true) {
        candidates.push(getItemImageReference(item));
      }
    }
  }

  return candidates.map(normalizeString).find(Boolean) || '';
}

async function getImageToVideoStartImageUrl(currentLayer, activeItemList, layerId) {
  const startImageReference = getLayerStartImageReference(currentLayer, activeItemList);
  if (!startImageReference) {
    throw new Error(`Image-to-video generation requires a start image for layer ${layerId}.`);
  }

  const providerStartImageUrl = await normalizeProviderMediaUrl(startImageReference);
  if (!/^https?:\/\//i.test(providerStartImageUrl)) {
    throw new Error(`Image-to-video generation requires a provider-readable start image URL for layer ${layerId}.`);
  }

  return providerStartImageUrl;
}

export async function requestRenderExpressCustomVideo(payload) {

  const { videoSessionId, layerId, prompt, combineLayers, useStartFrame,
     useEndFrame, aspectRatio, model , clipLayerToAiVideo, userId , duration} = payload;

  await getDBConnectionString();

  const videoSession = await VideoSession.findById(videoSessionId);
  const currentLayerIndex = videoSession.layers.findIndex(layer => layer._id.toString() === layerId);

  const currentLayer = videoSession.layers[currentLayerIndex];


  const activeItemList = currentLayer.imageSession.activeItemList;
  const currentLayerId = currentLayer._id.toString();


  let currentLayerFrameImage;

  if (useStartFrame) {

    const currentLayerId = currentLayer._id.toString();
    currentLayerFrameImage = await getImageToVideoStartImageUrl(
      currentLayer,
      activeItemList,
      currentLayerId,
    );
  }
  let hasNextLayer = currentLayerIndex + 1 < videoSession.layers.length;
  let nextLayerFrameImage = null;





  let aiVideoRenderPayload = {
    prompt: prompt,
    model: model
  }
  if (currentLayerFrameImage) {
    aiVideoRenderPayload.startImage = currentLayerFrameImage;
  }
  if (nextLayerFrameImage) {
    aiVideoRenderPayload.endImage = nextLayerFrameImage;
  }
  aiVideoRenderPayload.sessionId = videoSessionId;
  aiVideoRenderPayload.layerId = layerId;

  aiVideoRenderPayload.useEndFrame = false;
  aiVideoRenderPayload.useStartFrame = useStartFrame;
  aiVideoRenderPayload.combineLayers = combineLayers;
  aiVideoRenderPayload.aspectRatio = aspectRatio;
  aiVideoRenderPayload.clipLayerToAiVideo = clipLayerToAiVideo;
  aiVideoRenderPayload.userId = userId;
  aiVideoRenderPayload.retryOnFail = true;
  if (model === 'CUSTOM_IMAGE_TO_VIDEO' || isSamsarExternalProviderPayload(payload)) {
    aiVideoRenderPayload.duration = duration;
    aiVideoRenderPayload.generateAudio = payload.generateAudio === true || payload.generate_audio === true;
    aiVideoRenderPayload.isAudioVideoGeneration = payload.isAudioVideoGeneration === true;
    aiVideoRenderPayload.isAudioVideoLayer = payload.isAudioVideoLayer === true;
    if (payload.customFallbackModel) {
      aiVideoRenderPayload.customFallbackModel = payload.customFallbackModel;
    }
    if (isSamsarExternalProviderPayload(payload)) {
      aiVideoRenderPayload.externalProvider = 'samsar';
      aiVideoRenderPayload.samsarExternalProvider = true;
      aiVideoRenderPayload.samsarExternalProviderStage = payload.samsarExternalProviderStage || 'ai_video_generation';
      aiVideoRenderPayload.samsarExternalProviderConfig = payload.samsarExternalProviderConfig || null;
      aiVideoRenderPayload.samsarExternalVideoModel = payload.samsarExternalVideoModel || payload.originalVideoModel || model;
      aiVideoRenderPayload.samsarExternalVideoRoute = payload.samsarExternalVideoRoute || 'step/image_to_video';
    }
  }
  


   const aiRenderPayload = new AIVideoLayerGeneration(
    buildRetryableImageToVideoQueuePayload(payload, {
      ...aiVideoRenderPayload,
      duration: Object.hasOwn(aiVideoRenderPayload, 'duration')
        ? aiVideoRenderPayload.duration
        : undefined,
    }),
  );
  const renderSaveRes = await aiRenderPayload.save();




  // Render video
}
