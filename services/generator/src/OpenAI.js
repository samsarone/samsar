import 'dotenv/config';
import * as fs from 'fs';
import path from "path";
import { mkdir, writeFile } from "fs/promises";

import OpenAI from "openai";
import {
  GPT_56_SOL_INFERENCE_MODEL,
  getDefaultUserInferenceModel,
  getGPT56SolReasoningEffort,
  isGeminiInferenceModel,
  isKimiInferenceModel,
  isQwenInferenceModel,
  normalizeInferenceModel,
} from './inference/InferenceModels.js';
import { createGoogleGeminiChatCompletion } from './inference/GoogleGemini.js';
import { createKimiK3ChatCompletion } from './inference/KimiK3.js';
import { createQwenChatCompletion } from './inference/Qwen.js';
import {
  DOCKER_INFERENCE_PROVIDER,
  createSamsarExternalChatCompletion,
  getConfiguredInferenceProviders,
  isQwenInferenceAdapterRoutingEnabled,
  resolveConfiguredInferenceProvider,
  shouldUseSamsarExternalInference,
} from './inference/SamsarExternalInferenceAdapter.js';
import { withInferenceAuthorization } from './inference/RequestInferenceModel.js';
import { isStandaloneEdition, usesLocalAssetStorage } from './utils/Environment.js';

const API_KEY = process.env.OPENAI_API_KEY;


const openai = new OpenAI({ apiKey: API_KEY || '' });

function normalizeAuthorization(value) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[_\s]+/g, '-')
    : '';
}

