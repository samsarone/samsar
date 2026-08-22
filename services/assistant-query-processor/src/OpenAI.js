import OpenAI from "openai";
import {
  DEFAULT_INFERENCE_MODEL,
  GPT_56_SOL_REASONING_EFFORT,
  getGPT56SolReasoningEffort,
  isGeminiInferenceModel,
  isKimiK3InferenceModel,
  isQwenInferenceModel,
  normalizeInferenceModel,
} from './InferenceModels.js';
import { createKimiK3ChatCompletion } from './KimiK3.js';
import { createQwenChatCompletion } from './Qwen.js';
import { sendAssistantGeminiCompletionRequest } from './GoogleGemini.js';
import {
  DOCKER_INFERENCE_PROVIDER,
  createSamsarExternalChatCompletion,
  getConfiguredInferenceProviders,
  isQwenInferenceAdapterRoutingEnabled,
  resolveConfiguredInferenceProvider,
  shouldUseSamsarExternalInference,
} from './SamsarExternalInferenceAdapter.js';
import { runExternalInferenceWithRetry } from './ExternalInferenceRetry.js';
import { resolveProviderMediaPayload } from './ProviderMediaPayload.js';
import { isStandaloneEdition } from './DeploymentEnvironment.js';

const API_KEY = process.env.OPENAI_API_KEY;


const openai = new OpenAI({ apiKey: API_KEY || '' });
const DEFAULT_ASSISTANT_QUERY_TIMEOUT_MS = 10 * 60 * 1000;

function getModelNameForInferenceModel(inferenceModel) {
  return normalizeInferenceModel(inferenceModel || DEFAULT_INFERENCE_MODEL);
}



export async function sendAssistantMessageRequest(messageList, inferenceModel, reasoningEffort) {
  const completion = await sendAssistantCompletionRequest(messageList, inferenceModel, reasoningEffort);
  return completion.outputText;
}

function normalizeCompletionOptions(options) {
  if (!options) {
    return {};
  }

  if (typeof options === 'string') {
    return { reasoningEffort: options };
  }

  if (typeof options === 'object' && !Array.isArray(options)) {
    return options;
  }

  return {};
}

function normalizeAuthorization(value) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[_\s]+/g, '-')
    : '';
}

function shouldUseStandaloneInferenceAdapterFallback(options = {}) {
  const model = options?.model || DEFAULT_INFERENCE_MODEL;
  const productionQwenRoutingEnabled = isQwenInferenceModel(model) &&
    isQwenInferenceAdapterRoutingEnabled();
  if (!isStandaloneEdition() && !productionQwenRoutingEnabled) {
    return false;
  }
  const authorization = normalizeAuthorization(options.authorization);
  if (
    authorization === 'gmicloud' ||
    authorization === 'genblaze' ||
    authorization === 'openrouter' ||
    ['deployed', 'samsar', 'samsar-api-key', 'samsar-key'].includes(authorization)
  ) {
    return false;
  }
  if (
    options.bypassSamsarExternalInference === true ||
    typeof options.samsarExternalInference === 'boolean'
  ) {
    return false;
  }
  return true;
}

function buildProviderPinnedCompletionOptions(options, provider) {
  const providerOptions = {
    ...options,
    // The ordered adapter loop owns retries. Move to the next configured
    // adapter immediately after one retryable failure.
    externalMaxRetries: 0,
    maxRetries: 0,
  };
  if (provider === DOCKER_INFERENCE_PROVIDER.OPENROUTER) {
    return {
      ...providerOptions,
      authorization: 'openrouter',
      bypassSamsarExternalInference: false,
      samsarExternalInference: true,
      inferenceAdapterProvider: provider,
    };
  }
  if (provider === DOCKER_INFERENCE_PROVIDER.GMICLOUD) {
    return {
      ...providerOptions,
      authorization: 'gmicloud',
      bypassSamsarExternalInference: false,
      samsarExternalInference: true,
      inferenceAdapterProvider: provider,
    };
  }
  if (provider === DOCKER_INFERENCE_PROVIDER.SAMSAR) {
    return {
      ...providerOptions,
      authorization: 'deployed',
      bypassSamsarExternalInference: false,
      samsarExternalInference: true,
      inferenceAdapterProvider: provider,
    };
  }
  return {
    ...providerOptions,
    authorization: 'native',
    bypassSamsarExternalInference: true,
    samsarExternalInference: false,
    inferenceAdapterProvider: provider,
  };
}

