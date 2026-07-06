
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const safetySetting = [
   
];

const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp",
  safetySettings: safetySetting,
 });
import {
  VertexAI,
  HarmCategory,
  HarmBlockThreshold,
} from'@google-cloud/vertexai';

import axios from 'axios';


export async function handleGemma3CreateRequest(payload) {
  const { _id, model, prompt, aspectRatio } = payload;

  const { apiGenerationStatus } = payload;
  if (apiGenerationStatus === 'INIT') {
    const imageData = await submitGemma3Request(payload);
    return imageData;
  } else if (apiGenerationStatus === 'PENDING') {
    // No longer polling since we get the image immediately.
    return null;
  } else if (apiGenerationStatus === 'FAILED') {
    // Handle failure if needed.
    return { image: null };
  }

}