function shouldUseStandaloneInferenceAdapterFallback(chatRequest = {}) {
  const model = chatRequest?.model || getDefaultUserInferenceModel();
  const productionQwenRoutingEnabled = isQwenInferenceModel(model) &&
    isQwenInferenceAdapterRoutingEnabled();
  if (!isStandaloneEdition() && !productionQwenRoutingEnabled) {
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

function shouldMaterializeOpenRouterMaxTokens(chatRequest = {}, model) {
  const authorization = normalizeAuthorization(chatRequest?.authorization);
  if (authorization === 'openrouter') {
    return true;
  }
  if (authorization) {
    return false;
  }
  return resolveConfiguredInferenceProvider(model, chatRequest) ===
    DOCKER_INFERENCE_PROVIDER.OPENROUTER;
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
    status === 425 ||
    status === 429
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
    'EAI_AGAIN',
    'ECONNREFUSED',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ENOTFOUND',
    'UND_ERR_CONNECT_TIMEOUT',
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
    externalMaxTokens,
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
    const {
      externalMaxTokens: _externalMaxTokens,
      ...externalRequest
    } = chatRequest || {};
    return createSamsarCompletion({
      ...externalRequest,
      ...(externalMaxTokens !== undefined &&
          shouldMaterializeOpenRouterMaxTokens(chatRequest, model)
        ? { max_tokens: externalMaxTokens }
        : {}),
    });
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

  const openaiClient = dependencyOverrides.openaiClient || openai;
  const {
    effort,
    reasoning,
    reasoningEffort,
    reasoning_effort,
    ...openAIRequest
  } = providerRequest;
  const openAIProviderRequest = {
    ...openAIRequest,
    model: typeof model === 'string' && model.toLowerCase().startsWith(GPT_56_SOL_INFERENCE_MODEL)
      ? GPT_56_SOL_INFERENCE_MODEL
      : model,
    ...(typeof model === 'string' && model.toLowerCase().startsWith(GPT_56_SOL_INFERENCE_MODEL)
      ? {
        reasoning_effort: getGPT56SolReasoningEffort(
          model,
          effort || reasoning?.effort || reasoning_effort || reasoningEffort,
        ),
      }
      : {}),
  };
  // A synchronous inference timeout/reset can happen after the provider has
  // accepted the prompt. Hidden SDK retries could then create duplicate calls.
  const requestOptions = { maxRetries: 0 };
  const requestedTimeout = Number(timeout ?? timeoutMs);
  if (Number.isFinite(requestedTimeout) && requestedTimeout > 0) {
    requestOptions.timeout = Math.floor(requestedTimeout);
  }
  return openaiClient.chat.completions.create(openAIProviderRequest, requestOptions);
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

export async function getImageFromAPI(prompt, aspectRatio = '1:1') {


  let responseSize = '1024x1024';
  if (aspectRatio === '16:9') {
    responseSize = '1792x1024';
  } else if (aspectRatio === '9:16') {
    responseSize = '1024x1792';
  }


  try {
    const image = await openai.images.generate({ model: "dall-e-3", prompt: prompt, size: responseSize, response_format: 'b64_json' });

    const imageData = image.data[0]['b64_json'];

    const randStr = Math.random().toString(36).substring(7);
    const imageName = `generation_${Date.now()}_${randStr}.png`


    // Decode base64 to binary data
    const buffer = Buffer.from(imageData, 'base64');


    const pwd = process.cwd();

    let savePath = path.join(pwd, '..', 'samsar_processor', 'assets', 'generations', imageName);

    if (usesLocalAssetStorage()) {
      savePath = path.join(process.env.SAMSAR_ASSETS_ROOT || '/assets', 'generations', imageName);
    }

    // Ensure the directory exists
    await mkdir(path.dirname(savePath), { recursive: true });

    // Write the file to the filesystem
    await writeFile(savePath, buffer);

    return { 'image': imageName };
  } catch (error) {
    let errorString = 'An error occurred while generating the image. Please try again with a different prompt.'
    if (error.error && error.error.message) {
      errorString = error.error.message;
    }
    return {
      'image': null,
      'error': errorString
    }
  }


}

export async function getOutpaintImageFromApi(prompt, imageURL, maskImageURL) {

  try {
    const image = await openai.images.edit(
      {
        image: fs.createReadStream(imageURL),
        mask: fs.createReadStream(maskImageURL),
        prompt: prompt,
        response_format: 'b64_json'
      }
    );

    const imageData = image.data[0]['b64_json'];


    const randStr = Math.random().toString(36).substring(7);
    const imageName = `outpaint_${Date.now()}_${randStr}.png`

    // Decode base64 to binary data
    const buffer = Buffer.from(imageData, 'base64');

    const pwd = process.cwd();

    let savePath = path.join(pwd, '..', 'samsar_processor', 'assets', 'generations', imageName);

    if (usesLocalAssetStorage()) {
      savePath = path.join(process.env.SAMSAR_ASSETS_ROOT || '/assets', 'generations', imageName);
    }
    
    // Ensure the directory exists
    await mkdir(path.dirname(savePath), { recursive: true });

    // Write the file to the filesystem
    await writeFile(savePath, buffer);


    return { image: imageName };

  } catch (error) {


    let errorString = 'An error occurred while editing the image. Please try again with a different prompt.'
    if (error.error && error.error.message) {
      errorString = error.error.message;
    }

    return {
      'image': null,
      'error': errorString
    }

  }
}


// Helper: returns retryCount-specific rules
function getRetryGuidelines(retryCount, isSafetyRetry = false, rewriteMode = 'generation_failure') {
  if (isSafetyRetry) {
    return `
    - Safety rejection:
      Rewrite at theme level; do not produce a near-identical prompt.
      Treat the supplied prompt as the original seed prompt and source of truth, not as an accumulated retry draft.
      Preserve only the broad visual intent: character role or relationship, setting, action, emotional tone, camera framing, lighting, motion, visual medium, genre, and art style.
      Strip protected or identifying details, including names, exact likenesses, fictional species labels, transformation names, attack names, logos, exact costume colorways, signature hair/eye/costume combinations, and iconic silhouettes.
      Convert stripped details into increasingly generic, original, brand-free, non-identifying adult equivalents that still fit the same theme.
      Do not switch to a generic cinematic fallback, different visual medium, different genre, different era, or unrelated setting.
    `;
  }

  if (rewriteMode === 'score_threshold') {
    if (retryCount <= 1) {
      return `
    - First adjustment:
      Clarify the original narrative, theme, subject relationship, action, setting, composition, lighting, visual medium, genre, and style.
      Remove ambiguity and distracting details that could cause a visually correct but off-theme image.
      Keep required visual intent explicit.
    `;
    } else if (retryCount === 2) {
      return `
    - Second adjustment:
      Rebuild from the original seed prompt as a concise, high-signal image prompt.
      Strengthen the narrative/theme anchors and make the expected visual medium, genre, setting, action, mood, and composition unambiguous.
      Generalize only fragile or protected details; do not generalize the story, theme, or style.
    `;
    }

    return `
    - Later adjustments:
      Use stronger constraints around the same original narrative, theme, setting, action, visual medium, genre, and style.
      Remove only details that are distracting, contradictory, protected, or repeatedly mismatched.
      Do not loosen the constraints into a generic image or alternate theme.
    `;
  }

  if (retryCount <= 1) {
    return `
    - First adjustment:
      Make the smallest useful edit for generation reliability.
      Treat the supplied prompt as the original seed prompt.
      Keep the broad theme, setting, action, mood, composition, lighting, visual medium, genre, and style.
      Prefer replacing one weak or risky detail over rewriting the core prompt.
    `;
  } else if (retryCount === 2) {
    return `
    - Second adjustment:
      Rebuild from the original seed prompt with simpler, safer wording.
      Keep the main subject, relationship, action, setting, mood, visual medium, genre, and art direction.
      Replace brittle, branded, likeness, graphic, overly specific, or provider-sensitive details with more generic original equivalents.
    `;
  } else {
    return `
    - Later adjustments:
      Rebuild from the original seed prompt with broader, more generic constraints while preserving the same core theme, setting, action, mood, visual medium, genre, and style.
      Remove or generalize fragile details, brand references, exact likenesses, minors, graphic violence, impossible detail stacks, or restrictive composition likely to fail generation.
      Do not switch to an unrelated setting, medium, genre, era, or fallback composition.
    `;
  }
}

function getRewriteModeInstruction(rewriteMode = 'generation_failure') {
  if (rewriteMode === 'score_threshold') {
    return `
    Make the seed prompt more visually explicit while preserving its narrative, theme, style, and composition.
    Do not broaden or genericize unless a detail is unsafe, protected, contradictory, or repeatedly mismatched.`;
  }

  return `
    Preserve the seed prompt's theme, style, setting, action, and mood.
    Simplify only details likely to block image generation.`;
}

function getPolicyHintFromFailureMessage(failureMessage = '') {
  const message = String(failureMessage || '');
  const match = message.match(/safety_violations=\[([^\]]+)\]/i);
  if (!match) {
    return '';
  }

  return match[1]
    .split(',')
    .map((label) => label.trim().toLowerCase())
    .filter(Boolean)
    .join(', ');
}

export async function getAlternatePromptFromPrompt(
  prompt,
  retryCount,
  failureMessage = '',
  rewriteMode = 'generation_failure',
  userInferenceModel = getDefaultUserInferenceModel(),
  userInferenceAuthorization,
) {
  const policyHint = getPolicyHintFromFailureMessage(failureMessage);
  const isSafetyRetry = /safety system|safety_violations|content policy|policy violation|request was rejected/i.test(
    String(failureMessage || '')
  );

  const systemPrompt = `
    Rewrite the prompt for text-to-image generation. Return only the final prompt.

    Use the user prompt as the original seed.
    Keep the result relevant to the original prompt, but remove anything likely to cause rejection or poor image matching.
    For safety rejections, rewrite at theme level instead of lightly editing the rejected prompt.
    Replace protected IP, real-person likenesses, exact character recipes, graphic harm, or sexual content with original, non-identifying, general-audience equivalents.
    Do not create an unrelated fallback image.

    ${getRewriteModeInstruction(rewriteMode)}

    Adjustment strategy:
       ${getRetryGuidelines(retryCount, isSafetyRetry, rewriteMode)}
    ${policyHint ? `Known safety category to address: ${policyHint}.` : ''}

    Output only the revised prompt as one natural paragraph. Do not include headings, numbering, labels, analysis, policy explanations, or notes.
  `;

  const userPrompt = `Rewrite this original seed prompt according to the adjustment strategy above:\n${prompt}`;
  
  const messageList = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  // Call your LLM
  const response = await sendAssistantMessageRequest(
    messageList,
    userInferenceModel,
    userInferenceAuthorization,
  );

  return response.content;
}




export async function sendAssistantMessageRequest(
  messageList,
  userInferenceModel = getDefaultUserInferenceModel(),
  userInferenceAuthorization,
  reasoningEffort,
) {

  try {
    const inferenceModel = normalizeInferenceModel(userInferenceModel);
    const payload = {
      messages: messageList,
      model: inferenceModel,
      ...(typeof inferenceModel === 'string' &&
        inferenceModel.toLowerCase().startsWith(GPT_56_SOL_INFERENCE_MODEL)
        ? { reasoning_effort: getGPT56SolReasoningEffort(inferenceModel, reasoningEffort) }
        : {}),
    };
    const routingPayload = withInferenceAuthorization(payload, userInferenceAuthorization);

    const response = await createCompatibleInferenceChatCompletion(routingPayload);
    return response.choices[0].message;
  } catch (error) {
    let errorString = 'An error occurred while sending the message. Please try again with a different message.'
    throw new Error(errorString);
  }

}