function getInferenceAdapterErrorMetadata(error) {
  const visited = new Set();
  let current = error;
  let status = null;
  const codes = [];
  const names = [];
  const messages = [];

  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    if (current.message) messages.push(String(current.message));
    if (current.code !== undefined) {
      codes.push(String(current.code).trim().toUpperCase());
    }
    if (current.name !== undefined) {
      names.push(String(current.name).trim().toUpperCase());
    }
    const candidateStatus = Number(
      current.status ??
      current.statusCode ??
      current.response?.status ??
      current.error?.status ??
      current.code ??
      current.error?.code,
    );
    if (status === null && Number.isInteger(candidateStatus) && candidateStatus > 0) {
      status = candidateStatus;
    }
    current = current.cause;
  }

  return {
    status,
    codes,
    names,
    message: messages.join(' ').toLowerCase(),
  };
}

export function isRetryableInferenceAdapterError(error) {
  const { status, codes, names, message } = getInferenceAdapterErrorMetadata(error);
  if (codes.includes('GENBLAZE_MODEL_UNSUPPORTED')) {
    return true;
  }
  if (status !== null) {
    return status === 401 ||
      status === 403 ||
      status === 408 ||
      status === 409 ||
      status === 425 ||
      status === 429 ||
      status >= 500;
  }
  const retryableCodes = [
    'EAI_AGAIN',
    'ECONNABORTED',
    'ECONNREFUSED',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ENOTFOUND',
    'ETIMEDOUT',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_SOCKET',
  ];
  if (codes.some((code) => retryableCodes.includes(code))) {
    return true;
  }
  if (names.some((name) =>
    ['APICONNECTIONERROR', 'APICONNECTIONTIMEOUTERROR'].includes(name)
  )) {
    return true;
  }
  return message.includes('fetch failed') ||
    message.includes('network error') ||
    message.includes('socket hang up');
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
    if (typeof lastError === 'object') {
      lastError.attemptedInferenceAdapters = attemptedProviders;
    }
    throw lastError;
  }
  return dispatchProvider(undefined);
}

function getCompatibleChatRequestOptions(options = {}) {
  const supportedFields = [
    'response_format',
    'tools',
    'tool_choice',
    'parallel_tool_calls',
    'max_tokens',
    'max_completion_tokens',
    'max_output_tokens',
    'stop',
    'seed',
  ];
  return Object.fromEntries(
    supportedFields
      .filter((field) => options[field] !== undefined)
      .map((field) => [field, options[field]]),
  );
}

function getLegacyReasoningEffort(options = {}) {
  return (
    options.reasoningEffort ||
    options.reasoning_effort ||
    options.reasoning?.effort ||
    null
  );
}

function getReasoningEffort(options = {}) {
  return options.effort || getLegacyReasoningEffort(options);
}

export function getAssistantReasoningEffort(inferenceModel, options = {}) {
  if (isQwenInferenceModel(inferenceModel)) {
    return null;
  }
  if (isKimiK3InferenceModel(inferenceModel)) {
    return GPT_56_SOL_REASONING_EFFORT;
  }
  return isGeminiInferenceModel(inferenceModel)
    ? getLegacyReasoningEffort(options)
    : getGPT56SolReasoningEffort(inferenceModel, getReasoningEffort(options));
}

