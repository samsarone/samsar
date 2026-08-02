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
  isKimiInferenceModel,
  isQwenInferenceModel,
  normalizeInferenceModel,
} from './InferenceModels.js';
import { createGoogleGeminiChatCompletion } from './GoogleGemini.js';
import { createKimiK3ChatCompletion } from './KimiK3.js';
import { createQwenChatCompletion } from './Qwen.js';
import { runExternalInferenceWithRetry } from './ExternalInferenceRetry.js';
import {
  DOCKER_INFERENCE_PROVIDER,
  createSamsarExternalChatCompletion,
  getConfiguredInferenceProviders,
  shouldUseSamsarExternalInference,
} from './SamsarExternalInferenceAdapter.js';
import { withInferenceAuthorization } from './RequestInferenceModel.js';
import { normalizeProviderMediaPayload } from '../utils/ProviderMediaPayload.js';
import { isStandaloneEdition } from '../util/environmentUtils.js';

const API_KEY = process.env.OPENAI_API_KEY;


const openai = new OpenAI({ apiKey: API_KEY || '' });

function normalizeAuthorization(value) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[_\s]+/g, '-')
    : '';
}

function shouldUseStandaloneInferenceAdapterFallback(chatRequest = {}) {
  if (!isStandaloneEdition()) {
    return false;
  }
  const authorization = normalizeAuthorization(chatRequest?.authorization);
  if (
    authorization === 'gmicloud' ||
    authorization === 'genblaze' ||
    authorization === 'openrouter' ||
    ['deployed', 'samsar', 'samsar-api-key', 'samsar-key'].includes(authorization)
  ) {
    return false;
  }
  return chatRequest?.bypassSamsarExternalInference !== true &&
    chatRequest?.samsarExternalInference !== true;
}

function buildProviderPinnedChatRequest(chatRequest, provider) {
  const providerRequest = {
    ...chatRequest,
    // The ordered adapter loop owns automatic retry. Provider-local retries
    // would keep hitting the same adapter before the next preference is tried.
    externalMaxRetries: 0,
    maxRetries: 0,
  };
  if (provider === DOCKER_INFERENCE_PROVIDER.OPENROUTER) {
    return {
      ...providerRequest,
      authorization: 'openrouter',
      bypassSamsarExternalInference: false,
      samsarExternalInference: true,
    };
  }
  if (provider === DOCKER_INFERENCE_PROVIDER.GMICLOUD) {
    return {
      ...providerRequest,
      authorization: 'gmicloud',
      bypassSamsarExternalInference: false,
      samsarExternalInference: true,
    };
  }
  if (provider === DOCKER_INFERENCE_PROVIDER.SAMSAR) {
    return {
      ...providerRequest,
      authorization: 'deployed',
      bypassSamsarExternalInference: false,
      samsarExternalInference: true,
    };
  }
  return {
    ...providerRequest,
    authorization: 'native',
    bypassSamsarExternalInference: true,
    samsarExternalInference: false,
  };
}

export function isRetryableInferenceAdapterError(error) {
  const status = Number(
    error?.status ??
    error?.statusCode ??
    error?.response?.status ??
    error?.cause?.status,
  );
  if (
    status === 401 ||
    status === 403 ||
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  ) {
    return true;
  }
  const code = String(
    error?.code ||
    error?.cause?.code ||
    '',
  ).trim().toUpperCase();
  return [
    'GENBLAZE_MODEL_UNSUPPORTED',
    'ECONNABORTED',
    'ECONNREFUSED',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ETIMEDOUT',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_SOCKET',
  ].includes(code);
}

export async function runInferenceAdapterFallback(
  providers = [],
  dispatchProvider,
) {
  let lastError = null;
  const attemptedProviders = [];
  for (const provider of providers) {
    attemptedProviders.push(provider);
    try {
      return await dispatchProvider(provider);
    } catch (error) {
      lastError = error;
      if (!isRetryableInferenceAdapterError(error)) {
        throw error;
      }
    }
  }
  if (lastError) {
    lastError.attemptedInferenceAdapters = attemptedProviders;
    throw lastError;
  }
  return dispatchProvider(undefined);
}

async function createInferenceChatCompletionForProvider(
  chatRequest = {},
  dependencyOverrides = {},
) {
  const {
    authorization,
    bypassSamsarExternalInference,
    externalMaxRetries,
    maxRetries,
    samsarExternalInference,
    timeout,
    timeoutMs,
    ...providerRequest
  } = chatRequest || {};
  const model = providerRequest.model || getDefaultUserInferenceModel();
  const createSamsarCompletion =
    dependencyOverrides.createSamsarExternalChatCompletion ||
    createSamsarExternalChatCompletion;
  if (shouldUseSamsarExternalInference(chatRequest)) {
    return createSamsarCompletion(chatRequest);
  }
  const nativeProviderRequest = {
    ...providerRequest,
    ...(timeout !== undefined ? { timeout } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(maxRetries !== undefined ? { maxRetries } : {}),
  };

  if (isQwenInferenceModel(model)) {
    const createQwenCompletion =
      dependencyOverrides.createQwenChatCompletion || createQwenChatCompletion;
    return createQwenCompletion(nativeProviderRequest);
  }

  if (isKimiInferenceModel(model)) {
    const createKimiCompletion =
      dependencyOverrides.createKimiK3ChatCompletion || createKimiK3ChatCompletion;
    return createKimiCompletion(nativeProviderRequest);
  }

  if (isGeminiInferenceModel(model)) {
    const createGeminiCompletion =
      dependencyOverrides.createGoogleGeminiChatCompletion ||
      createGoogleGeminiChatCompletion;
    return createGeminiCompletion(providerRequest.messages, model);
  }

  const requestTimeoutMs = Number(
    timeout ?? timeoutMs ?? process.env.OPENAI_INFERENCE_TIMEOUT_MS,
  ) || 10 * 60 * 1000;
  const openaiClient = dependencyOverrides.openaiClient || openai;
  return runExternalInferenceWithRetry(
    async ({ signal }) => {
      const providerPayload = await normalizeProviderMediaPayload(providerRequest);
      return openaiClient.chat.completions.create(providerPayload, {
        timeout: requestTimeoutMs,
        maxRetries: 0,
        signal,
      });
    },
    {
      provider: 'openai',
      model,
      timeoutMs: requestTimeoutMs,
      maxRetries:
        externalMaxRetries ??
        maxRetries ??
        process.env.OPENAI_INFERENCE_MAX_RETRIES,
    },
  );
}

export async function createCompatibleInferenceChatCompletion(
  chatRequest = {},
  dependencyOverrides = {},
) {
  if (shouldUseStandaloneInferenceAdapterFallback(chatRequest)) {
    const providers = getConfiguredInferenceProviders(
      chatRequest?.model || getDefaultUserInferenceModel(),
      chatRequest,
    );
    if (providers.length > 1) {
      return runInferenceAdapterFallback(
        providers,
        (provider) => createInferenceChatCompletionForProvider(
          buildProviderPinnedChatRequest(chatRequest, provider),
          dependencyOverrides,
        ),
      );
    }
  }

  return createInferenceChatCompletionForProvider(
    chatRequest,
    dependencyOverrides,
  );
}




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
    const normalizedModel = isQwenInferenceModel(model) ||
      isGeminiInferenceModel(model) ||
      isKimiInferenceModel(model)
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

    const response = await createCompatibleInferenceChatCompletion(routingPayload);
    return response.choices[0].message;
  } catch (error) {
    let errorString = 'An error occurred while sending the message. Please try again with a different message.'
    throw new Error(errorString);
  }

}
