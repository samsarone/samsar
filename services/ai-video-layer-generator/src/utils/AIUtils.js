import OpenAI from "openai";
import {
  createGoogleGeminiChatCompletion,
  isGeminiInferenceModel,
  isKimiInferenceModel,
  isQwenInferenceModel,
  normalizeInferenceModel,
} from './GoogleGemini.js';
import { createAlibabaQwenChatCompletion } from './AlibabaQwen.js';
import { createKimiK3ChatCompletion } from './KimiK3.js';
import {
  DOCKER_INFERENCE_PROVIDER,
  createSamsarExternalChatCompletion,
  runInferenceWithConfiguredAdapters,
  shouldUseSamsarExternalInference,
} from './SamsarExternalInferenceAdapter.js';
import { normalizeProviderMediaUrl } from '../AWS.js';
import { normalizeProviderMediaPayload } from './ProviderMediaPayload.js';

let openaiClient = null;
let openaiClientApiKey = '';

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for native OpenAI inference.');
  }
  if (!openaiClient || openaiClientApiKey !== apiKey) {
    openaiClient = new OpenAI({ apiKey });
    openaiClientApiKey = apiKey;
  }
  return openaiClient;
}

function isExternalInferenceProvider(provider) {
  return provider === DOCKER_INFERENCE_PROVIDER.OPENROUTER ||
    provider === DOCKER_INFERENCE_PROVIDER.SAMSAR;
}

async function dispatchAssistantMessageRequest(request, provider = '') {
  if (
    isExternalInferenceProvider(provider) ||
    (!provider && shouldUseSamsarExternalInference(request))
  ) {
    const response = await createSamsarExternalChatCompletion(request);
    return response.choices[0].message;
  }

  if (isGeminiInferenceModel(request?.model)) {
    return createGoogleGeminiChatCompletion(request.messages);
  }
  if (isQwenInferenceModel(request?.model)) {
    const response = await createAlibabaQwenChatCompletion(request);
    return response.choices[0].message;
  }
  if (isKimiInferenceModel(request?.model)) {
    const response = await createKimiK3ChatCompletion(request);
    return response.choices[0].message;
  }

  const {
    authorization: _authorization,
    bypassSamsarExternalInference: _bypassSamsarExternalInference,
    samsarExternalInference: _samsarExternalInference,
    ...nativePayload
  } = request || {};
  const response = await getOpenAIClient().chat.completions.create(
    await normalizeProviderMediaPayload(nativePayload, normalizeProviderMediaUrl),
    { maxRetries: 0 },
  );
  return response.choices[0].message;
}




export async function getAlternateVideoPrompt(
  prompt,
  userInferenceModel = process.env.USER_INFERENCE_MODEL || process.env.DEFAULT_USER_INFERENCE_MODEL || 'gpt-5.6-sol',
  selectedInferenceModelAuthorization = '',
) {


  const systemPrompt = `You are an assistant for an image-to-video creation tool.
  - Transform the given image to video prompt into a simpler, more generic image to video prompt.
  - Provide a simple camera movement instruction using the original prompt as a reference.
  - Keep the language simple and the total length under 100 characters.
  - Provide the final prompt directly, with no extra wording or prefixes.`;

  

  const messageList = [
    {
      "role": "system",
      "content": systemPrompt
    },
    {
      "role": "user",
      "content": "Prompt: " + prompt
    },

  ];

  try {


    const responseData = await sendAssistantMessageRequest(
      messageList,
      userInferenceModel,
      selectedInferenceModelAuthorization,
    );
    
    return responseData.content;
  } catch (err) {
    return null;
  }

}


export async function sendAssistantMessageRequest(
  messageList,
  userInferenceModel = process.env.USER_INFERENCE_MODEL || process.env.DEFAULT_USER_INFERENCE_MODEL || 'gpt-5.6-sol',
  selectedInferenceModelAuthorization = '',
) {

  try {
    const normalizedInferenceModel = normalizeInferenceModel(userInferenceModel);
    const isGeminiModel = isGeminiInferenceModel(userInferenceModel) ||
      isGeminiInferenceModel(normalizedInferenceModel);
    const isQwenModel = isQwenInferenceModel(userInferenceModel) ||
      isQwenInferenceModel(normalizedInferenceModel);
    const isKimiModel = isKimiInferenceModel(userInferenceModel) ||
      isKimiInferenceModel(normalizedInferenceModel);
    const payload = {
      messages: messageList,
      model: isGeminiModel || isQwenModel || isKimiModel
        ? normalizedInferenceModel
        : "gpt-4.1-2025-04-14",
      ...(selectedInferenceModelAuthorization
        ? { authorization: selectedInferenceModelAuthorization }
        : {}),
    };
    return await runInferenceWithConfiguredAdapters(
      payload,
      (provider, request) => dispatchAssistantMessageRequest(request, provider),
    );
  } catch (error) {
    let errorString = 'An error occurred while sending the message. Please try again with a different message.'
    const wrappedError = new Error(errorString, { cause: error });
    if (Array.isArray(error?.attemptedInferenceAdapters)) {
      wrappedError.attemptedInferenceAdapters = error.attemptedInferenceAdapters;
    }
    throw wrappedError;
  }

}