function getRequestTimeoutMs(options = {}) {
  const parsed = Number(
    options.timeout ??
    options.timeoutMs ??
    process.env.ASSISTANT_QUERY_INFERENCE_TIMEOUT_MS
  );
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_ASSISTANT_QUERY_TIMEOUT_MS;
}

export async function sendAssistantCompletionRequest(messageList, inferenceModel, options) {
  const baseCompletionOptions = normalizeCompletionOptions(options);
  const completionOptions = {
    ...baseCompletionOptions,
    reasoningEffort: getAssistantReasoningEffort(inferenceModel, baseCompletionOptions),
  };
  const model = getModelNameForInferenceModel(inferenceModel);
  if (shouldUseStandaloneInferenceAdapterFallback({ ...completionOptions, model })) {
    const providers = getConfiguredInferenceProviders(model, {
      ...completionOptions,
      messages: messageList,
    });
    if (providers.length > 1) {
      return runInferenceAdapterFallback(
        providers,
        (provider) => sendAssistantCompletionRequestForProvider(
          messageList,
          model,
          buildProviderPinnedCompletionOptions(completionOptions, provider),
        ),
      );
    }
  }

  return sendAssistantCompletionRequestForProvider(
    messageList,
    inferenceModel,
    completionOptions,
  );
}

async function sendAssistantCompletionRequestForProvider(
  messageList,
  inferenceModel,
  completionOptions,
) {
  const model = getModelNameForInferenceModel(inferenceModel);
  const isGeminiModel = isGeminiInferenceModel(inferenceModel);
  const isQwenModel = isQwenInferenceModel(inferenceModel) || isQwenInferenceModel(model);
  const isKimiModel =
    isKimiK3InferenceModel(inferenceModel) || isKimiK3InferenceModel(model);
  const reasoningEffort = getAssistantReasoningEffort(inferenceModel, completionOptions);
  const externalPayload = {
    model,
    messages: messageList,
    authorization: completionOptions.authorization,
    bypassSamsarExternalInference: completionOptions.bypassSamsarExternalInference,
    samsarExternalInference: completionOptions.samsarExternalInference,
    reasoning_effort: reasoningEffort || undefined,
    timeout: getRequestTimeoutMs(completionOptions),
  };
  if (shouldUseSamsarExternalInference(externalPayload)) {
    return await sendAssistantSamsarExternalCompletionRequest(messageList, model, {
      ...completionOptions,
      reasoningEffort,
    });
  }

  if (isGeminiModel) {
    return await sendAssistantGeminiCompletionRequest(messageList, inferenceModel, completionOptions);
  }

  if (isQwenModel) {
    return await sendAssistantQwenCompletionRequest(messageList, model, completionOptions);
  }

  if (isKimiModel) {
    return await sendAssistantKimiK3CompletionRequest(messageList, model, completionOptions);
  }

  return await sendAssistantOpenAICompletionRequest(
    messageList,
    inferenceModel,
    reasoningEffort,
    completionOptions,
  );
}

export async function sendAssistantKimiK3CompletionRequest(
  messageList,
  inferenceModel,
  options = {},
  dependencyOverrides = {},
) {
  const model = getModelNameForInferenceModel(inferenceModel);
  const response = await createKimiK3ChatCompletion({
    ...getCompatibleChatRequestOptions(options),
    model,
    messages: messageList,
    reasoning_effort: GPT_56_SOL_REASONING_EFFORT,
    timeout: getRequestTimeoutMs(options),
  }, dependencyOverrides);
  const outputText = response?.choices?.[0]?.message?.content || '';

  return {
    model: response?.model || model,
    response: normalizeChatCompletionToResponses(response),
    outputText,
    outputContent: buildFallbackAssistantContent(outputText),
    externalProvider: 'kimi',
  };
}

