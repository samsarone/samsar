import 'dotenv/config';
import * as fs from 'fs';
import path from "path";
import { mkdir, writeFile } from "fs/promises";

import OpenAI from "openai";
import {
  GPT_56_SOL_REASONING_EFFORT,
  getDefaultUserInferenceModel,
  isGPT56SolInferenceModel,
  isGeminiInferenceModel,
  isQwenInferenceModel,
  normalizeInferenceModel,
} from './InferenceModels.js';
import { createGoogleGeminiChatCompletion } from './GoogleGemini.js';
import { createQwenChatCompletion } from './Qwen.js';
import {
  createSamsarExternalChatCompletion,
  shouldUseSamsarExternalInference,
} from './SamsarExternalInferenceAdapter.js';
import { withInferenceAuthorization } from './RequestInferenceModel.js';

const API_KEY = process.env.OPENAI_API_KEY;


const openai = new OpenAI({ apiKey: API_KEY || '' });




export async function getAlternatePromptFromPrompt(
  prompt,
  retryCount,
  userInferenceModel = getDefaultUserInferenceModel(),
  userInferenceAuthorization,
) {
  // System message
  const systemPrompt = `
    You are a creative assistant for a generative AI text-to-music tool. 
    Your primary task is to rewrite user-provided text-to-music input into a new that is simpler, but preserves the original meaning.
    Ensure to follow content-policy guidelines and not dot use trademarks or copyrighted material.
    Ensure the resulting prompt is a simpler and shorter version of the original prompt.
    Return the resulting prompt as a single string without any headings or formatting.
  `;

  // User messages
  const userPrompt = `Please modify the following prompt to avoid content policy violations:\n\n${prompt}`;
  
  const messageList = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `The Retry count is ${retryCount}.` },
    { role: 'user', content: userPrompt }
  ];

  // Send the request to your assistant LLM (implementation-dependent)
  const response = await sendAssistantMessageRequest(
    messageList,
    userInferenceModel,
    userInferenceAuthorization,
  );

  return response.content;
}



export async function sendAssistantMessageRequest(
  messageList,
  model = "gpt-4o-mini",
  inferenceAuthorization,
) {

  try {
    const normalizedModel = isQwenInferenceModel(model) || isGeminiInferenceModel(model)
      ? normalizeInferenceModel(model)
      : model;
    const payload = {
      messages: messageList,
      model: normalizedModel,
      ...(isGPT56SolInferenceModel(normalizedModel)
        ? { reasoning_effort: GPT_56_SOL_REASONING_EFFORT }
        : {}),
    };
    const routingPayload = withInferenceAuthorization(payload, inferenceAuthorization);

    if (shouldUseSamsarExternalInference(routingPayload)) {
      const response = await createSamsarExternalChatCompletion(routingPayload);
      return response.choices[0].message;
    }

    if (isQwenInferenceModel(normalizedModel)) {
      const response = await createQwenChatCompletion(routingPayload);
      return response.choices[0].message;
    }

    if (isGeminiInferenceModel(normalizedModel)) {
      const response = await createGoogleGeminiChatCompletion(messageList, normalizedModel);
      return response.choices[0].message;
    }

    const response = await openai.chat.completions.create(payload);
    return response.choices[0].message;
  } catch (error) {
    let errorString = 'An error occurred while sending the message. Please try again with a different message.'
    throw new Error(errorString);
  }

}
