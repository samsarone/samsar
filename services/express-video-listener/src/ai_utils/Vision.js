import { getDBConnectionString } from "../DBString.js";

import  VideoSession from "../schema/VideoSession.js";
import User from "../schema/User.js";

import OpenAI from "openai";

import path from "path";

import { uploadImageToCDN } from './AWS.js';
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
  shouldUseSamsarExternalInference,
} from './SamsarExternalInferenceAdapter.js';
import { recordProviderUsageLog } from '../utils/ProviderUsageAudit.js';


const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });


const API_SERVER = process.env.API_SERVER;

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

    let activeImageLink = activeImage.src;


    const pwd = process.cwd();

    // need to figure out why this is something empty for now add hacky workaround

    if (!activeImageLink || activeImageLink === "" || activeImageLink === undefined) {
      activeImageLink =  layer.imageSession.activeSelectedImage;
    }


    let activeImageBasePath = path.join(pwd, '../', 'samsar_processor', 'assets', 'images');
    
    if (process.env.CURRENT_ENV === 'staging' || process.env.CURRENT_ENV === 'docker') {
      activeImageBasePath = '/assets/images';  // Docker staging volume mount path
    }
    const activeImagePath = path.join(activeImageBasePath, activeImageLink);

    
    const remoteFileName = activeImageLink;


    

    const uploadedRemoteUrl = await uploadImageToCDN(activeImagePath, remoteFileName);
    const remoteUrl = await normalizeProviderMediaUrl(uploadedRemoteUrl);

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
    provider = 'samsar';
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