export async function sendAssistantQwenCompletionRequest(messageList, inferenceModel, options = {}) {
  const model = getModelNameForInferenceModel(inferenceModel);
  const {
    authorization,
    bypassSamsarExternalInference,
    samsarExternalInference,
    inferenceAdapterProvider,
    ...providerOptions
  } = options;
  const response = await createQwenChatCompletion({
    ...providerOptions,
    model,
    messages: messageList,
    timeout: getRequestTimeoutMs(options),
  });
  const outputText = response?.choices?.[0]?.message?.content || '';

  return {
    model: response?.model || model,
    response: normalizeChatCompletionToResponses(response),
    outputText,
    outputContent: buildFallbackAssistantContent(outputText),
    externalProvider: 'alibabaCloud',
  };
}

export async function sendAssistantSamsarExternalCompletionRequest(messageList, inferenceModel, options = {}) {
  const model = getModelNameForInferenceModel(inferenceModel);
  const reasoningEffort = getAssistantReasoningEffort(inferenceModel, options);
  const response = await createSamsarExternalChatCompletion({
    ...getCompatibleChatRequestOptions(options),
    model,
    messages: messageList,
    authorization: options.authorization,
    bypassSamsarExternalInference: options.bypassSamsarExternalInference,
    samsarExternalInference: options.samsarExternalInference,
    reasoning_effort: reasoningEffort || undefined,
    timeout: getRequestTimeoutMs(options),
  });
  const outputText = response?.choices?.[0]?.message?.content || '';

  return {
    model: response?.model || model,
    response: normalizeChatCompletionToResponses(response),
    outputText,
    outputContent: buildFallbackAssistantContent(outputText),
    externalProvider: options.inferenceAdapterProvider ||
      resolveConfiguredInferenceProvider(model) ||
      'samsar',
  };
}

export async function sendAssistantOpenAICompletionRequest(
  messageList,
  inferenceModel,
  reasoningEffort,
  options = {},
  dependencyOverrides = {},
) {
  const model = getModelNameForInferenceModel(inferenceModel);
  const client = dependencyOverrides.client || openai;
  const timeoutMs = getRequestTimeoutMs(options);
  const retryOptions = {
    timeoutMs,
    maxRetries: options.externalMaxRetries ?? options.maxRetries,
    ...(dependencyOverrides.retryOptions || {}),
  };

  try {
    const sourceBody = {
      model,
      input: normalizeMessagesForResponses(messageList),
    };
    sourceBody.reasoning = {
      effort: getGPT56SolReasoningEffort(inferenceModel, reasoningEffort),
    };

    try {
      const response = await runExternalInferenceWithRetry(
        async ({ signal }) => {
          const body = await resolveProviderMediaPayload(sourceBody, {
            resolveMediaUrl: dependencyOverrides.resolveMediaUrl,
            serviceName: 'samsar_assistant_query_processor_openai_responses',
          });
          return client.post('/responses', {
            body,
            timeout: timeoutMs,
            maxRetries: 0,
            signal,
          });
        },
        {
          provider: 'openai-responses',
          model,
          ...retryOptions,
        },
      );

      return {
        model: response?.model || model,
        response,
        outputText: extractResponsesOutputText(response),
        outputContent: extractResponsesOutputContent(response),
      };
    } catch (responsesError) {
      const shouldFallback = dependencyOverrides.shouldFallbackToChatCompletions ||
        shouldFallbackToChatCompletions;
      if (!shouldFallback(responsesError, model)) {
        throw responsesError;
      }

      const sourcePayload = {
        messages: normalizeMessagesForChatCompletions(messageList),
        model,
      };
      const response = await runExternalInferenceWithRetry(
        async ({ signal }) => {
          const payload = await resolveProviderMediaPayload(sourcePayload, {
            resolveMediaUrl: dependencyOverrides.resolveMediaUrl,
            serviceName: 'samsar_assistant_query_processor_openai_chat',
          });
          return client.chat.completions.create(payload, {
            timeout: timeoutMs,
            maxRetries: 0,
            signal,
          });
        },
        {
          provider: 'openai-chat',
          model,
          ...retryOptions,
        },
      );
      const outputText = response?.choices?.[0]?.message?.content || '';

      return {
        model: response?.model || model,
        response: normalizeChatCompletionToResponses(response),
        outputText,
        outputContent: buildFallbackAssistantContent(outputText),
      };
    }
  } catch (error) {
    if (typeof error?.code === 'string' && error.code.startsWith('SAMSAR_')) {
      throw error;
    }
    throw new Error(
      'An error occurred while sending the message. Please try again with a different message.',
      { cause: error },
    );
  }

}

