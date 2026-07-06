
import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { createCompatibleChatCompletion } from "../../ai_utils/OpenAICompat.js";
import { getModelForUserInferenceModel } from "../../agent/ModelUtils.js";
import { getAccessibleVisionImageUrl } from "../../ai_utils/VisionMediaUrl.js";
import { getDefaultUserInferenceModel } from '../../../consts/InferenceModels.js';

const API_KEY = process.env.OPENAI_API_KEY;


const openai = new OpenAI({ apiKey: API_KEY || '' });


export async function processThemesFromStartImages(imageList, userInferenceModel = getDefaultUserInferenceModel()) {

  const resData = await getThemeForImageList(imageList, userInferenceModel);

  return resData;

}


export async function processStartImagesDescriptions(imageList, userInferenceModel = getDefaultUserInferenceModel()) {
  const imageDescriptionList = [];
  for (let i = 0; i < imageList.length; i++) {
    const imageUrl = imageList[i];
    const imageDescription = await getDescriptionForImage(imageUrl, userInferenceModel);
    imageDescriptionList.push(imageDescription);
  }
  return imageDescriptionList;
  
}

export async function getImageMetaData(startImageUrl, userInferenceModel = getDefaultUserInferenceModel()) {
  const imageData = await getDescriptionForImage(startImageUrl, userInferenceModel);
  return imageData;
}


async function getThemeForImageList(activeImageRemoteList, userInferenceModel = getDefaultUserInferenceModel()) {

  let attempts = 0;
  const maxRetries = 2;
  let backoff = 1000;

  const userPrompt = `
  You are analyzing a list of generative frame image which will be used to generate a video.
  Create a theme for the video from the list of images.
  Create Detailed Theme of the image including cinematic and color details, image style, image vibes etc. in a single paragraph upto 3000 characters without any title, linebreaks or heading.`;


  const accessibleImageList = await Promise.all(
    activeImageRemoteList.map((imItem) => getAccessibleVisionImageUrl(imItem))
  );

  const imageDescList = accessibleImageList.map(function (imItem, imIdx) {
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
    model: getModelForUserInferenceModel(userInferenceModel),
    messages: inputPayload,
  };

  while (attempts <= maxRetries) {
    try {

      const response = await createCompatibleChatCompletion(openai, activePayload);
      const responsePayload = response.choices[0].message.content;
      return responsePayload;
    } catch (error) {
      // Check if error indicates an image upload issue
      if (error.message) {

        attempts++;
        if (attempts > maxRetries) {
          console.error("Max retries reached. Returning score 0.");
          return 0;
        }
        console.error(error);
        await new Promise(resolve => setTimeout(resolve, backoff));
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






async function getDescriptionForImage(activeImageRemoteLink, userInferenceModel = getDefaultUserInferenceModel()) {
  let attempts = 0;
  const maxRetries = 2;
  let backoff = 1000;
  const accessibleImageUrl = await getAccessibleVisionImageUrl(activeImageRemoteLink);

  const userPrompt = `
  You are analyzing a single generative frame image for an object which will be used to generate an ad video.
  Provide an accurate and detailed description of the object in focus in the image and its surroundings.
  Include technical details, color, condition and all other relevant information about the object such that it can be used to accurately recreate the object in text-to-image generation.
  The description can be upto 3000 characters in a single paragraph without any title, linebreaks or heading.`;

  const activePayload = {
    model: getModelForUserInferenceModel(userInferenceModel),
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

  while (attempts <= maxRetries) {
    try {

      const response = await createCompatibleChatCompletion(openai, activePayload);
      const responsePayload = response.choices[0].message.content;




      return responsePayload;
    } catch (error) {
      // Check if error indicates an image upload issue
      if (error.message) {

        attempts++;
        if (attempts > maxRetries) {
          console.error("Max retries reached. Returning score 0.");
          return 0;
        }
        await new Promise(resolve => setTimeout(resolve, backoff));
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
