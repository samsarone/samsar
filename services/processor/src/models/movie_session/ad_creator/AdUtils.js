
import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { createCompatibleChatCompletion } from "../../ai_utils/OpenAICompat.js";
import { getModelForUserInferenceModel } from "../../agent/ModelUtils.js";
import { getAccessibleVisionImageUrl } from "../../ai_utils/VisionMediaUrl.js";
import {
  getDefaultUserInferenceModel,
  isGeminiInferenceModel,
} from '../../../consts/InferenceModels.js';

const API_KEY = process.env.OPENAI_API_KEY;


const openai = new OpenAI({ apiKey: API_KEY || '' });

function getVisionDependencies(overrides = {}) {
  return {
    resolveImageUrl: typeof overrides.resolveImageUrl === 'function'
      ? overrides.resolveImageUrl
      : getAccessibleVisionImageUrl,
    createCompletion: typeof overrides.createCompletion === 'function'
      ? overrides.createCompletion
      : createCompatibleChatCompletion,
    sleep: typeof overrides.sleep === 'function'
      ? overrides.sleep
      : (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  };
}

function isRetryableVisionError(error) {
  return Boolean(error?.message) && error?.retryable !== false;
}

async function getProviderImageReference(sourceReference, model, dependencies) {
  return isGeminiInferenceModel(model)
    ? sourceReference
    : dependencies.resolveImageUrl(sourceReference);
}


export async function processThemesFromStartImages(
  imageList,
  userInferenceModel = getDefaultUserInferenceModel(),
  dependencyOverrides = {},
) {

  const resData = await getThemeForImageList(imageList, userInferenceModel, dependencyOverrides);

  return resData;

}


export async function processStartImagesDescriptions(
  imageList,
  userInferenceModel = getDefaultUserInferenceModel(),
  dependencyOverrides = {},
) {
  const imageDescriptionList = [];
  for (let i = 0; i < imageList.length; i++) {
    const imageUrl = imageList[i];
    const imageDescription = await getDescriptionForImage(imageUrl, userInferenceModel, dependencyOverrides);
    imageDescriptionList.push(imageDescription);
  }
  return imageDescriptionList;
  
}

export async function getImageMetaData(
  startImageUrl,
  userInferenceModel = getDefaultUserInferenceModel(),
  dependencyOverrides = {},
) {
  const imageData = await getDescriptionForImage(startImageUrl, userInferenceModel, dependencyOverrides);
  return imageData;
}


async function getThemeForImageList(
  activeImageRemoteList,
  userInferenceModel = getDefaultUserInferenceModel(),
  dependencyOverrides = {},
) {

  let attempts = 0;
  const maxRetries = 2;
  let backoff = 1000;
  const dependencies = getVisionDependencies(dependencyOverrides);

  const userPrompt = `
  You are analyzing a list of generative frame image which will be used to generate a video.
  Create a theme for the video from the list of images.
  Create Detailed Theme of the image including cinematic and color details, image style, image vibes etc. in a single paragraph upto 3000 characters without any title, linebreaks or heading.`;

  while (attempts <= maxRetries) {
    try {
      const model = getModelForUserInferenceModel(userInferenceModel);
      const accessibleImageList = await Promise.all(
        activeImageRemoteList.map((imItem) => getProviderImageReference(imItem, model, dependencies))
      );
      const imageDescList = accessibleImageList.map(function (imItem) {
        return ({
          type: "image_url",
          image_url: {
            url: imItem,
            detail: "high",
          }
        })
      });
      const finalContent = [
        { type: "text", text: userPrompt },
        ...imageDescList
      ]
      const inputPayload = [{
        role: "user",
        content: finalContent,
      }];
      const activePayload = {
        model,
        messages: inputPayload,
      };

      const response = await dependencies.createCompletion(openai, activePayload);
      const responsePayload = response.choices[0].message.content;
      return responsePayload;
    } catch (error) {
      // Check if error indicates an image upload issue
      if (isRetryableVisionError(error)) {

        attempts++;
        if (attempts > maxRetries) {
          console.error("Max retries reached. Returning score 0.");
          return 0;
        }
        console.error(error);
        await dependencies.sleep(backoff);
        backoff *= 2; // Exponential backoff
      } else {
        // If it's not an image upload error, rethrow it
        throw error;
      }
    }
  }
  // Fallback return if something unexpected happens
  return 0;



}






async function getDescriptionForImage(
  activeImageRemoteLink,
  userInferenceModel = getDefaultUserInferenceModel(),
  dependencyOverrides = {},
) {
  let attempts = 0;
  const maxRetries = 2;
  let backoff = 1000;
  const dependencies = getVisionDependencies(dependencyOverrides);

  const userPrompt = `
  You are analyzing a single generative frame image for an object which will be used to generate an ad video.
  Provide an accurate and detailed description of the object in focus in the image and its surroundings.
  Include technical details, color, condition and all other relevant information about the object such that it can be used to accurately recreate the object in text-to-image generation.
  The description can be upto 3000 characters in a single paragraph without any title, linebreaks or heading.`;

  while (attempts <= maxRetries) {
    try {
      const model = getModelForUserInferenceModel(userInferenceModel);
      const accessibleImageUrl = await getProviderImageReference(
        activeImageRemoteLink,
        model,
        dependencies,
      );
      const activePayload = {
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: userPrompt },
              {
                type: "image_url",
                image_url: {
                  url: accessibleImageUrl,
                },
              },
            ],
          },
        ],
      };

      const response = await dependencies.createCompletion(openai, activePayload);
      const responsePayload = response.choices[0].message.content;




      return responsePayload;
    } catch (error) {
      // Check if error indicates an image upload issue
      if (isRetryableVisionError(error)) {

        attempts++;
        if (attempts > maxRetries) {
          console.error("Max retries reached. Returning score 0.");
          return 0;
        }
        await dependencies.sleep(backoff);
        backoff *= 2; // Exponential backoff
      } else {
        // If it's not an image upload error, rethrow it
        throw error;
      }
    }
  }
  // Fallback return if something unexpected happens
  return 0;
}
