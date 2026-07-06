
import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { createCompatibleChatCompletion } from "./OpenAICompat.js";
import { getModelForUserInferenceModel } from "../agent/ModelUtils.js";
import { getAccessibleVisionImageUrl } from './VisionMediaUrl.js';
import { getDefaultUserInferenceModel } from '../../consts/InferenceModels.js';

const API_KEY = process.env.OPENAI_API_KEY;


const openai = new OpenAI({ apiKey: API_KEY || '' });


export async function getImageMetaData(startImageUrl, userInferenceModel = getDefaultUserInferenceModel()) {

  const imageData = await getDescriptionForImage(startImageUrl, userInferenceModel);

  return imageData;

}



async function getDescriptionForImage(activeImageRemoteLink, userInferenceModel = getDefaultUserInferenceModel()) {
  let attempts = 0;
  const maxRetries = 2;
  let backoff = 1000;
  const accessibleImageUrl = await getAccessibleVisionImageUrl(activeImageRemoteLink);

  const userPrompt = `
  You are analyzing a single generative frame image which will be used to generate a video.
  Create a description for the video . Give 2 sections in the response.
  Create Detailed Theme of the image including cinematic and color details, image style, image vibes etc. in a single paragraph upto 3000 characters without any title, linebreaks or heading.
  Create a detailed Description of the image including detailed features of any people or objects of interest in the image upto 3000 characters in a single paragraph without any title, linebreaks or heading.`;

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



      const imageSections = responsePayload.split("\n").map((section) => section.trim()).filter((section) => section !== "");


      const themeSection = imageSections[0];
      const descriptionSection = imageSections[1];

      const resData = {
        theme: themeSection.trim(),
        description: descriptionSection.trim(),
      }

      return resData;
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




export async function getDescriptionForImageToCreateImageList(activeImageRemoteLink, userInferenceModel = getDefaultUserInferenceModel()) {
  let attempts = 0;
  const maxRetries = 2;
  let backoff = 1000;
  const accessibleImageUrl = await getAccessibleVisionImageUrl(activeImageRemoteLink);

  const userPrompt = `
  You are analyzing a user provided image which will be used to generate multiple related images.
  Describe the image in detail including style, colors, objects, people, setting and mood.
  Give a single paragraph 4-5 line description without any title, linebreaks or heading.`;

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
        console.error(error.message);


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


export async function getDescriptionForImageToCreateTranscript(activeImageRemoteLink, userInferenceModel = getDefaultUserInferenceModel()) {
    let attempts = 0;
  const maxRetries = 2;
  let backoff = 1000;
  const accessibleImageUrl = await getAccessibleVisionImageUrl(activeImageRemoteLink);

  const userPrompt = `
  You are analyzing a user provided image which will be used to create a treanscript for video generation.
  Describe the image in detail including style, colors, objects, people, setting and mood.
  Describe any characters appearing prominently in details such that can can be referenced and tagged across images for character definition.
  Give a single paragraph 6-8 line description without any title, linebreaks or heading.`;

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
        console.error(error.message);


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
