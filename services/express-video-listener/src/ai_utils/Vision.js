import { getDBConnectionString } from "../DBString.js";

import  VideoSession from "../schema/VideoSession.js";
import User from "../schema/User.js";

import OpenAI from "openai";

import fs from "fs";
import path from "path";

import { normalizeProviderMediaUrl } from '../ai_video/utils/AWS.js';
import {
  GPT_56_SOL_REASONING_EFFORT,
  createGoogleGeminiChatCompletion,
  getDefaultInferenceModel,
  isGeminiInferenceModel,
  isQwenInferenceModel,
  normalizeInferenceModel,
} from './GoogleGemini.js';
import { createCompatibleChatCompletion } from './OpenAICompat.js';
import {
  resolveRequestInferenceAuthorization,
  resolveRequestInferenceModel,
} from './RequestInferenceModel.js';
import {
  createSamsarExternalChatCompletion,
  resolveConfiguredInferenceProvider,
  shouldUseSamsarExternalInference,
} from './SamsarExternalInferenceAdapter.js';
import { recordProviderUsageLog } from '../utils/ProviderUsageAudit.js';
import { resolveLocalAssetPath } from '../utils/LocalAssetPath.js';


const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });


const API_SERVER = process.env.API_SERVER;

const VISION_IMAGE_REFERENCE_KEYS = [
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

const MOUNTED_MEDIA_PREFIX_PATTERN = /^(?:assets_v2|assets|generations|temp_images|video|ai_video)\//i;

function normalizeString(value = '') {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeImageReferenceValue(value) {
  if (typeof value === 'string') {
    return normalizeString(value);
  }
  if (value && typeof value === 'object') {
    return normalizeString(value.url || value.uri || value.src);
  }
  return '';
}

function getVisionImageReferenceCandidates(imageSession = {}, activeImage = {}) {
  const candidates = VISION_IMAGE_REFERENCE_KEYS.map((key) => normalizeImageReferenceValue(activeImage?.[key]));
  candidates.push(
    normalizeString(imageSession.activeSelectedImage),
    normalizeString(imageSession.activeEditedImage),
    normalizeString(imageSession.activeGeneratedImage),
    normalizeString(imageSession.activeImageRemoteLink),
  );
  return candidates.filter(Boolean).filter((value, index, list) => list.indexOf(value) === index);
}

function toCanonicalVisionImageReference(reference) {
  const normalizedReference = normalizeString(reference);
  if (!normalizedReference || /^(?:https?:|data:image\/|file:|blob:)/i.test(normalizedReference)) {
    return normalizedReference;
  }

  const referencePath = normalizedReference.split('?')[0].split('#')[0];
  if (path.isAbsolute(referencePath) && fs.existsSync(referencePath)) {
    return normalizedReference;
  }

  const relativeReference = referencePath.replace(/^\/+/, '');
  if (MOUNTED_MEDIA_PREFIX_PATTERN.test(relativeReference)) {
    return normalizedReference;
  }
  if (/^images\//i.test(relativeReference)) {
    return `assets/${relativeReference}`;
  }

  // Older image sessions persisted paths relative to the mounted assets/images folder.
  // Keep that compatibility at the local-reference layer; the canonical resolver owns
  // construction and validation of the public provider URL.
  return `assets/images/${relativeReference}`;
}

export function resolveVisionImageReference(imageSession, activeImage) {
  const candidates = getVisionImageReferenceCandidates(imageSession, activeImage);
  for (const candidate of candidates) {
    const canonical = toCanonicalVisionImageReference(candidate);
    if (/^https?:\/\//i.test(canonical)) {
      try {
        const parsed = new URL(canonical);
        const isLocalHost = ['localhost', '127.0.0.1', '0.0.0.0', 'media-gateway', 'host.docker.internal']
          .includes(parsed.hostname.toLowerCase());
        if (!isLocalHost) return canonical;
        const pathname = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
        const mediaStart = pathname.search(/(?:^|\/)(?:assets_v2|assets)\//);
        if (mediaStart >= 0) {
          const localPath = resolveLocalAssetPath(pathname.slice(mediaStart).replace(/^\/+/, ''));
          if (localPath && fs.existsSync(localPath)) return canonical;
        }
      } catch {}
      continue;
    }
    if (/^data:image\//i.test(canonical)) return canonical;
    const localPath = resolveLocalAssetPath(canonical);
    if (localPath && fs.existsSync(localPath)) return canonical;
  }
  throw new Error('Vision inference requires an accessible mounted or public image reference.');
}

export async function resolveVisionProviderImageUrl(
  imageSession,
  activeImage,
  normalizeMediaUrl = normalizeProviderMediaUrl,
) {
  const candidates = getVisionImageReferenceCandidates(imageSession, activeImage);
  let lastError;

  for (const candidate of candidates) {
    try {
      const providerReference = await normalizeMediaUrl(toCanonicalVisionImageReference(candidate));
      if (/^https?:\/\//i.test(providerReference) || /^data:image\/[a-z0-9.+-]+;base64,/i.test(providerReference)) {
        return providerReference;
      }
      lastError = new Error('Vision image did not resolve to a provider-readable URL or image data URL.');
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Vision inference requires a provider-readable base image.');
}

export async function addVisionDescriptionsForImages(sessionId) {


  await getDBConnectionString();

  let sessionData = await VideoSession.findById(sessionId);
  const userData = sessionData?.userId
    ? await User.findById(sessionData.userId)
      .select('selectedInferenceModel selectedInferenceModelAuthorization')
      .lean()
    : null;
  const userInferenceModel = resolveRequestInferenceModel({
    session: sessionData,
    user: userData,
  });
  const selectedInferenceModelAuthorization = resolveRequestInferenceAuthorization({
    session: sessionData,
    user: userData,
  });


  let sessionLayers = sessionData.layers;

  for (let i = 0; i < sessionLayers.length; i++) {
    let layer = sessionLayers[i];
    const sessionImageSession = layer.imageSession;

    if (!sessionImageSession) {
      continue;
    }
 
    const activeImage = sessionImageSession.activeItemList.find((item) => item.type === "image" && item.is_base_image);


    if (!activeImage) {
      continue;
    }

    // Keep the stable local/media reference until the selected adapter is
    // known. URL-based public adapters normalize at their dispatch boundary;
    // Gemini reads this reference into inline bytes from the mounted volume.
    const remoteUrl = resolveVisionImageReference(sessionImageSession, activeImage);

    const responseData = await getDescriptionForImage(remoteUrl, userInferenceModel, {
      userId: sessionData.userId,
      sessionId,
      layerId: layer?._id?.toString?.() || layer?._id,
      jobType: 'Express video',
      isExpressGeneration: sessionData.isExpressGeneration || sessionData.isMovieGen,
      requestType: 'vision_inference',
      source: 'express_video_vision',
      localRequestId: `${sessionId}:${layer?._id?.toString?.() || i}:vision_description`,
      selectedInferenceModelAuthorization,
    });

    layer.activeImageDescription = responseData;


  }


  const updatedVideoSession = await VideoSession.findOneAndUpdate(
    { 
      _id: sessionData._id,
    },
    { 
      $set: {
        layers: sessionLayers
      }
    },
    {
      new: true,  // return the newly updated doc
    }
  );

  // If `updatedVideoSession` is null, it likely means the version check failed (someone else updated).
  if (!updatedVideoSession) {
    throw new Error(
      `Concurrency conflict: The session doc was updated by someone else. Please retry.`
    );
  }

  return updatedVideoSession;



}


async function getDescriptionForImage(activeImageRemoteLink, userInferenceModel = getDefaultInferenceModel(), auditContext = {}) {
  const userPrompt = `Describe the images and the actors in the image.
  Describe their position relative to the camera.
  Describe the scene and the objects in the scene include the cinematography and the lighting.
  Provide the description in a single paragraph without any line breaks or special formatting.`;

  const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: userPrompt},
          {
            type: "image_url",
            image_url: {
              "url": activeImageRemoteLink,
              "detail": "low"
            },
          },
        ],
      },
    ];

  const model = normalizeInferenceModel(userInferenceModel || getDefaultInferenceModel());
  const inferencePayload = {
    model,
    messages,
    ...(auditContext.selectedInferenceModelAuthorization
      ? { authorization: auditContext.selectedInferenceModelAuthorization }
      : {}),
    ...(!isQwenInferenceModel(model)
      ? {
        reasoning_effort: isGeminiInferenceModel(model)
          ? 'high'
          : GPT_56_SOL_REASONING_EFFORT,
      }
      : {}),
  };
  let response;
  let provider;
  if (shouldUseSamsarExternalInference(inferencePayload)) {
    provider = resolveConfiguredInferenceProvider(model) || 'samsar';
    response = await createSamsarExternalChatCompletion(inferencePayload);
  } else if (isGeminiInferenceModel(model)) {
    provider = 'googleCloud';
    response = await createGoogleGeminiChatCompletion(inferencePayload);
  } else {
    provider = isQwenInferenceModel(model) ? 'alibabaCloud' : 'openai';
    response = await createCompatibleChatCompletion(openai, inferencePayload);
  }

  await recordProviderUsageLog({
    payload: auditContext,
    userId: auditContext.userId,
    sessionId: auditContext.sessionId,
    layerId: auditContext.layerId,
    localRequestId: auditContext.localRequestId,
    providerRequestId: response?.id || response?.data?.id,
    idempotencyKey: [
      'samsar_express_video_listener',
      auditContext.localRequestId,
      'vision_inference',
      provider,
      model,
      response?.id || Date.now(),
    ].filter(Boolean).join(':'),
    requestType: 'vision_inference',
    callType: 'vision_inference',
    provider,
    model,
    source: auditContext.source || 'express_video_vision',
    service: 'samsar_express_video_listener',
    status: 'requested',
    metadata: {
      sourceTask: 'image_description',
    },
  });

  const responsePayload = response.choices[0].message.content;

  return responsePayload;


}