function normalizeMessagesForResponses(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.map((message) => {
    if (!message || typeof message !== 'object') {
      return message;
    }

    if (message.role === 'system') {
      return { ...message, role: 'developer' };
    }

    return message;
  });
}

function normalizeMessagesForChatCompletions(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .map((message) => normalizeChatCompletionMessage(message))
    .filter(Boolean);
}

function normalizeChatCompletionMessage(message) {
  if (!message || typeof message !== 'object') {
    return null;
  }

  const normalizedRole = message.role === 'developer' ? 'system' : message.role;
  const normalizedContent = normalizeContentForChatCompletions(message.content);

  return {
    ...message,
    role: normalizedRole,
    content: normalizedContent,
  };
}

function normalizeContentForChatCompletions(content) {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return content;
  }

  const normalizedParts = content
    .flatMap((part) => normalizeChatCompletionContentParts(part));

  if (normalizedParts.length === 0) {
    return '';
  }

  const hasNonTextPart = normalizedParts.some((part) => part.type !== 'text');
  if (!hasNonTextPart) {
    return normalizedParts.map((part) => part.text).join('\n\n');
  }

  return normalizedParts;
}

function flattenChatImageReferences(value, depth = 0) {
  if (typeof value === 'string') return value.trim() ? [value] : [];
  if (Array.isArray(value) && depth < 4) {
    return value.flatMap((entry) => flattenChatImageReferences(entry, depth + 1));
  }
  if (!value || typeof value !== 'object' || depth >= 4) return [];
  if (
    typeof value.url === 'string' ||
    typeof value.uri === 'string' ||
    typeof value.image_url === 'string' ||
    typeof value.imageUrl === 'string' ||
    typeof value.data === 'string' ||
    typeof value.base64 === 'string'
  ) {
    return [value];
  }
  return [
    'image_url', 'imageUrl', 'image_uri', 'imageUri',
    'source', 'urls', 'uris', 'sources',
  ].flatMap((field) => flattenChatImageReferences(value[field], depth + 1));
}

function getChatImageReferences(part) {
  return [
    'image_url', 'imageUrl', 'image_uri', 'imageUri', 'input_image', 'inputImage', 'image',
    'image_urls', 'imageUrls', 'image_uris', 'imageUris', 'images',
    'url', 'uri', 'source', 'urls', 'uris', 'sources',
  ].flatMap((field) => flattenChatImageReferences(part?.[field]));
}

function toChatImageUrl(reference, detail) {
  if (typeof reference === 'string') {
    return { url: reference, ...(detail ? { detail } : {}) };
  }
  if (!reference || typeof reference !== 'object') return null;
  const data = typeof reference.data === 'string' ? reference.data : reference.base64;
  const mimeType = reference.media_type || reference.mime_type || reference.mimeType || 'image/png';
  const url = data
    ? `data:${mimeType};base64,${data}`
    : reference.url || reference.uri || reference.image_url || reference.imageUrl;
  if (typeof url !== 'string' || !url.trim()) return null;
  return {
    url: url.trim(),
    ...((reference.detail || detail) ? { detail: reference.detail || detail } : {}),
  };
}

function normalizeChatCompletionContentParts(part) {
  if (!part || typeof part !== 'object') {
    return [];
  }

  if (part.type === 'input_text' || part.type === 'output_text' || part.type === 'text') {
    return typeof part.text === 'string'
      ? [{
          type: 'text',
          text: part.text,
        }]
      : [];
  }

  const normalizedType = typeof part.type === 'string'
    ? part.type.toLowerCase().replace(/[\s-]+/g, '_')
    : '';
  if (/(?:^|_)image(?:_|$)/.test(normalizedType)) {
    return getChatImageReferences(part)
      .map((reference) => toChatImageUrl(reference, part.detail))
      .filter(Boolean)
      .map((imageUrl) => ({
          type: 'image_url',
          image_url: imageUrl,
        }));
  }

  if (typeof part.text === 'string') {
    return [{
      type: 'text',
      text: part.text,
    }];
  }

  return [];
}

function extractResponsesOutputText(response) {
  if (!response || typeof response !== 'object') {
    return '';
  }

  if (typeof response.output_text === 'string') {
    return response.output_text;
  }

  const output = response.output;
  if (!Array.isArray(output)) {
    return '';
  }

  const texts = [];
  for (const item of output) {
    if (!item || typeof item !== 'object' || item.type !== 'message') {
      continue;
    }
    const contentList = item.content;
    if (!Array.isArray(contentList)) {
      continue;
    }
    for (const content of contentList) {
      if (!content || typeof content !== 'object') {
        continue;
      }
      if (content.type === 'output_text' && typeof content.text === 'string') {
        texts.push(content.text);
      }
    }
  }

  return texts.join('');
}

function extractResponsesOutputContent(response) {
  const output = response?.output;
  if (!Array.isArray(output)) {
    return buildFallbackAssistantContent(extractResponsesOutputText(response));
  }

  const assistantMessage = output.find((item) => item?.type === 'message' && item?.role === 'assistant');
  if (assistantMessage && Array.isArray(assistantMessage.content) && assistantMessage.content.length > 0) {
    return assistantMessage.content;
  }

  return buildFallbackAssistantContent(extractResponsesOutputText(response));
}

function buildFallbackAssistantContent(outputText) {
  return [
    {
      type: 'output_text',
      text: typeof outputText === 'string' ? outputText : '',
      annotations: [],
    }
  ];
}

function shouldFallbackToChatCompletions(error, model) {
  if (typeof model === 'string' && model.startsWith('gpt-5')) {
    return false;
  }

  const status = error?.status || error?.response?.status;
  if (status !== 400 && status !== 404) {
    return false;
  }

  const message = `${error?.message || ''}`.toLowerCase();
  return (
    message.includes('/responses')
    || message.includes('responses')
    || message.includes('unsupported')
    || message.includes('not found')
  );
}

function normalizeChatCompletionToResponses(chatResponse) {
  const message = chatResponse?.choices?.[0]?.message || {};
  const text = typeof message.content === 'string' ? message.content : '';
  const createdAt = Number(chatResponse?.created);

  return {
    id: chatResponse?.id,
    object: 'response',
    created_at: Number.isFinite(createdAt) ? createdAt : Math.floor(Date.now() / 1000),
    status: 'completed',
    model: chatResponse?.model,
    output_text: text,
    output: [
      {
        id: `${chatResponse?.id || 'chatcmpl'}_message`,
        type: 'message',
        role: 'assistant',
        content: buildFallbackAssistantContent(text),
      },
    ],
    usage: {
      input_tokens: Number(chatResponse?.usage?.prompt_tokens) || 0,
      input_tokens_details: {
        cached_tokens: Number(chatResponse?.usage?.prompt_tokens_details?.cached_tokens) || 0,
      },
      output_tokens: Number(chatResponse?.usage?.completion_tokens) || 0,
      output_tokens_details: {
        reasoning_tokens: Number(chatResponse?.usage?.completion_tokens_details?.reasoning_tokens) || 0,
      },
      total_tokens: Number(chatResponse?.usage?.total_tokens) || 0,
    },
  };
}
